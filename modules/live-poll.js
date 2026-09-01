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
//      never touched. remainingCalls is authoritative (counts ALL usage).
//
// Each actual poll fetches the CFBD /scoreboard (Tier 1, 1 call) which returns
// in-progress scores, period, clock, and possession — then re-scores the current
// week so standings and H2H win probability reflect live game state. When a game
// newly completes, the full scoring pipeline (H2H bonuses, cumulative, parlays)
// runs. Records a JobRun (no email) so the standings "last updated" badge
// advances during live play.

const Game = require('../models/game');
const { runLiveUpdate } = require('./score-update');
const { startRun, finishRun } = require('./job-logger');
const { internalFetch } = require('./internal-api');

const JOB_NAME = 'live-scores';

// Tunables (env-overridable).
const MAX_GAME_HOURS = Number(process.env.LIVE_POLL_MAX_GAME_HOURS) || 6;
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
    if (!phase) return { skipped: 'no game in progress' };

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
        const detail = r.newlyCompleted
            ? `${r.updated} updated, ${r.newlyCompleted} completed`
            : `${r.updated} updated`;
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
