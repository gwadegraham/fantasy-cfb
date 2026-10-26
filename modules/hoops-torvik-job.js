// Torvik's T-Rank, kept current through the season.
//
// modules/hoops-ranks.js blends Torvik with CBBD's adjusted ratings over the
// first weeks. The Torvik side used to be the preseason import, frozen in
// October, so weeks 1-8 were graded partly on a ranking that knew nothing
// about the season. Torvik's own current rank already moves off his preseason
// prior as games come in, so it is the right Torvik number for any week, from
// the first one. This job files it, week by week, in HoopsTorvikRank.
//
// The preseason fields on hoopsTeam are NOT touched. The draft was ranked on
// them, draft grades read them, and the admin import stays the only writer.
//
// ---- which week a snapshot is filed under ----
//
// The week whose FIRST TIP-OFF has not happened yet. Every run before a
// week's first game overwrites that week's row; the first game freezes it,
// so every game in a week is graded on the same ranking, taken before any of
// them was played.
//
// Not the ratings job's "taken in week N, filed under N + 1" rule, which
// freezes a week at midnight Monday. Week 1 opens on the weekend before its
// Monday (hoops-calendar's lead-in): 2026-27 tips off with two games on
// Sunday 1 November. Under N + 1, a Saturday run is already "in week 1" and
// files under week 2, so week 1 would freeze on Thursday night. Keyed on the
// first tip, Saturday night's pull is the one that grades opening weekend.
// For every Monday-to-Sunday week the two rules agree.
//
// ---- footprint ----
//
// One GET of barttorvik.com/<season>_team_results.json per run, from
// CloudFront, no CBBD calls. Twice a day so a missed or walled run is
// retried before a week freezes.
//
// ---- failures ----
//
// Every run records a JobRun, skips included, and every failure is an error
// JobRun AND an email — the site keeps no history, so a week missed is
// graded on whatever older snapshot ranksFor falls back to. A partial
// match, a renamed school or a reshaped file is refused whole rather than
// written: hoops-ranks reads a thin week as a broken one anyway.

const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');
const { guardJob } = require('./job-guard');
const torvik = require('./torvik-import');
const { basketballLeagues } = require('./hoops-scores-job');
const HoopsGame = require('./../models/hoopsGame');
const HoopsTorvikRank = require('./../models/hoopsTorvikRank');

const JOB_NAME = 'hoops-torvik';
const LABEL = 'Hoops Torvik';

// A cancelled or postponed listing never tips, so it cannot freeze a week.
const DEAD_STATUSES = ['cancelled', 'canceled', 'postponed'];

// The week a snapshot taken now is filed under, or { skip }. Two local
// reads, no fetch.
async function targetWeek(season, now) {
    const live = { season, week: { $gte: 1 }, status: { $nin: DEAD_STATUSES } };
    const next = await HoopsGame.findOne(Object.assign({ startDate: { $gt: now } }, live), { week: 1, _id: 0 })
        .sort({ startDate: 1 }).lean();
    if (!next) {
        const any = await HoopsGame.exists({ season });
        return { skip: any ? 'no game left to tip — nothing to rank' : 'no schedule ingested' };
    }
    const started = await HoopsGame.exists(Object.assign({ week: next.week, startDate: { $lte: now } }, live));
    return { week: started ? next.week + 1 : next.week };
}

// Store one snapshot as the given week's ranks, replacing the week wholesale
// so a week never mixes two pulls.
async function writeWeek(season, week, matched, fetchedAt) {
    await HoopsTorvikRank.bulkWrite(matched.map(({ team, rating }) => ({
        updateOne: {
            filter: { season, week, teamId: team.id },
            update: { $set: { rank: rating.rank, barthag: rating.barthag, adjOE: rating.adjOE, adjDE: rating.adjDE, fetchedAt } },
            upsert: true
        }
    })), { ordered: false });
    await HoopsTorvikRank.deleteMany({ season, week, teamId: { $nin: matched.map(m => m.team.id) } });
}

// Retried once: a bulkWrite that dies partway leaves the week holding two
// pulls, and the second attempt replaces it whole or fails loudly too.
async function writeWeekWithRetry(season, week, matched, now) {
    try {
        await writeWeek(season, week, matched, now);
    } catch (first) {
        console.error(`[${JOB_NAME}] ${season} wk${week} write failed, retrying once: ${first.message}`);
        await writeWeek(season, week, matched, now);
    }
}

// One season: { written } | { skip } — throws on anything that should wake
// someone up.
async function snapshotSeason(season, now, fetchImpl) {
    const target = await targetWeek(season, now);
    if (target.skip) return { skip: target.skip };

    const { rows, url } = await torvik.fetchFromTorvik(season, { fetchImpl, inSeason: true });
    // The admin import's checks, word for word: unique dense ranks, sane
    // columns, the right way up, and every school matched to exactly one
    // team with no conference disagreement.
    const result = await torvik.check(season, rows);
    if (!result.ok) {
        const shown = result.problems.slice(0, 8).join('; ');
        const more = result.problems.length > 8 ? ` … (+${result.problems.length - 8})` : '';
        throw new Error(`${url} failed its checks — wk${target.week} not written: ${shown}${more}`);
    }

    await writeWeekWithRetry(season, target.week, result.matched, now);
    const top = [...result.matched].sort((a, b) => a.rating.rank - b.rating.rank).slice(0, 3)
        .map(m => `${m.rating.rank} ${m.team.school}`).join(', ');
    return { written: `${season} wk${target.week}: ${result.matched.length} team(s) ranked (${top})` };
}

// Wrapped so a failure BEFORE the per-season loop mails too (#574); the
// silent no-league return stays silent.
async function run({ now = new Date(), fetchImpl } = {}) {
    return guardJob({ jobName: JOB_NAME, label: LABEL, now }, state => runOnce(now, fetchImpl, state));
}

async function runOnce(now, fetchImpl, state) {
    const leagues = await basketballLeagues();
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    const startMs = Date.now();
    const when = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const written = [];
    const skipped = [];
    const failures = [];
    for (const season of [...new Set(leagues.map(l => l.season))]) {
        try {
            const out = await snapshotSeason(season, now, fetchImpl);
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

    const id = await jobLogger.startRun(JOB_NAME);
    state.id = id;
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

module.exports = { run, JOB_NAME, LABEL, targetWeek, snapshotSeason, writeWeek };
