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
// A namespace, so a test can stand in for the CBBD-backed refresh.
const hoopsGames = require('../routes/hoopsGames');

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

// How far back to look for results. Three days covers a Sunday played
// after Saturday night's run, a West Coast tip that finishes after
// midnight Eastern, and a dyno that missed a night.
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;

// WHICH WEEKS TO SCORE — from the RESULTS, not from the calendar.
//
// Scoring only "this week" loses every Sunday game, permanently. The
// scheduler runs on Central time, so a 23:30 CT run is 00:30 EASTERN the
// next day, and the hoops calendar buckets weeks Monday-to-Sunday on the
// Eastern day. Sunday's games are stamped week N, are played after
// Saturday night's run, and the Sunday-night run asks for week N+1 —
// which is empty. No later run ever asks for week N again, and scores are
// banked at time of play, so those games are never worth anything.
//
// Measured against the real 2027 schedule: 377 of 5,286 games, 7.1% of the
// season — and because the NCAA ladder pays per round PLAYED, half the
// Round of 32 and half the Elite Eight are Sunday games too.
//
// So: every week that has a game which went final recently. That also
// picks up a late result, a corrected roster and a missed night, and it
// needs no reasoning about timezones at all. Re-scoring a week is free —
// writeWeek replaces the entry rather than appending.
async function weeksToScore(season, now) {
    const since = new Date(now.getTime() - LOOKBACK_MS);
    const recent = await HoopsGame.distinct('week', {
        season, status: 'final', startDate: { $gte: since }
    });
    const weeks = recent.filter(w => Number.isFinite(Number(w))).map(Number).sort((a, b) => a - b);
    if (weeks.length) return { weeks };

    // Nothing has finished lately. Fall back to the calendar so a league
    // with no results yet still gets its zero-week written — an absent week
    // and a zero week read the same in a total but not in a weekly table,
    // and H2H settles per week.
    const first = await HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: 1 }).lean();
    if (!first) return { skip: 'no schedule ingested' };
    const last = await HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: -1 }).lean();
    const when = resolveCurrentWeek({
        seasonStart: seasonStartFrom(first.startDate),
        lastGameDate: last && last.startDate,
        now
    });
    if (when.skip || !Number.isFinite(when.week)) return { skip: when.skip || 'no current week' };
    return { weeks: [when.week] };
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
    // Refresh notes are reported, not counted as work: a night with nothing to
    // score stays a silent skip, as it was before the refresh existed.
    const refreshed = [];
    let failed = null;

    // THE SAFETY NET under the live poller (#505). Pull the last LOOKBACK_MS
    // of results from CBBD before scoring, so a final the poller missed — it
    // is opt-in (LIVE_POLL_ENABLED), a dyno can restart mid-slate, CBBD can
    // correct a score — still lands tonight. Before #505 nothing called this
    // refresh at all, and no basketball game would ever have gone final.
    //
    // 1 billable call per season per night; a 2nd only when the stored
    // schedule has POSTSEASON games in the window — asking for postseason in
    // November would make the refresh's "games were due but none came back"
    // guard fire on the regular season's games.
    for (const season of [...new Set(leagues.map(l => l.season))]) {
        const end = now;
        const start = new Date(now.getTime() - LOOKBACK_MS);
        const types = ['regular'];
        if (await HoopsGame.exists({ season, seasonType: 'postseason', startDate: { $gte: start, $lte: end } })) types.push('postseason');
        for (const seasonType of types) {
            try {
                const out = await hoopsGames.refreshResults({ season, seasonType, start, end });
                if (out.code === 200) {
                    refreshed.push(`${season} ${seasonType} results: ${out.body.finals} final of ${out.body.games}`);
                } else {
                    failed = `${season} ${seasonType} refresh ${out.code}: ${out.body.message}`;
                    skipped.push(failed);
                }
            } catch (err) {
                failed = `${season} ${seasonType} refresh: ${err.message}`;
                skipped.push(failed);
            }
        }
    }

    for (const { league, season } of leagues) {
        try {
            const which = await weeksToScore(season, now);
            if (which.skip) {
                skipped.push(`${league}: ${which.skip}`);
                continue;
            }
            for (const week of which.weeks) {
                const out = await scoreHoopsWeek(league, { season, week });
                done.push(`${league} wk${week}: ${out.managers} manager(s), ${out.games} game(s), ranks ${out.source}`);
            }
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
    const summary = [...refreshed, ...done, ...skipped].join(' | ') + ` (${secs}s)`;
    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, failed ? 'error' : 'success', summary);
    console.log(`[${JOB_NAME}] ${summary}`);
    return { done, skipped, failed, summary };
}

module.exports = { run, JOB_NAME, basketballLeagues, weeksToScore, LOOKBACK_MS };
