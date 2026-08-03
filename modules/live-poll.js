// Game-day live scoring poller.
//
// Refreshes scores frequently during games so standings feel "live" WITHOUT
// blowing the CFBD monthly budget. The scheduler fires this every 10 min on
// Thu/Fri/Sat, but it only spends a CFBD call when a game is genuinely in
// progress. Three independent guards, cheapest first:
//
//   1. cadence / day — Saturday every 10 min; Thu/Fri every 20; nothing else.
//      Pure arithmetic, no I/O.
//   2. games-live gate — poll only if some active-season REGULAR game kicked off
//      within the last MAX_GAME_HOURS and isn't marked completed. Read from the
//      local Game collection (the full schedule is ingested preseason), so it
//      costs 0 CFBD calls. This alone means August, empty nights, and finished
//      slates spend nothing, and the 6h tail stops a game whose `completed` flag
//      never flips from polling forever.
//   3. hard ceiling — skip if CFBD's own remainingCalls has fallen to the
//      reserved buffer (default 100), so headroom for manual admin work is never
//      touched. remainingCalls is authoritative (counts ALL usage) and cached so
//      the check is ~free.
//
// Each actual poll runs the shared scoring pipeline with betting off (calendar
// is cached → ~1 CFBD call) and records a JobRun (no email) so the standings
// "last updated" badge advances during live play.
//
// Regular season only: the postseason path in runFullUpdate retrieves games
// per-team (many calls per poll), which is too expensive to poll frequently, so
// bowls/CFP stay on the daily 11pm job. A mass postseason pull would let the
// poller cover the playoff too — a good follow-up.

const Game = require('../models/game');
const { runFullUpdate } = require('./score-update');
const { startRun, finishRun } = require('./job-logger');
const { internalFetch } = require('./internal-api');

const JOB_NAME = 'live-scores';

// Tunables (env-overridable).
const MAX_GAME_HOURS = Number(process.env.LIVE_POLL_MAX_GAME_HOURS) || 6;
const CALL_BUFFER = Number(process.env.LIVE_POLL_CALL_BUFFER) || 100;
const INFO_TTL_MS = Number(process.env.LIVE_POLL_INFO_TTL_MS) || 30 * 60 * 1000;

// ---- pure decision helpers (unit-tested) ------------------------------------

// Central day-of-week: Thu(4) Fri(5) Sat(6) are the live-poll days.
function isLivePollDay(dow) { return dow === 4 || dow === 5 || dow === 6; }

// Saturday polls every 10-min mark; Thu/Fri every 20 (:00/:20/:40).
function isOnCadence(dow, minute) {
    if (dow === 6) return minute % 10 === 0;
    if (dow === 4 || dow === 5) return minute % 20 === 0;
    return false;
}

// Any game in progress right now? Kicked off within maxHours and not yet final.
// `games` are already-narrowed active-season regular candidates from the DB.
function anyGameInProgress(games, nowMs, maxHours) {
    const windowMs = maxHours * 3600 * 1000;
    return (games || []).some(g => {
        if (g.completed === true) return false;
        const start = Date.parse(g.startDate);
        if (Number.isNaN(start)) return false;
        return start <= nowMs && (nowMs - start) <= windowMs;
    });
}

// Final poll/skip verdict from already-gathered inputs. remainingCalls === null
// means "unknown" (info check failed) — we don't block scoring on that; the
// games-live gate still bounds the spend.
function decide({ dow, minute, gameLive, remainingCalls, buffer }) {
    if (!isLivePollDay(dow)) return { poll: false, reason: 'not a live-poll day' };
    if (!isOnCadence(dow, minute)) return { poll: false, reason: 'off-cadence' };
    if (!gameLive) return { poll: false, reason: 'no game in progress' };
    if (remainingCalls != null && remainingCalls <= buffer) {
        return { poll: false, reason: `ceiling reached: ${remainingCalls} CFBD calls left (buffer ${buffer})` };
    }
    return { poll: true, reason: 'game in progress' };
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

// ---- CFBD remaining-calls, cached so the ceiling check is ~free -------------
// remainingCalls only decreases as calls are spent, so between refreshes we
// subtract the polls we've made to stay on the conservative side.
let infoState = { at: 0, remaining: null, pollsSince: 0 };

async function remainingCalls(nowMs) {
    if (infoState.remaining == null || (nowMs - infoState.at) >= INFO_TTL_MS) {
        try {
            const res = await internalFetch(`${process.env.URL}/games/info`, { headers: { Accept: 'application/json' } });
            const data = await res.json();
            if (res.ok && data && typeof data.remainingCalls === 'number') {
                infoState = { at: nowMs, remaining: data.remainingCalls, pollsSince: 0 };
            }
        } catch (e) {
            console.log('live-poll: remainingCalls check failed:', e.message);
        }
    }
    if (infoState.remaining == null) return null;
    return infoState.remaining - infoState.pollsSince;
}

// ---- orchestration ----------------------------------------------------------

async function run() {
    if (process.env.LIVE_POLL_ENABLED === 'false') return { skipped: 'disabled' };

    const now = new Date();
    const nowMs = now.getTime();
    const { dow, minute } = centralNow(now);

    // Cheap gates first — avoid the DB / CFBD when it isn't even our cadence.
    if (!isLivePollDay(dow)) return { skipped: 'not a live-poll day' };
    if (!isOnCadence(dow, minute)) return { skipped: 'off-cadence' };

    // Games-live gate (DB only). Not-completed regular games that have already
    // kicked off — normally just the current slate's live/unfinalized games. The
    // 6h tail is applied in JS so a stuck `completed` flag can't poll forever.
    const season = Number(process.env.YEAR);
    const candidates = await Game.find(
        { season, seasonType: 'regular', completed: { $ne: true }, startDate: { $lte: now.toISOString() } },
        { startDate: 1, completed: 1 }
    ).lean();
    const gameLive = anyGameInProgress(candidates, nowMs, MAX_GAME_HOURS);
    if (!gameLive) return { skipped: 'no game in progress' };

    // Hard ceiling (authoritative CFBD remainingCalls, cached).
    const remaining = await remainingCalls(nowMs);
    const decision = decide({ dow, minute, gameLive, remainingCalls: remaining, buffer: CALL_BUFFER });
    if (!decision.poll) {
        console.log(`live-poll skip — ${decision.reason}`);
        return { skipped: decision.reason };
    }

    // Poll: shared pipeline, betting off (calendar cached → ~1 CFBD call).
    console.log(`live-poll: game in progress, refreshing scores (${remaining == null ? 'calls left unknown' : remaining + ' calls left'})`);
    const id = await startRun(JOB_NAME, { season: process.env.YEAR });
    try {
        const r = await runFullUpdate({ withBetting: false });
        infoState.pollsSince += 1;
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
    isLivePollDay, isOnCadence, anyGameInProgress, decide, centralNow,
    _resetInfoState: () => { infoState = { at: 0, remaining: null, pollsSince: 0 }; }
};

if (require.main === module) { run().then(r => { console.log('live-poll result:', r); process.exit(0); }); }
