// Game-day live scoring poller.
//
// Refreshes scores every 30 seconds during games so standings feel near-live.
// The scheduler fires this every 30s, every day; the games-live gate is what
// makes that affordable — read the local Game collection (0 CFBD calls, the
// schedule is ingested ahead of time) for any active-season game that kicked
// off within the last MAX_GAME_HOURS and isn't completed. That is what makes
// August, empty days, and finished slates spend nothing, and the 6h tail stops
// a stuck `completed` flag from polling forever.
//
// There is deliberately no remaining-calls ceiling here. One used to skip the
// poll when CFBD's counter fell to a reserved buffer, which protected nothing
// the poll spends — CFBD does not bill /scoreboard — while the condition that
// tripped it stopped finals from being detected at all, so a near-ceiling
// account would have left games unsettled rather than merely un-refreshed.
// Real billable usage is ~585 calls a month against a 30,000 limit, and the
// endpoints that do cost money are bounded where they are spent:
// modules/live-plays.js caches and persists, completion work is debounced in
// modules/completion-flush.js.
//
// Each actual poll fetches the CFBD /scoreboard (1 call, and a free one — CFBD
// does not bill /scoreboard or /info) which returns in-progress scores, period,
// clock, and possession — then re-scores the current week so standings and H2H
// win probability reflect live game state.
//
// Newly completed games are NOT settled inline. They queue in
// modules/completion-flush.js and the heavy pass (box scores, H2H bonuses,
// cumulative, records, parlays) runs once the cluster goes quiet, which is what
// makes a 30s cadence affordable in work as well as in calls — that pass used
// to run once per tick containing a final, so its cost tracked the interval
// rather than the number of games. The one case the gate above cannot cover is
// the last final of a slate — after it, no game is live and this job stops
// running — so run() drains explicitly when it finds pending work and nothing
// live.
//
// Records a JobRun (no email) so the standings "last updated" badge advances
// during live play.

const Game = require('../models/game');
const { runLiveUpdate, drainCompletions } = require('./score-update');
const completionFlush = require('./completion-flush');
const { startRun, finishRun } = require('./job-logger');

const JOB_NAME = 'live-scores';

// Tunables (env-overridable). MAX_GAME_HOURS lives in modules/game-window.js
// because the scoreboard's live/final cutoff has to be the same number.
const { MAX_GAME_HOURS } = require('./game-window');

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

// Final poll/skip verdict. The live phase is the only input now that no call
// ceiling gates a free poll. Kept as its own function because the reason string
// is what lands in the log, and because the games-live gate is worth testing
// separately from the DB query that feeds it.
function decide({ phase }) {
    if (!phase) return { poll: false, reason: 'no game in progress' };
    return { poll: true, reason: `${phase} game in progress` };
}

// ---- CFBD remaining-calls, learned for free from the poll response ----------
// CFBD returns the remaining monthly call count in the `x-calllimit-remaining`
// header, and runLiveUpdate surfaces it from the games pull. Logged rather than
// acted on: it is the cheapest visibility there is into billable usage drifting
// upward, and carrying it costs nothing. Unset until the first poll of a
// process — deliberately not seeded, since a seed only fed the deleted guard.
let lastKnownRemaining = null;

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

    // Poll: lightweight scoreboard update (1 free CFBD call) + re-score the
    // current week.
    console.log(`live-poll: ${phase} game in progress, refreshing scores (${lastKnownRemaining == null ? 'calls left unknown' : lastKnownRemaining + ' calls left'})`);
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
