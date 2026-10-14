// Basketball style tags (#542), refreshed once a day from CBBD's team
// leaderboard: "3-point heavy", "Slow pace", "Elite defense" in the draft
// pool and on the team page.
//
// ---- its own job, not part of hoops-ratings ----
//
// hoops-ratings (#318) runs twice a day, files each snapshot under NEXT week,
// skips until a schedule is ingested, and writes nothing until CBBD's ratings
// start five weeks into the season. Every one of those rules is about grading
// games at time of play. Tags want none of them: they are "how this team
// plays right now", nothing reads them by week, and in preseason — which is
// exactly when the draft happens — they come from LAST season. Bolting that
// onto the ratings job would have meant a second set of skip rules inside a
// job whose skips already mean something else.
//
// ---- one billable call a day, at most ----
//
// /stats/team/leaderboard returns all 365 teams in one call (~800 KB,
// measured 14 Oct 2026; needs Patreon Tier 2, which we have). The job
// spends:
//
//   before the season's first game      0 — last season's tags, fetched ONCE
//   in season                           1 a day
//   after the final, once it is stored  0
//
// The one exception is the first in-season day the current leaderboard is
// too thin to use, if last season's tags are not on file yet: 2 calls.
//
// ---- when the current season takes over ----
//
// A percentile over three games is noise, and CBBD's adjusted ranks may lag
// the box scores. So the current leaderboard is used once the median team
// has MIN_GAMES games AND nearly every team carries an adjusted rank. Until
// then the season shows last season's tags, and the pages say so.

const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');
const cbbd = require('./cbbd-client');
const { basketballLeagues } = require('./hoops-scores-job');
const { slimRow, tagTeams } = require('./hoops-style-tags');
const HoopsGame = require('./../models/hoopsGame');
const HoopsTeamStyle = require('./../models/hoopsTeamStyle');

const JOB_NAME = 'hoops-styles';
const LABEL = 'Hoops Style Tags';
const PATH = '/stats/team/leaderboard';

// The median team's games before its own season's numbers replace last
// season's: about three weeks in.
const MIN_GAMES = 6;
// The share of the field that must carry adjusted ranks, or the Elite tags
// would vanish and reappear as CBBD fills them in.
const MIN_RANKED = 0.9;
// The smallest field a percentile is believed over. D-I is 365; a
// leaderboard well short of that is a partial response, and a top 15% of a
// partial field is a different 15%.
const MIN_FIELD = 300;
// How long after the season's last scheduled game before a stored current
// leaderboard is taken as final and no longer refetched.
const FINAL_GRACE_MS = 3 * 86400000;

function median(values) {
    const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return 0;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Why a leaderboard cannot be used for tags yet, or null when it can.
function notReady(rows) {
    if (rows.length < MIN_FIELD) return `only ${rows.length} team(s) on the leaderboard`;
    const games = median(rows.map(r => r.games));
    if (games < MIN_GAMES) return `the median team has played ${games} game(s), tags wait for ${MIN_GAMES}`;
    const ranked = rows.filter(r => r.offRank != null && r.defRank != null).length;
    if (ranked < rows.length * MIN_RANKED) return `adjusted ranks on only ${ranked} of ${rows.length} team(s)`;
    return null;
}

async function fetchRows(fromSeason) {
    const { data } = await cbbd.cbbdGet(PATH, { season: fromSeason });
    const rows = data.map(slimRow).filter(Boolean);
    // Rows came back and none had a team id: the response shape changed.
    if (data.length && !rows.length) {
        throw new Error(`CBBD returned ${data.length} leaderboard row(s) for ${fromSeason} with no teamId — the response shape changed`);
    }
    return rows;
}

// Replace a season's rows wholesale, so the tags never mix two leaderboards.
async function writeSeason(season, fromSeason, rows, fetchedAt) {
    const tags = tagTeams(rows);
    await HoopsTeamStyle.bulkWrite(rows.map(r => ({
        updateOne: {
            filter: { season, teamId: r.teamId },
            update: { $set: Object.assign({}, r, { fromSeason, tags: tags.get(r.teamId) || [], fetchedAt }) },
            upsert: true
        }
    })), { ordered: false });
    await HoopsTeamStyle.deleteMany({ season, teamId: { $nin: rows.map(r => r.teamId) } });
}

async function writeSeasonWithRetry(season, fromSeason, rows, now) {
    try {
        await writeSeason(season, fromSeason, rows, now);
    } catch (first) {
        console.error(`[${JOB_NAME}] ${season} write failed, retrying once: ${first.message}`);
        await writeSeason(season, fromSeason, rows, now);
    }
}

const tagged = (rows) => [...tagTeams(rows).values()].filter(t => t.length).length;

// One season: { written } | { skip } — throws on a CBBD or write failure.
async function refreshSeason(season, now) {
    const [stored, first, last] = await Promise.all([
        HoopsTeamStyle.findOne({ season }, { fromSeason: 1, fetchedAt: 1, _id: 0 }).sort({ fetchedAt: -1 }).lean(),
        HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: 1 }).lean(),
        HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: -1 }).lean()
    ]);

    let why = first ? `${season} has not tipped off` : `no ${season} schedule ingested`;
    if (first && now >= new Date(first.startDate)) {
        const end = last ? new Date(last.startDate).getTime() : null;
        if (stored && stored.fromSeason === season && end != null
            && now.getTime() > end + FINAL_GRACE_MS && new Date(stored.fetchedAt).getTime() > end + 86400000) {
            return { skip: `${season}: the final leaderboard is on file — not fetched` };
        }
        const rows = await fetchRows(season);
        why = notReady(rows);
        if (!why) {
            await writeSeasonWithRetry(season, season, rows, now);
            return { written: `${season}: ${rows.length} team(s), ${tagged(rows)} tagged, from the ${season} leaderboard` };
        }
        // Once the season's own tags are showing, a thin leaderboard is a
        // regression, not the cold start — and falling back would quietly
        // swap every page back to last year's teams.
        if (stored && stored.fromSeason === season) {
            throw new Error(`the ${season} leaderboard is in use, but today ${why} — stored tags kept`);
        }
    }

    const prev = season - 1;
    if (stored && stored.fromSeason === prev) {
        return { skip: `${season}: ${why} — ${prev} tags already on file, not fetched` };
    }
    const rows = await fetchRows(prev);
    const prevWhy = notReady(rows);
    if (prevWhy) throw new Error(`${season}: ${why}, and last season's (${prev}) leaderboard is unusable: ${prevWhy}`);
    await writeSeasonWithRetry(season, prev, rows, now);
    return { written: `${season}: ${why} — ${rows.length} team(s), ${tagged(rows)} tagged, from LAST season's ${prev} leaderboard` };
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
    for (const season of [...new Set(leagues.map(l => Number(l.season)))]) {
        try {
            const out = await refreshSeason(season, now);
            if (out.written) written.push(out.written);
            else skipped.push(out.skip);
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
    await jobLogger.finishRun(id, status, summary);
    (failures.length ? console.error : console.log)(`[${JOB_NAME}] ${summary}`);

    // Mailed, unlike a quiet skip: a failure here leaves the draft pool on
    // stale or missing tags, and nobody looks at tags to notice.
    if (failures.length) {
        await jobMailer.sendJobEmail({
            label: LABEL, when, ok: false,
            rows: [['Seasons failed', failures.map(f => String(f.season)).join(', ')], ['Failed after', `${secs}s`]],
            error: failures.map(f => (f.err && f.err.stack) || String(f.err)).join('\n\n')
        });
    }
    return { status, written, skipped, failed: failures.length ? summary : null, summary };
}

module.exports = { run, JOB_NAME, LABEL, PATH, MIN_GAMES, MIN_RANKED, MIN_FIELD, refreshSeason, notReady, writeSeason, median };
