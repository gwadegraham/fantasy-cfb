// Stamping Torvik's preseason T-Rank onto a season's basketball teams (#320,
// #544): every check, the write, and the lock. Shared by the CLI
// (scripts/import-torvik-preseason.js) and the admin card (routes/hoopsAdmin.js)
// so the two cannot drift — a check added to one and not the other is how a
// paste of 183 rows all claiming rank 1 got imported once already.
//
// modules/torvik-pool.js stays pure (parse, match, cross-check). This module
// is the half that reads and writes Mongo.
//
// ---- what can be fed in ----
//
// Measured 14 Oct 2026, not assumed:
//
//   barttorvik.com/trank.php      a server GET gets a 429-byte "Verifying
//                                 Browser..." page that needs JavaScript to
//                                 pass. Not something to work around.
//   barttorvik.com/2027_team_results.json
//                                 served plainly from CloudFront, 365 rows,
//                                 updated daily. Its names are the SAME 365
//                                 strings parseTRank pulls from the page's
//                                 team.php links, so matchTeams needs no new
//                                 alias. This is what Fetch reads.
//   a browser copy of the table   PLAIN TEXT. A <textarea> only ever receives
//                                 text/plain, so the team.php links parseTRank
//                                 keys on are gone. Refused with a pointer to
//                                 the two pastes that do work.
//
// So the paste box takes the JSON file's text (open the URL, select all, copy)
// or the page's HTML source, and Fetch makes the paste unnecessary unless
// barttorvik starts walling the JSON too.

const HoopsTeam = require('../models/hoopsTeam');
const League = require('../models/league');
const Franchise = require('../models/franchise');
const { seasonHasScoring } = require('../public/season-scoring');
const { parseTRank, matchTeams, conferenceMismatches } = require('./torvik-pool');

const jsonUrlFor = (season) => `https://barttorvik.com/${season}_team_results.json`;

// The draft pool is the top POOL of the ranking (modules/draft-defaults.js).
// Preview shows who crosses that line, because that is the change a refresh
// actually makes to the draft.
const POOL = require('./draft-defaults').BY_SPORT.basketball.poolSize;

// Everything that has to be true of a rating set before it can rank a draft.
//
// These used to live only in the spec, hard-wired to the committed file — so
// --file, the path that produces NEXT year's data, skipped all of them. A
// paste where 183 rows all claimed rank 1 imported cleanly and printed a
// plausible top ten.
function problemsWith(rows) {
    const bad = [];
    const ranks = rows.map(r => r.rank);

    // A reordered column would swap AdjOE and AdjDE without changing the row
    // count. The bands are generous: the real spread across 365 teams is
    // 87.8-121.3.
    for (const r of rows) {
        if (!Number.isFinite(r.rank) || !r.school) bad.push(`malformed row: ${JSON.stringify(r)}`);
        else if (!(r.adjOE > 70 && r.adjOE < 140)) bad.push(`${r.school}: adjOE ${r.adjOE} out of range`);
        else if (!(r.adjDE > 70 && r.adjDE < 140)) bad.push(`${r.school}: adjDE ${r.adjDE} out of range`);
        else if (!(r.barthag >= 0 && r.barthag <= 1)) bad.push(`${r.school}: barthag ${r.barthag} out of range`);
        else if (!/^\d+-\d+$/.test(String(r.projectedRecord))) bad.push(`${r.school}: projected record "${r.projectedRecord}"`);
    }

    // RANK IS THE POOL. A duplicated or missing rank is the one corruption
    // that still looks entirely normal in every other column.
    if (new Set(ranks).size !== ranks.length) bad.push(`ranks are not unique (${ranks.length} rows, ${new Set(ranks).size} distinct)`);
    const sorted = [...ranks].sort((a, b) => a - b);
    if (sorted[0] !== 1 || sorted[sorted.length - 1] !== ranks.length) {
        bad.push(`ranks run ${sorted[0]}..${sorted[sorted.length - 1]} across ${ranks.length} rows — expected 1..${ranks.length}`);
    }
    if (new Set(rows.map(r => r.school)).size !== rows.length) bad.push('a school is named more than once');

    // And the right way up: barthag is win probability, so it falls as the
    // rank number rises. Catches a reversed sort, which otherwise ranks the
    // worst 120 teams as the draft pool.
    const best = rows.find(r => r.rank === 1);
    const worst = rows.find(r => r.rank === ranks.length);
    if (best && worst) {
        if (!(best.barthag > worst.barthag)) {
            bad.push(`rank 1 (${best.school}, barthag ${best.barthag}) is not stronger than rank ${ranks.length} (${worst.school}, ${worst.barthag}) — the sort may be reversed`);
        }
        // AdjOE and AdjDE occupy adjacent cells and share a plausible range,
        // so exchanging them passes every band check above and simply inverts
        // the pool. The best team scores MORE and concedes LESS than the
        // worst; that asymmetry is what tells the two columns apart.
        if (!(best.adjOE > worst.adjOE) || !(best.adjDE < worst.adjDE)) {
            bad.push(`rank 1 (${best.school}: OE ${best.adjOE}, DE ${best.adjDE}) does not outscore and outdefend rank ${ranks.length} (${worst.school}: OE ${worst.adjOE}, DE ${worst.adjDE}) — the two columns may be swapped`);
        }
    }
    return bad;
}

// Torvik's {season}_team_results.json, as rating rows.
//
// Positional arrays with no header, so the indexes are pinned here and were
// checked against the 30 Sep page paste: all 365 names identical, [0] equal to
// the page rank on every row, [10]/[11] rounding to the page's projected
// record. [0] is the rank, [1] team, [2] conference, [3] the CURRENT record,
// [4] AdjOE, [6] AdjDE, [8] barthag, [10]/[11] projected wins/losses.
//
// Not trusted beyond that: the caller still runs problemsWith(), whose
// column-swap and reversed-sort checks are exactly what a moved index trips.
//
// `inSeason` is the weekly snapshot job (modules/hoops-torvik-job.js), the
// one reader that WANTS a ranking with results in it. Checked against
// 2026_team_results.json after that season: same indexes, [3] the record.
function parseTorvikJson(data, { inSeason = false } = {}) {
    if (!Array.isArray(data)) throw new Error('the JSON is not a list of teams');
    // Once games are played this same file holds IN-SEASON ratings. They are
    // not preseason ones, and stamping them as preseason would quietly rank
    // the draft (and seed quadrant scoring) on a week of results.
    const played = inSeason ? [] : data.filter(r => Array.isArray(r) && r[3] && r[3] !== '0-0');
    if (played.length) {
        throw new Error(`${played.length} team(s) already have a record (${played[0][1]} is ${played[0][3]}) — these are in-season ratings, not preseason`);
    }
    return data.map(r => (Array.isArray(r) ? {
        rank: r[0],
        school: r[1],
        conference: r[2],
        adjOE: round(r[4], 1),
        adjDE: round(r[6], 1),
        barthag: round(r[8], 4),
        projectedRecord: `${Math.round(r[10])}-${Math.round(r[11])}`
    } : { rank: NaN, school: null }));
}

// To the precision the page prints, so a fetched set and a pasted one store
// the same numbers.
function round(x, dp) {
    const k = 10 ** dp;
    return Math.round(Number(x) * k) / k;
}

// Whatever the admin pasted, as rating rows. Three things are accepted; the
// fourth (a browser copy of the table, which is plain text) is recognised and
// refused with directions rather than left to fail as "0 rows".
//
// Returns { format, rows }. Throws a message meant for the admin.
function parsePaste(text) {
    const s = String(text || '').trim();
    if (!s) throw new Error('nothing was pasted');

    if (s[0] === '[' || s[0] === '{') {
        let data;
        try { data = JSON.parse(s); } catch (err) {
            throw new Error(`that looks like JSON but does not parse (${err.message}) — was all of it copied?`);
        }
        // Our own shape: the committed data/torvik-preseason-*.json file.
        // It names its season; the caller refuses one that is not the season
        // being imported, or last year's file ranks this year's pool.
        if (data && !Array.isArray(data) && Array.isArray(data.teams)) return { format: 'file', rows: data.teams, season: data.season };
        return { format: 'json', rows: parseTorvikJson(data) };
    }

    if (/<tr[\s>]/i.test(s)) {
        const rows = parseTRank(s);
        if (!rows.length) throw new Error('that HTML has no T-Rank table rows with team links in it');
        return { format: 'html', rows };
    }

    throw new Error('that is copied text, which loses the team links the import matches on. Paste the JSON from ' +
        'barttorvik.com/<season>_team_results.json (open it, select all, copy) or the page source instead — or use Fetch.');
}

// The server fetches the JSON itself. The fetcher is injectable so a test
// never touches the network.
async function fetchFromTorvik(season, { fetchImpl = global.fetch, timeoutMs = 15000, inSeason = false } = {}) {
    const url = jsonUrlFor(season);
    let res;
    try {
        res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
        throw new Error(`could not reach ${url} (${err.message}) — paste it instead`);
    }
    const body = await res.text();
    if (!res.ok) throw new Error(`${url} answered ${res.status} — paste it instead`);
    // The wall barttorvik puts in front of its pages answers 200 with HTML.
    if (!/^\s*\[/.test(body)) throw new Error(`${url} answered with a web page, not data (it may be blocking servers now) — open it in a browser and paste it instead`);
    return { rows: parseTorvikJson(JSON.parse(body), { inSeason }), url };
}

// True once ANY basketball league has banked points in `season`. After that a
// new preseason rank changes the quadrant rank of games not yet played, mid
// season, so the write is locked.
//
// The same test the rest of the app uses for "has this season been played"
// (public/season-scoring.js): a non-zero week, never the existence of a
// weekly entry, which the scoring job seeds at zero before tip-off.
//
// Fails CLOSED on an unusable season, as modules/season-status.js does.
async function seasonUnderway(season) {
    const n = Number(season);
    if (!Number.isFinite(n) || n === 0) return true;
    const leagues = await League.distinct('code', { sport: 'basketball' });
    if (!leagues.length) return false;
    const franchises = await Franchise.find(
        { league: { $in: leagues }, 'seasons.season': n },
        { 'seasons.season': 1, 'seasons.weeklyScore.score': 1 }
    ).lean();
    return seasonHasScoring(franchises, n);
}

// What the season carries now: how many teams are ranked, from which import,
// and its top of the table.
async function current(season) {
    const [teams, ranked, latest, sources] = await Promise.all([
        HoopsTeam.countDocuments({ season }),
        HoopsTeam.find({ season, 'preseason.rank': { $exists: true } },
            { school: 1, conference: 1, 'preseason.rank': 1, _id: 0 }).sort({ 'preseason.rank': 1 }).lean(),
        HoopsTeam.findOne({ season, 'preseason.importedAt': { $exists: true } },
            { 'preseason.source': 1, 'preseason.importedAt': 1, _id: 0 }).sort({ 'preseason.importedAt': -1 }).lean(),
        HoopsTeam.distinct('preseason.source', { season })
    ]);
    return {
        teams,
        ranked: ranked.length,
        source: latest ? latest.preseason.source : null,
        importedAt: latest ? latest.preseason.importedAt : null,
        // More than one means a partial import left two sets side by side.
        sources: sources.filter(Boolean).length,
        ranks: ranked.map(t => ({ rank: t.preseason.rank, school: t.school, conference: t.conference }))
    };
}

// Every check, in the order the script has always run them. Nothing written.
//
// Returns { ok, problems, matched, ... }. `problems` is a list of one-line
// reasons, the same lines the CLI prints.
async function check(season, ratings) {
    const out = { ok: false, problems: [], ratings: ratings.length, teams: 0, matched: [] };
    if (!ratings.length) {
        out.problems.push('parsed 0 rating rows — check the paste actually contains the T-Rank table');
        return out;
    }
    const bad = problemsWith(ratings);
    if (bad.length) {
        out.problems.push(...bad.map(b => `BAD  ${b}`));
        return out;
    }

    const teams = await HoopsTeam.find({ season }, { id: 1, school: 1, conference: 1 }).lean();
    out.teams = teams.length;
    if (!teams.length) {
        out.problems.push(`no hoopsteams rows for season ${season} — run the teams ingest first`);
        return out;
    }

    const { matched, unmatched, doubleClaimed, unclaimed } = matchTeams(ratings, teams);
    out.matched = matched;
    for (const u of unmatched) out.problems.push(`UNMATCHED  ${u.school} (looked for "${u.wanted}", ${u.candidates} candidates)`);
    for (const d of doubleClaimed) out.problems.push(`DOUBLE     ${d.school} claimed by ${d.by.join(' and ')}`);
    for (const u of unclaimed) out.problems.push(`NO RATING  ${u}`);
    if (out.problems.length) {
        out.problems.push('add the missing names to NAME_ALIASES in modules/torvik-pool.js');
        return out;
    }

    // The bijection above is satisfied by a SWAPPED pair of aliases, which is
    // the only way left to get a silently mis-rated pool. Two swapped schools
    // almost always sit in different leagues, and that lands here.
    for (const d of conferenceMismatches(matched)) {
        out.problems.push(`CONFERENCE  ${d.school}: torvik says ${d.torvik} (= ${d.expected}), we have ${d.cbbd}`);
    }
    if (out.problems.length) {
        out.problems.push('check these are not a swapped pair of aliases, then record them in KNOWN_CONFERENCE_DRIFT');
        return out;
    }
    out.ok = true;
    return out;
}

// Current against new, for the admin to eyeball before writing: both top
// 25s, who enters and leaves the draft pool, and the biggest movers among
// teams in or near it.
function compare(currentRanks, matched, { top = 25, movers = 10 } = {}) {
    const was = new Map(currentRanks.map(t => [t.school, t.rank]));
    const next = [...matched]
        .map(m => ({ school: m.team.school, conference: m.team.conference, rank: m.rating.rank,
            was: was.has(m.team.school) ? was.get(m.team.school) : null }))
        .sort((a, b) => a.rank - b.rank);
    const nowIn = new Set(next.filter(t => t.rank <= POOL).map(t => t.school));
    const wasIn = new Set(currentRanks.filter(t => t.rank <= POOL).map(t => t.school));
    return {
        pool: POOL,
        currentTop: currentRanks.slice(0, top),
        newTop: next.slice(0, top),
        // Only meaningful when there IS a current set to compare against.
        joinsPool: currentRanks.length ? next.filter(t => t.rank <= POOL && !wasIn.has(t.school)) : [],
        leavesPool: currentRanks.length
            ? next.filter(t => wasIn.has(t.school) && !nowIn.has(t.school)) : [],
        movers: next
            .filter(t => t.was != null && (t.rank <= POOL || t.was <= POOL) && t.rank !== t.was)
            .sort((a, b) => Math.abs(b.rank - b.was) - Math.abs(a.rank - a.was) || a.rank - b.rank)
            .slice(0, movers)
    };
}

// The write, then the count that says whether it all landed.
//
// Throws on a partial write with the number that landed on err.partial, and on
// a short stamp count — the same two refusals the script has always made.
async function apply(season, matched, source) {
    const importedAt = new Date().toISOString();
    const ops = matched.map(({ team, rating }) => ({
        updateOne: {
            filter: { season, school: team.school },
            update: { $set: { preseason: {
                rank: rating.rank, adjOE: rating.adjOE, adjDE: rating.adjDE,
                barthag: rating.barthag, projectedRecord: rating.projectedRecord,
                source, importedAt
            } } }
        }
    }));
    // ordered:false keeps going past a rejected op, so a failure here means a
    // PARTIAL import. Rethrowing the raw driver error loses the one number the
    // operator needs: how many rows actually landed.
    let res;
    try {
        res = await HoopsTeam.bulkWrite(ops, { ordered: false });
    } catch (err) {
        const partial = err.result ? err.result.nModified : 0;
        const e = new Error(`PARTIAL IMPORT: ${partial} of ${ops.length} rows written before the failure (${err.message}). ` +
            'The pool is half-ranked. Fix the cause and re-run — the write is idempotent, so repeating it is safe.');
        e.partial = partial;
        throw e;
    }

    const [stamped, teams] = await Promise.all([
        HoopsTeam.countDocuments({ season, 'preseason.rank': { $exists: true } }),
        HoopsTeam.countDocuments({ season })
    ]);
    const out = { written: res.modifiedCount, matched: res.matchedCount, stamped, teams, source, importedAt };
    if (stamped !== teams) {
        const e = new Error(`${teams - stamped} team(s) still have no preseason rank (${stamped} / ${teams})`);
        e.result = out;
        throw e;
    }
    return out;
}

module.exports = {
    POOL, jsonUrlFor,
    problemsWith, parseTorvikJson, parsePaste, fetchFromTorvik,
    seasonUnderway, current, check, compare, apply
};
