// Basketball live poller (#505) — football's modules/live-poll.js, for CBBD.
//
// Basketball results used to arrive only through POST /hoops/games/refresh,
// which nothing called: in production no game would ever have gone final.
// This keeps them live on game nights; the nightly hoops-scores job runs the
// same refresh first as the safety net (modules/hoops-scores-job.js).
//
// Same shape as football's:
//   1. a games-live gate on the LOCAL schedule (0 CBBD calls), so empty days,
//      the off-season and finished slates cost nothing;
//   2. one QUOTA-FREE /scoreboard call per tick while a game is on, writing
//      scores, status, half and clock (modules/hoops-scoreboard.js);
//   3. newly final games queue in their OWN completion batch
//      (modules/completion-flush.js createCompletionFlush) and, once the cluster
//      goes quiet, the heavy pass runs once: box scores for the window
//      (2 billable calls, modules/hoops-box-score.js) and a rescore of every
//      affected week in every basketball league;
//   4. when nothing is live but finals are still queued, it drains — the gate
//      stops firing exactly when the last final lands.
//
// Registered alongside football's poller, behind the same LIVE_POLL_ENABLED.
// A JobRun is written only for a tick that changed something, so an
// eight-hour game night is not 900 identical rows.

const HoopsGame = require('../models/hoopsGame');
const cbbd = require('./cbbd-client');
const seasons = require('./active-season');
const scoreboard = require('./hoops-scoreboard');
const boxScore = require('./hoops-box-score');
const scoringPass = require('./hoops-scoring-pass');
const hoopsScoresJob = require('./hoops-scores-job');
const jobLogger = require('./job-logger');
const { createCompletionFlush } = require('./completion-flush');
const { anyGameInProgress } = require('./live-poll');
const { MAX_GAME_HOURS } = require('./game-window');

const JOB_NAME = 'hoops-live';
const flush = createCompletionFlush();

const NOT_LIVE = new Set(['final', 'postponed', 'cancelled']);

// The heavy pass for a batch of finals: box scores, then every basketball
// league rescored for each affected week. One league failing does not stop
// the others, and the box fetch failing does not stop the scoring.
async function completionWork(season, groups, nowMs) {
    const notes = [];
    let failed = null;
    try {
        const box = await boxScore.ingestRecent(season, { now: nowMs });
        notes.push(box.skippedReason ? `boxes: ${box.skippedReason}` : `boxes ${box.stored}/${box.games}`);
        if (box.capped) failed = 'box window hit the 3000-row cap';
    } catch (err) {
        failed = `boxes: ${err.message}`;
        notes.push(`boxes FAILED ${err.message}`);
    }
    const weeks = [...new Set(groups.map(g => Number(g.week)).filter(Number.isFinite))];
    const leagues = (await hoopsScoresJob.basketballLeagues()).filter(l => l.season === season);
    for (const { league } of leagues) {
        for (const week of weeks) {
            try {
                const out = await scoringPass.scoreHoopsWeek(league, { season, week });
                notes.push(`${league} wk${week}: ${out.games} game(s)`);
            } catch (err) {
                failed = `${league} wk${week}: ${err.message}`;
                notes.push(`${league} wk${week} FAILED ${err.message}`);
            }
        }
    }
    return { notes, failed };
}

async function record(status, summary) {
    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, status, summary);
}

// One tick at a time. A completion pass (box scores, then every league and
// week rescored) can outlast the 30s cadence on the free-tier cluster; a
// second tick starting under it would write the scoreboard and score
// concurrently. A skipped tick costs nothing — the next one catches up.
let running = false;

async function run(opts = {}) {
    if (running) return { skipped: 'previous tick still running' };
    running = true;
    try {
        return await tick(opts);
    } finally {
        running = false;
    }
}

async function tick({ now = new Date() } = {}) {
    if (process.env.LIVE_POLL_ENABLED === 'false') return { skipped: 'disabled' };
    const leagues = await hoopsScoresJob.basketballLeagues();
    if (!leagues.length) return { skipped: 'no basketball leagues' };
    const season = seasons.activeSeason('basketball');
    if (season == null) return { skipped: 'no active basketball season' };

    const nowMs = now.getTime();
    const candidates = await HoopsGame.find(
        { season, status: { $nin: [...NOT_LIVE] }, startDate: { $lte: now } },
        { startDate: 1, startTimeTbd: 1, status: 1, _id: 0 }
    ).lean();
    // football's gate reads `completed`; ours is the status we just filtered on
    const live = anyGameInProgress(candidates.map(g => Object.assign({ completed: false }, g)), nowMs, MAX_GAME_HOURS);

    if (!live) {
        if (!flush.pendingCount()) return { skipped: 'no game in progress' };
        const groups = flush.takePending();
        const work = await completionWork(season, groups, nowMs);
        const summary = `Slate over — settled ${groups.reduce((n, g) => n + g.gameIds.length, 0)} game(s) · ${work.notes.join(' | ')}`;
        await record(work.failed ? 'error' : 'success', summary);
        return { drained: true, summary, failed: work.failed };
    }

    let board;
    try {
        board = await cbbd.cbbdGet('/scoreboard');
    } catch (err) {
        await record('error', `scoreboard: ${err.message}`);
        return { error: err.message };
    }
    const applied = await scoreboard.applyScoreboard(board.data);
    // Group new finals by week so the batch rescores the right weeks.
    const byWeek = new Map();
    for (const g of applied.newlyFinal) {
        const key = `${g.seasonType}:${g.week}`;
        if (!byWeek.has(key)) byWeek.set(key, { week: g.week, seasonType: g.seasonType, ids: [] });
        byWeek.get(key).ids.push(g.id);
    }
    for (const b of byWeek.values()) flush.addPending(b.ids, { week: b.week, seasonType: b.seasonType }, nowMs);

    const bits = [`${applied.matched} of ${applied.rows} scoreboard games matched`, `${applied.updated} updated`];
    if (applied.newlyFinal.length) bits.push(`${applied.newlyFinal.length} final`);

    const verdict = flush.shouldFlush({ nowMs });
    let failed = null;
    if (verdict.flush) {
        const groups = flush.takePending();
        const work = await completionWork(season, groups, nowMs);
        bits.push(`settled · ${work.notes.join(' | ')}`);
        failed = work.failed;
    } else if (flush.pendingCount()) {
        bits.push(`${flush.pendingCount()} pending`);
    }
    // A live night where the scoreboard matches NONE of our games is the
    // id-mismatch the scoreboard module warns about — loud, not quiet.
    if (applied.rows > 0 && applied.matched === 0) failed = failed || 'no scoreboard game matched a stored game';

    const summary = bits.join(', ');
    if (applied.updated || verdict.flush || failed) await record(failed ? 'error' : 'success', summary);
    return { polled: true, summary, failed };
}

module.exports = { run, JOB_NAME, completionWork, _flush: flush };
