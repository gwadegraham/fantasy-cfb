// The official NCAA NET, once a day, for basketball quadrants (#533).
//
// modules/hoops-ranks.js grades a week on the NET whenever that week has
// HoopsNetRank rows. This job is the only thing that writes them: one GET of
// ncaa.com's NET page, parsed (modules/hoops-net.js), matched to our team
// rows, and filed under a week.
//
// It is the NET twin of modules/hoops-ratings-job.js, and shares its rules
// rather than restating them:
//
//   - a snapshot taken in week N is filed under week N + 1 (targetWeek), so
//     a week's ranks freeze when the week starts and a game is graded on the
//     rank as it stood BEFORE it was played
//   - every run records a JobRun, skips included, and every failure is an
//     error JobRun AND an email — ncaa.com shows only the current ranking, so
//     a missed week is gone for good
//   - a week is replaced wholesale, and the write is retried once
//
// ---- one request a day ----
//
// NCAA.com's terms forbid reproducing its content; Graham weighed that for a
// private, non-commercial league. So the footprint is small on purpose: one
// GET a day, a user agent that says what it is, nothing fetched before
// mid-November when no NET can exist, and nothing fetched in the
// off-season.
//
// ---- before the first release ----
//
// The NET first publishes in early-to-mid December. Until then the page
// shows no table, an empty one, or LAST season's final ranking. Each of those
// is a skip that writes nothing — until it is too late in the year for
// them to be innocent (EXPECTED_BY), or until this season has already had a
// NET on file, after which each is an error.

const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');
const { easternDay, easternMidnight } = require('./hoops-calendar');
const { basketballLeagues } = require('./hoops-scores-job');
const { targetWeek, coverageFloor } = require('./hoops-ratings-job');
const { NET_URL, parseNetPage, matchNet } = require('./hoops-net');
const HoopsGame = require('./../models/hoopsGame');
const HoopsNetRank = require('./../models/hoopsNetRank');
const HoopsTeam = require('./../models/hoopsTeam');

const JOB_NAME = 'hoops-net';
const LABEL = 'Hoops NET';
const USER_AGENT = 'fantasy-cfb-net/1.0 (private non-commercial fantasy league; one request a day)';
const FETCH_TIMEOUT_MS = 30000;
const DAY_MS = 86400000;

// Month/day in the calendar year the season STARTS (CBBD's season 2027 tips
// off in November 2026). Months are 0-based, as Date.UTC takes them.
//
// FIRST_LOOK: no fetch before this. The earliest first release on record is
// late November.
// EXPECTED_BY: from here on, a page with no current-season NET is a failure,
// not the cold start. The NET has published by the first week of December
// every normal season.
const FIRST_LOOK = { month: 10, day: 15 };
const EXPECTED_BY = { month: 11, day: 20 };

// How far the table's row count may sit from the number of D-I teams on file
// before the page is presumed broken — truncated, paginated, or a different
// table. Every row must ALSO match a team, so this is about the count alone.
const ROW_TOLERANCE = 15;

// How many whole Eastern days a final game may go unreflected in the
// "Through Games" stamp. NCAA updates each morning with the day before, at a
// time we cannot see — so the measure is calendar DAYS, not hours since the
// run: games from today and the two days before it never count. That covers
// a page not yet updated when the job runs AND one missed update on top. And
// it is measured against games, not the calendar, so the Christmas break is
// not a false alarm.
const STALE_GRACE_DAYS = 2;

function seasonDate(season, { month, day }) {
    return new Date(Date.UTC(Number(season) - 1, month, day));
}

const fmtDay = (d) => d.toISOString().slice(0, 10);

// The page, or a throw. A non-200 is a failure, not an empty page.
async function fetchPage(fetchImpl) {
    const res = await fetchImpl(NET_URL, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`NET page answered HTTP ${res.status}`);
    return res.text();
}

// Store one snapshot as the given week's NET. Replaces the week wholesale,
// as hoops-ratings-job's writeWeek does, so a week never mixes two days.
async function writeWeek(season, week, rows, throughGames, fetchedAt) {
    await HoopsNetRank.bulkWrite(rows.map(({ team, row }) => ({
        updateOne: {
            filter: { season, week, teamId: team.id },
            update: {
                $set: {
                    rank: row.rank, school: row.school, record: row.record,
                    quad1: row.quad1, quad2: row.quad2, quad3: row.quad3, quad4: row.quad4,
                    throughGames, fetchedAt
                }
            },
            upsert: true
        }
    })), { ordered: false });
    await HoopsNetRank.deleteMany({ season, week, teamId: { $nin: rows.map(r => r.team.id) } });
}

async function writeWeekWithRetry(season, week, rows, throughGames, now) {
    try {
        await writeWeek(season, week, rows, throughGames, now);
    } catch (first) {
        console.error(`[${JOB_NAME}] ${season} wk${week} write failed, retrying once: ${first.message}`);
        await writeWeek(season, week, rows, throughGames, now);
    }
}

const list = (names, max = 12) => (names.length > max ? `${names.slice(0, max).join(', ')} … (+${names.length - max})` : names.join(', '));

// One season: { written } | { skip } — throws on anything that should wake
// someone up.
async function snapshotSeason(season, now, fetchImpl) {
    const target = await targetWeek(season, now);
    if (target.skip) return { skip: target.skip };
    if (now < seasonDate(season, FIRST_LOOK)) {
        return { skip: `no NET before ${fmtDay(seasonDate(season, FIRST_LOOK))} — not fetched` };
    }

    const parsed = parseNetPage(await fetchPage(fetchImpl));

    // The cold start, or a failure: which one depends on whether a NET is
    // owed by now.
    const owed = async () => (now >= seasonDate(season, EXPECTED_BY)) || !!(await HoopsNetRank.exists({ season }));
    const notYet = async (what) => {
        if (await owed()) throw new Error(`${what} — a ${season} NET is due by now`);
        return { skip: `${what} — no ${season} NET yet, wk${target.week} not written` };
    };

    if (!parsed.rows.length) return notYet(parsed.hasTable ? 'the NET table is empty' : 'no NET table on the page');
    if (!parsed.throughGames) throw new Error('NET page layout changed: no readable "Through Games" date');

    // A stamp from the future is a broken page, not a fresh one: it would
    // also make the staleness check below match nothing.
    if (parsed.throughGames > easternDay(now)) {
        throw new Error(`NET page layout changed: "Through Games" ${fmtDay(parsed.throughGames)} is after today`);
    }

    const first = await HoopsGame.findOne({ season }, { startDate: 1, _id: 0 }).sort({ startDate: 1 }).lean();
    if (parsed.throughGames < easternDay(first.startDate)) {
        return notYet(`the page is through ${fmtDay(parsed.throughGames)}, before ${season}'s first game (last season's final NET)`);
    }

    const teams = await HoopsTeam.find({ season },
        { id: 1, school: 1, shortDisplayName: 1, abbreviation: 1, conference: 1, _id: 0 }).lean();
    if (Math.abs(parsed.rows.length - teams.length) > ROW_TOLERANCE) {
        throw new Error(`the NET table has ${parsed.rows.length} row(s), but ${teams.length} D-I team(s) are on file for ${season}`);
    }
    const seen = new Set();
    const dupes = parsed.rows.filter(r => (seen.has(r.rank) ? true : (seen.add(r.rank), false))).map(r => `#${r.rank} ${r.school}`);
    if (dupes.length) throw new Error(`NET page layout changed: rank(s) repeated — ${list(dupes)}`);

    // Stale: games have gone final since the stamp and the page has not
    // caught up. Weeks of these and the "current" NET is a fossil.
    const unreflected = await HoopsGame.countDocuments({
        season, status: 'final',
        startDate: {
            $gte: easternMidnight(new Date(parsed.throughGames.getTime() + DAY_MS)),
            $lt: easternMidnight(new Date(easternDay(now).getTime() - STALE_GRACE_DAYS * DAY_MS))
        }
    });
    // Stale is an alarm either way. But a stale page can still be NEWER than
    // what the week holds — NCAA skipping a weekend's updates must not leave
    // next week graded on the even older snapshot from earlier in the week.
    // So it is written when its stamp beats the stored one, and refused only
    // when it does not.
    let stale = null;
    if (unreflected) {
        stale = `the NET is stale: through ${fmtDay(parsed.throughGames)}, but ${unreflected} game(s) before ${fmtDay(new Date(easternDay(now).getTime() - STALE_GRACE_DAYS * DAY_MS))} are not in it`;
        const stored = await HoopsNetRank.findOne({ season, week: target.week }, { throughGames: 1, _id: 0 }).lean();
        if (stored && !(stored.throughGames < parsed.throughGames)) {
            throw new Error(`${stale} — wk${target.week} already holds a NET through ${fmtDay(stored.throughGames)}, not replaced`);
        }
    }

    const m = matchNet(parsed.rows, teams);
    const refusals = [];
    if (m.unmatched.length) {
        refusals.push(`${m.unmatched.length} NET name(s) match no team — add them to data/ncaa-net-aliases.json: `
            + list(m.unmatched.map(u => (u.candidates.length ? `${u.school} (ambiguous: ${u.candidates.join(' / ')})` : u.school))));
    }
    if (m.doubleClaimed.length) {
        refusals.push(`${m.doubleClaimed.length} team(s) claimed twice: ${list(m.doubleClaimed.map(d => `${d.school} by ${d.by.join(' and ')}`))}`);
    }
    if (refusals.length) throw new Error(`${refusals.join('; ')} — wk${target.week} not written`);

    const floor = await coverageFloor(season);
    if (m.matched.length < floor) {
        throw new Error(`the NET ranked only ${m.matched.length} team(s), under the ${floor} ranksFor needs — wk${target.week} not written`);
    }

    await writeWeekWithRetry(season, target.week, m.matched, parsed.throughGames, now);
    const skippedNote = m.ignored.length ? `, ${m.ignored.length} listed as not ours: ${list(m.ignored)}` : '';
    const written = `${season} wk${target.week}: ${m.matched.length} team(s), NET through ${fmtDay(parsed.throughGames)}${skippedNote} (snapshot taken in wk${target.during})`;

    // Written, but stale: the newest NET there is, and still behind the
    // games. A failure someone has to look at.
    if (stale) throw new Error(`${written} — written, but ${stale}`);

    // Written, with a note on the JobRun — a success, no email:
    //   - a team on file with no NET rank (a school reclassifying into D-I)
    //     is graded on its CBBD/Torvik rank by ranksFor, not left unranked;
    //     notRanked in the alias file silences the note once checked
    //   - a conference disagreement: ranks do not depend on conference and
    //     matching never keys on it, but a swapped alias pair shows up here
    const warnings = [];
    if (m.unclaimed.length) {
        warnings.push(`${m.unclaimed.length} team(s) on file have no NET rank, graded on CBBD/Torvik instead: ${list(m.unclaimed)}`);
    }
    if (m.conferenceMismatches.length) {
        warnings.push(`${m.conferenceMismatches.length} conference disagreement(s), check for a swapped alias: `
            + list(m.conferenceMismatches.map(c => `${c.school} — NET says ${c.torvik}, we have ${c.cbbd}`)));
    }
    return { written: warnings.length ? `${written} — WARNING: ${warnings.join('; ')}` : written };
}

async function run({ now = new Date(), fetchImpl = fetch } = {}) {
    const leagues = await basketballLeagues();
    // No basketball at all: silent, no JobRun, like the other hoops jobs.
    if (!leagues.length) return { skippedReason: 'no basketball leagues' };

    // The page holds one season — the current one — so one season is read:
    // the latest any basketball league is on.
    const season = Math.max(...leagues.map(l => Number(l.season)));
    const startMs = Date.now();
    const when = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
    let out;
    let failure = null;
    try {
        out = await snapshotSeason(season, now, fetchImpl);
    } catch (err) {
        failure = err;
    }

    const status = failure ? 'error' : (out.written ? 'success' : 'skipped');
    const secs = Math.round((Date.now() - startMs) / 1000);
    const summary = `${failure ? `${season}: FAILED ${failure.message || failure}` : (out.written || `${season}: ${out.skip}`)} (${secs}s)`;

    // Recorded on EVERY run, skips included: "did today's NET land" has to be
    // answerable from the admin strip.
    const id = await jobLogger.startRun(JOB_NAME);
    await jobLogger.finishRun(id, status, summary);
    (failure ? console.error : console.log)(`[${JOB_NAME}] ${summary}`);

    if (failure) {
        await jobMailer.sendJobEmail({
            label: LABEL, when, ok: false,
            rows: [['Season', String(season)], ['Source', NET_URL], ['Failed after', `${secs}s`]],
            error: failure.stack || String(failure)
        });
    }
    return { status, written: out && out.written ? out.written : null, skipped: out && out.skip ? out.skip : null, failed: failure ? summary : null, summary };
}

module.exports = {
    run, JOB_NAME, LABEL, USER_AGENT, FIRST_LOOK, EXPECTED_BY, ROW_TOLERANCE, STALE_GRACE_DAYS,
    snapshotSeason, writeWeek, seasonDate
};
