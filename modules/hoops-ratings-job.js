// Weekly adjusted-efficiency ratings for basketball quadrants (#318).
//
// modules/hoops-ranks.js grades every game against ranksFor(season, week),
// which blends Torvik's preseason ranks with the HoopsRating rows for that
// week. This job is the only thing that writes those rows. Without it every
// quadrant all season is graded on preseason ranks.
//
// ---- nothing can be backfilled ----
//
// CBBD /ratings/adjusted ignores week, date, endDate and seasonType: it
// serves the CURRENT snapshot and keeps no history (verified 29 Sep 2026,
// #318). A week this job misses is gone for good. So the job runs twice a
// day, every day — 1 billable call a run, ~60 a month in season — and a
// failure is a red JobRun AND an email, not a console line.
//
// ---- which week a snapshot is written to ----
//
// A HoopsRating row is the ranking a week's games are graded AGAINST — it
// applies FROM that week (models/hoopsRating.js). So a snapshot taken
// during week N is written to week N + 1, and every run in week N overwrites
// the one before it. The last write wins: Sunday night's snapshot is what
// week N + 1 is graded on, and week N + 1's row stops moving the moment week
// N + 1 starts.
//
// Writing it to week N instead would look the same and grade on hindsight.
// hoops-scores rescores the whole week every night, so week N's games would
// keep being re-quadranted against ratings that already include those games
// — a team that wins big all week climbs, and the win over it is regraded
// as a better one. Banked at time of play means the rank as it stood BEFORE
// the game.
//
// ---- the rank is OURS, computed from net ----
//
// CBBD's rankings.net is a competition rank with ties — 96 of 365 teams
// shared one on the 2026 final snapshot. The quadrant bands are thresholds
// over a dense 1..N field and hoops-ranks treats the rank as exactly that,
// so the rank is recomputed from netRating, ties broken by team id so it
// cannot reshuffle between runs.
//
// ---- the cold start ----
//
// CBBD returns 0 teams for a season until its ratings start, roughly five
// weeks after tip-off. Those runs write NOTHING and record a skip that says
// so: an empty week is what makes ranksFor fall back to the preseason ranks.

const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');
const cbbd = require('./cbbd-client');
const { resolveCurrentWeek, seasonStartFrom } = require('./hoops-calendar');
const { basketballLeagues } = require('./hoops-scores-job');
const HoopsGame = require('./../models/hoopsGame');
const HoopsRating = require('./../models/hoopsRating');
const HoopsTeam = require('./../models/hoopsTeam');
const { MIN_LIVE_COVERAGE } = require('./hoops-ranks');

const JOB_NAME = 'hoops-ratings';
const LABEL = 'Hoops Ratings';
const SOURCE = 'cbbd-adjusted';

// A number, or null. NOT Number(x): Number(null) is 0, a real-looking rating.
function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// CBBD rows -> HoopsRating fields, ranked 1..N by net rating, best first.
//
// A row with no team id or no net rating cannot be placed and is dropped
// rather than ranked last — a team nobody rated must fall back to its
// preseason rank, not be handed #365.
function rankRatings(rows) {
    const rated = [];
    for (const r of rows || []) {
        const teamId = num(r && r.teamId);
        const net = num(r && r.netRating);
        if (teamId === null || net === null) continue;
        rated.push({ teamId, adjEM: net, adjOff: num(r.offensiveRating), adjDef: num(r.defensiveRating) });
    }
    rated.sort((a, b) => (b.adjEM - a.adjEM) || (a.teamId - b.teamId));
    return rated.map((r, i) => Object.assign(r, { rank: i + 1 }));
}

// The week a snapshot taken now is written to, or { skip } — see the header.
// Free: two local reads, no CBBD call.
async function targetWeek(season, now) {
    const first = await HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: 1 }).lean();
    if (!first) return { skip: 'no schedule ingested' };
    const last = await HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: -1 }).lean();
    const when = resolveCurrentWeek({
        seasonStart: seasonStartFrom(first.startDate),
        lastGameDate: last.startDate,
        now
    });
    if (when.skip) return { skip: when.skip };
    return { week: when.week + 1, during: when.week };
}

// Store one snapshot as the given week's ranks. Replaces the week wholesale:
// upserts every team in the snapshot, then removes any team an earlier run
// this week wrote that this one does not have, so a week never mixes two
// snapshots' ranks.
async function writeWeek(season, week, ranked, fetchedAt) {
    await HoopsRating.bulkWrite(ranked.map(r => ({
        updateOne: {
            filter: { season, week, teamId: r.teamId },
            update: { $set: Object.assign({ source: SOURCE, fetchedAt }, r) },
            upsert: true
        }
    })), { ordered: false });
    await HoopsRating.deleteMany({ season, week, teamId: { $nin: ranked.map(r => r.teamId) } });
}

// The fewest teams a snapshot must rank to be believed — hoops-ranks'
// own floor, so a week this job calls whole is a week ranksFor will read.
// 0 with no preseason ranks on file, when there is nothing to measure by.
async function coverageFloor(season) {
    const field = await HoopsTeam.countDocuments({ season, 'preseason.rank': { $type: 'number' } });
    return Math.ceil(field * MIN_LIVE_COVERAGE);
}

// The write, retried once in-process. A bulkWrite that fails partway leaves
// the week holding two snapshots' ranks; if that was Sunday's last run,
// nothing after it ever rewrites the week. A second attempt replaces the
// whole week again, so it either repairs the mix or fails loudly as well.
async function writeWeekWithRetry(season, week, ranked, now) {
    try {
        await writeWeek(season, week, ranked, now);
    } catch (first) {
        console.error(`[${JOB_NAME}] ${season} wk${week} write failed, retrying once: ${first.message}`);
        await writeWeek(season, week, ranked, now);
    }
}

// One season: { written } | { skip } — throws on a CBBD or write failure, and
// on a snapshot too thin to trust.
async function snapshotSeason(season, now) {
    const target = await targetWeek(season, now);
    if (target.skip) return { skip: target.skip };

    const { data } = await cbbd.cbbdGet('/ratings/adjusted', { season });
    if (!data.length) {
        // The cold start — unless this season has already been rated. CBBD
        // going back to [] in January is a regression, and every run it
        // spends as a quiet skip is a week lost for good.
        const rated = await HoopsRating.exists({ season, week: { $lt: target.week } });
        if (rated) throw new Error(`CBBD returned no ratings for ${season}, but earlier weeks were rated — wk${target.week} not written`);
        return { skip: `CBBD has no ratings for ${season} yet — wk${target.week} stays on preseason ranks` };
    }

    const ranked = rankRatings(data);
    // Rows came back and none could be ranked: the response shape changed.
    // Writing nothing would read as the cold start, every week, forever.
    if (!ranked.length) throw new Error(`CBBD returned ${data.length} rating row(s) for ${season} with no usable teamId/netRating — the response shape changed`);
    const dropped = data.length - ranked.length;
    const droppedNote = dropped ? `, ${dropped} unrankable row(s) dropped` : '';

    // A THIN snapshot never replaces a whole week. ranksFor ignores a week
    // under its coverage floor and, because an exact-week hit returns
    // early, does not fall back to the week before either — it goes to
    // Torvik. So one partial response on Sunday night would overwrite a
    // good week with one the reader throws away, and past the blend ramp
    // that week's games are graded on preseason ranks. Kept if nothing
    // whole is stored (it is still the only record of that night), and an
    // error either way.
    const floor = await coverageFloor(season);
    if (ranked.length < floor) {
        const stored = await HoopsRating.countDocuments({ season, week: target.week });
        const kept = stored >= floor;
        if (!kept) await writeWeekWithRetry(season, target.week, ranked, now);
        throw new Error(`CBBD ranked only ${ranked.length} team(s) for ${season}, under the ${floor} ranksFor needs${droppedNote} — `
            + (kept ? `wk${target.week}'s ${stored} stored team(s) kept` : `written to wk${target.week} anyway, nothing whole was stored`));
    }

    await writeWeekWithRetry(season, target.week, ranked, now);
    return { written: `${season} wk${target.week}: ${ranked.length} team(s) ranked${droppedNote} (snapshot taken in wk${target.during})` };
}

async function run({ now = new Date() } = {}) {
    const leagues = await basketballLeagues();
    // No basketball at all: silent, no JobRun, like the other hoops jobs.
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    const startMs = Date.now();
    const when = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const written = [];
    const skipped = [];
    const failures = [];
    for (const season of [...new Set(leagues.map(l => l.season))]) {
        try {
            const out = await snapshotSeason(season, now);
            if (out.written) written.push(out.written);
            else skipped.push(`${season}: ${out.skip}`);
        } catch (err) {
            failures.push({ season, err });
        }
    }

    const status = failures.length ? 'error' : (written.length ? 'success' : 'skipped');
    const secs = Math.round((Date.now() - startMs) / 1000);
    const summary = [
        ...written,
        ...skipped,
        ...failures.map(f => `${f.season}: FAILED ${(f.err && f.err.message) || f.err}`)
    ].join(' | ') + ` (${secs}s)`;

    // Recorded on EVERY run, skips included: with no history to backfill
    // from, "did this week's snapshot land" has to be answerable from the
    // admin strip, and a silent skip looks the same as a job that never ran.
    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, status, summary);
    (failures.length ? console.error : console.log)(`[${JOB_NAME}] ${summary}`);

    if (failures.length) {
        await jobMailer.sendJobEmail({
            label: LABEL, when, ok: false,
            rows: [['Seasons failed', failures.map(f => String(f.season)).join(', ')], ['Failed after', `${secs}s`]],
            error: failures.map(f => (f.err && f.err.stack) || String(f.err)).join('\n\n')
        });
    }
    return { status, written, skipped, failed: failures.length ? summary : null, summary };
}

module.exports = { run, JOB_NAME, LABEL, rankRatings, targetWeek, snapshotSeason, writeWeek, coverageFloor };
