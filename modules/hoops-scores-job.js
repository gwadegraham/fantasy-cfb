// Scheduled entry point for basketball scoring (#316).
//
// In modules/ rather than a root update-*-job.js file, like the Captain
// reminder and the recap notice: it reads and writes the database directly
// and runs inside the web dyno via modules/scheduler.js. It does NOT go
// through modules/score-job.js — that wraps football's HTTP-driven
// updateScores, and none of this needs HTTP.
//
// Scores EVERY basketball league, which today is however many exist. A
// football league is never touched: the league list comes from the season
// cache's sport, not from a name.
//
// Runs nightly. Basketball plays most nights, and a week is rescored in
// full each time rather than incrementally, so a late final or a corrected
// roster is picked up by the next pass without anyone asking.

// A NAMESPACE import, not a destructure. job-logger writes over HTTP, so a
// test has no server and the row never lands — the only way to assert this
// job records its outcome is to watch the calls, and a destructured
// reference cannot be spied on. The same trap made a seasonForLeague spy
// useless earlier in this branch.
const jobLogger = require('./job-logger');
const { scoreHoopsWeek } = require('./hoops-scoring-pass');
const { resolveCurrentWeek, seasonStartFrom } = require('./hoops-calendar');
const HoopsGame = require('./../models/hoopsGame');
const League = require('./../models/league');
const seasons = require('./active-season');

const JOB_NAME = 'hoops-scores';

// RETURN SHAPE, which bit once already: `skippedReason` is a string and
// means the whole run did nothing; `skipped` is always an array of
// per-league notes. They were both called `skipped`, so a caller joining
// the array crashed on the run where it was a sentence.
//
// Every league the season cache says plays basketball, with its own season.
async function basketballLeagues() {
    const docs = await League.find({}, { code: 1, status: 1, _id: 0 }).lean();
    return docs
        .filter(d => d.status !== 'archived')
        .filter(d => seasons.sportForLeague(d.code) === 'basketball')
        .map(d => ({ league: d.code, season: seasons.seasonForLeague(d.code) }))
        .filter(l => Number.isFinite(l.season));
}

// Which week to score for a season — the hoops calendar's answer, since
// CBBD serves no week field of its own for basketball.
async function weekFor(season, now) {
    const first = await HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: 1 }).lean();
    const last = await HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: -1 }).lean();
    if (!first) return { skip: 'no schedule ingested' };
    return resolveCurrentWeek({
        seasonStart: seasonStartFrom(first.startDate),
        lastGameDate: last && last.startDate,
        now
    });
}

async function run({ now = new Date() } = {}) {
    const startMs = Date.now();
    const leagues = await basketballLeagues();

    // No basketball league is the normal state for most of this app's life.
    // Silent, and no JobRun: a nightly "nothing to do" row on the admin
    // strip is noise, and the Captain reminder already sets that precedent.
    if (!leagues.length) return { skippedReason: 'no basketball leagues', skipped: [], done: [] };

    const done = [];
    const skipped = [];
    let failed = null;

    for (const { league, season } of leagues) {
        try {
            const when = await weekFor(season, now);
            // resolveCurrentWeek returns a skip OR a week, so the second
            // half of this test is defence against a shape change rather
            // than a path anything reaches today — which is also why its
            // message has no test.
            if (when.skip || !Number.isFinite(when.week)) {
                skipped.push(`${league}: ${when.skip || 'no current week'}`);
                continue;
            }
            const out = await scoreHoopsWeek(league, { season, week: when.week });
            done.push(`${league} wk${when.week}: ${out.managers} manager(s), ${out.games} game(s), ranks ${out.source}`);
        } catch (err) {
            // One league's failure must not stop the others — and must not
            // vanish, which is the failure mode this repo keeps meeting.
            failed = String((err && err.message) || err);
            skipped.push(`${league}: FAILED ${failed}`);
        }
    }

    if (!done.length && !failed) {
        // No `|| 'nothing to score'`: there is at least one league by here,
        // and every iteration pushes to done or skipped, so the list is
        // never empty. A fallback would be an unreachable branch dressed up
        // as a safeguard.
        return { skippedReason: skipped.join('; '), skipped, done };
    }

    const secs = Math.round((Date.now() - startMs) / 1000);
    const summary = [...done, ...skipped].join(' | ') + ` (${secs}s)`;
    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, failed ? 'error' : 'success', summary);
    console.log(`[${JOB_NAME}] ${summary}`);
    return { done, skipped, failed, summary };
}

module.exports = { run, JOB_NAME, basketballLeagues, weekFor };
