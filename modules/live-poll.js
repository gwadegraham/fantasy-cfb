// Game-day live scoring poller.
//
// Refreshes scores every 2 minutes during games so standings feel near-live.
// The scheduler fires this every 2 min, every day, but it only spends a CFBD
// call when a game is genuinely in progress. Two independent guards:
//
//   1. games-live gate — read the local Game collection (0 CFBD calls, the
//      schedule is ingested ahead of time) for any active-season game that
//      kicked off within the last MAX_GAME_HOURS and isn't completed. This
//      is what makes August, empty days, and finished slates spend nothing,
//      and the 6h tail stops a stuck `completed` flag from polling forever.
//   2. hard ceiling — skip if CFBD's own remainingCalls has fallen to the
//      reserved buffer (default 300), so headroom for manual admin work is
//      never touched. NOTE: this guard cannot trip on the poll itself, because
//      /scoreboard does not decrement the counter — it only bounds the billable
//      completion work that a poll can trigger.
//
// Each actual poll fetches the CFBD /scoreboard (1 call, and a free one — CFBD
// does not bill /scoreboard or /info) which returns in-progress scores, period,
// clock, and possession — then re-scores the current week so standings and H2H
// win probability reflect live game state.
//
// Newly completed games are NOT settled inline. They queue in
// modules/completion-flush.js and the heavy pass (box scores, H2H bonuses,
// cumulative, records, parlays) runs once the cluster goes quiet, so this
// cadence can be tightened without multiplying that work. The one case the
// gate above cannot cover is the last final of a slate — after it, no game is
// live and this job stops running — so run() drains explicitly when it finds
// pending work and nothing live.
//
// Records a JobRun (no email) so the standings "last updated" badge advances
// during live play.

const Game = require('../models/game');
const { runLiveUpdate, drainCompletions } = require('./score-update');
const completionFlush = require('./completion-flush');
const { startRun, finishRun } = require('./job-logger');
const { internalFetch } = require('./internal-api');

const JOB_NAME = 'live-scores';

// Tunables (env-overridable). MAX_GAME_HOURS lives in modules/game-window.js
// because the scoreboard's live/final cutoff has to be the same number.
const { MAX_GAME_HOURS } = require('./game-window');
const CALL_BUFFER = Number(process.env.LIVE_POLL_CALL_BUFFER) || 300;

// ---- pure decision helpers (unit-tested) ------------------------------------

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

// Final poll/skip verdict. `phase` is the live phase ('regular' | 'postseason'
// | null). remainingCalls === null means "unknown" (info check failed) — we
// don't block scoring on that; the games-live gate still bounds the spend.
function decide({ phase, remainingCalls, buffer }) {
    if (!phase) return { poll: false, reason: 'no game in progress' };
    if (remainingCalls != null && remainingCalls <= buffer) {
        return { poll: false, reason: `ceiling reached: ${remainingCalls} CFBD calls left (buffer ${buffer})` };
    }
    return { poll: true, reason: `${phase} game in progress` };
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

    // No live game — but the last final of a slate leaves its completion work
    // pending in modules/completion-flush.js, and this gate is exactly what
    // stops firing at that moment. So drain before returning, or that cluster
    // would wait in memory until the next slate (or a restart) discarded it.
    if (!phase) {
        if (!completionFlush.pendingCount()) return { skipped: 'no game in progress' };

        const drainId = await startRun(JOB_NAME, { season: process.env.YEAR });
        try {
            const drained = await drainCompletions();
            await finishRun(drainId, 'success', `Slate over — settled ${drained.flushed} completed game(s)`);
            return { drained: drained.flushed };
        } catch (err) {
            const msg = (err && err.message) ? err.message : String(err);
            await finishRun(drainId, 'error', msg);
            console.error('❌ live-poll drain failed:', err);
            return { error: msg };
        }
    }

    // Hard ceiling (authoritative CFBD remainingCalls).
    const remaining = await currentRemaining();
    const decision = decide({ phase, remainingCalls: remaining, buffer: CALL_BUFFER });
    if (!decision.poll) {
        console.log(`live-poll skip — ${decision.reason}`);
        return { skipped: decision.reason };
    }

    // Poll: lightweight scoreboard update (1 CFBD call) + re-score current week.
    console.log(`live-poll: ${phase} game in progress, refreshing scores (${remaining == null ? 'calls left unknown' : remaining + ' calls left'})`);
    const id = await startRun(JOB_NAME, { season: process.env.YEAR });
    try {
        const r = await runLiveUpdate();
        if (typeof r.remainingCalls === 'number') lastKnownRemaining = r.remainingCalls;
        if (r.skipped) {
            await finishRun(id, 'success', `Nothing to score — ${r.skipped}`);
            return { skipped: r.skipped };
        }
        const bits = [`${r.updated} updated`];
        if (r.newlyCompleted) bits.push(`${r.newlyCompleted} completed`);
        if (r.flushed) bits.push(`${r.flushed} settled`);
        if (r.pendingCompletions) bits.push(`${r.pendingCompletions} pending`);
        const detail = bits.join(', ');
        await finishRun(id, 'success',
            `Live update ${r.seasonType || phase} wk ${r.week || '?'} · ${detail}`,
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
    anyGameInProgress, decide,
    _resetRemaining: () => { lastKnownRemaining = null; }
};

if (require.main === module) { run().then(r => { console.log('live-poll result:', r); process.exit(0); }); }
