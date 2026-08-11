// Game-day live scoring poller.
//
// Refreshes scores frequently during games so standings feel "live" WITHOUT
// blowing the CFBD monthly budget. The scheduler fires this every 10 min, every
// day, but it only spends a CFBD call when a game is genuinely in progress.
// Three independent guards, cheapest first:
//
//   1. games-live gate + PHASE — read the local Game collection (0 CFBD calls,
//      the schedule is ingested ahead of time) for any active-season game that
//      kicked off within the last MAX_GAME_HOURS and isn't completed. Regular
//      and postseason don't overlap in time, so at most one phase is live. This
//      is what makes August, empty days, and finished slates spend nothing, and
//      the 6h tail stops a stuck `completed` flag from polling forever.
//   2. cadence — depends on the live phase:
//        • regular    → Thu/Fri/Sat only (Sat every 10 min, Thu/Fri every 20).
//        • postseason → every 10 min, ANY day. Bowls/CFP run Mon–Sat (the
//          national championship is a Monday) and are sparse + high-value, so
//          they get the tighter cadence on whatever day they fall.
//   3. hard ceiling — skip if CFBD's own remainingCalls has fallen to the
//      reserved buffer (default 100), so headroom for manual admin work is never
//      touched. remainingCalls is authoritative (counts ALL usage).
//
// Each actual poll runs the shared scoring pipeline with betting off (calendar
// cached, postseason mass-pulled → ~1 CFBD call) and records a JobRun (no email)
// so the standings "last updated" badge advances during live play. runFullUpdate
// picks the regular vs postseason pull from the calendar, matching the phase.

const Game = require('../models/game');
const { runFullUpdate } = require('./score-update');
const { startRun, finishRun } = require('./job-logger');
const { internalFetch } = require('./internal-api');

const JOB_NAME = 'live-scores';

// Tunables (env-overridable).
const MAX_GAME_HOURS = Number(process.env.LIVE_POLL_MAX_GAME_HOURS) || 6;
const CALL_BUFFER = Number(process.env.LIVE_POLL_CALL_BUFFER) || 100;

// ---- pure decision helpers (unit-tested) ------------------------------------

// Central day-of-week: Thu(4) Fri(5) Sat(6) are the live-poll days.
function isLivePollDay(dow) { return dow === 4 || dow === 5 || dow === 6; }

// Saturday polls every 10-min mark; Thu/Fri every 20 (:00/:20/:40).
function isOnCadence(dow, minute) {
    if (dow === 6) return minute % 10 === 0;
    if (dow === 4 || dow === 5) return minute % 20 === 0;
    return false;
}

// Whether this fire is on-cadence for the live phase.
//   postseason → every 10 min, any day (the scheduler fires on 10-min marks).
//   regular    → Thu/Fri/Sat only, at the regular cadence above.
function cadenceOk(phase, dow, minute) {
    if (phase === 'postseason') return minute % 10 === 0;
    if (phase === 'regular') return isLivePollDay(dow) && isOnCadence(dow, minute);
    return false;
}

// Any game in progress right now? Kicked off within maxHours and not yet final.
// `games` are already-narrowed active-season candidates (one phase) from the DB.
function anyGameInProgress(games, nowMs, maxHours) {
    const windowMs = maxHours * 3600 * 1000;
    return (games || []).some(g => {
        if (g.completed === true) return false;
        const start = Date.parse(g.startDate);
        if (Number.isNaN(start)) return false;
        return start <= nowMs && (nowMs - start) <= windowMs;
    });
}

// Final poll/skip verdict from already-gathered inputs. `phase` is the live
// phase ('regular' | 'postseason' | null). remainingCalls === null means
// "unknown" (info check failed) — we don't block scoring on that; the games-live
// gate still bounds the spend.
function decide({ dow, minute, phase, remainingCalls, buffer }) {
    if (!phase) return { poll: false, reason: 'no game in progress' };
    if (!cadenceOk(phase, dow, minute)) {
        return { poll: false, reason: phase === 'regular' ? 'regular game, off-cadence / not Thu-Fri-Sat' : 'off-cadence' };
    }
    if (remainingCalls != null && remainingCalls <= buffer) {
        return { poll: false, reason: `ceiling reached: ${remainingCalls} CFBD calls left (buffer ${buffer})` };
    }
    return { poll: true, reason: `${phase} game in progress` };
}

// America/Chicago day-of-week + minute, without a tz library.
function centralNow(now) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago', weekday: 'short', minute: '2-digit', hour12: false
    }).formatToParts(now);
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday];
    return { dow, minute: Number(map.minute) };
}

// ---- CFBD remaining-calls, learned for free from the poll response ----------
// CFBD returns the remaining monthly call count in the `x-calllimit-remaining`
// header on every response; runFullUpdate surfaces it from the games pull. So
// after the first poll this stays fresh with zero extra calls. On a cold start
// (process just booted, nothing polled yet) we seed it once from /games/info so
// we never poll blind near the ceiling.
let lastKnownRemaining = null;

async function currentRemaining() {
    if (lastKnownRemaining != null) return lastKnownRemaining;
    try {
        const res = await internalFetch(`${process.env.URL}/games/info`, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        if (res.ok && data && typeof data.remainingCalls === 'number') lastKnownRemaining = data.remainingCalls;
    } catch (e) {
        console.log('live-poll: seed remainingCalls failed:', e.message);
    }
    return lastKnownRemaining;
}

// ---- orchestration ----------------------------------------------------------

async function run() {
    if (process.env.LIVE_POLL_ENABLED === 'false') return { skipped: 'disabled' };

    const now = new Date();
    const nowMs = now.getTime();
    const { dow, minute } = centralNow(now);

    // Games-live gate (DB only, 0 CFBD calls). Not-completed games that have
    // already kicked off — normally just the current slate's live/unfinalized
    // games. The 6h tail (applied in JS) stops a stuck `completed` flag from
    // polling forever. Regular and postseason never overlap in time, so at most
    // one phase is live; postseason wins if somehow both look live.
    const season = Number(process.env.YEAR);
    const candidates = await Game.find(
        { season, completed: { $ne: true }, startDate: { $lte: now.toISOString() } },
        { startDate: 1, completed: 1, seasonType: 1 }
    ).lean();
    const postLive = anyGameInProgress(candidates.filter(g => g.seasonType === 'postseason'), nowMs, MAX_GAME_HOURS);
    const regLive = anyGameInProgress(candidates.filter(g => g.seasonType === 'regular'), nowMs, MAX_GAME_HOURS);
    const phase = postLive ? 'postseason' : (regLive ? 'regular' : null);
    if (!phase) return { skipped: 'no game in progress' };

    // Cadence for the live phase (pure). Off-cadence fires cost nothing more.
    if (!cadenceOk(phase, dow, minute)) return { skipped: 'off-cadence' };

    // Hard ceiling (authoritative CFBD remainingCalls).
    const remaining = await currentRemaining();
    const decision = decide({ dow, minute, phase, remainingCalls: remaining, buffer: CALL_BUFFER });
    if (!decision.poll) {
        console.log(`live-poll skip — ${decision.reason}`);
        return { skipped: decision.reason };
    }

    // Poll: shared pipeline, betting off (calendar cached / postseason mass-pull
    // → ~1 CFBD call).
    console.log(`live-poll: ${phase} game in progress, refreshing scores (${remaining == null ? 'calls left unknown' : remaining + ' calls left'})`);
    const id = await startRun(JOB_NAME, { season: process.env.YEAR });
    try {
        const r = await runFullUpdate({ withBetting: false });
        // Keep the ceiling fresh for free from this poll's own CFBD response.
        if (typeof r.remainingCalls === 'number') lastKnownRemaining = r.remainingCalls;
        // A live game whose calendar window has closed (or hasn't opened) —
        // shouldn't happen, since the games-live gate ran first, but the pipeline
        // has nothing to score and says so rather than guessing a week.
        if (r.skipped) {
            await finishRun(id, 'success', `Nothing to score — ${r.skipped}`);
            return { skipped: r.skipped };
        }
        await finishRun(id, 'success',
            `Live update ${r.seasonType} wk ${r.week} · ${r.gamesNew} new / ${r.gamesUpdated} updated`,
            { week: r.week, seasonType: r.seasonType });
        return { polled: true, week: r.week };
    } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        await finishRun(id, 'error', msg);
        console.error('❌ live-poll failed:', err);
        return { error: msg };
    }
}

module.exports = {
    run, JOB_NAME,
    // exported for tests
    isLivePollDay, isOnCadence, cadenceOk, anyGameInProgress, decide, centralNow,
    _resetRemaining: () => { lastKnownRemaining = null; }
};

if (require.main === module) { run().then(r => { console.log('live-poll result:', r); process.exit(0); }); }
