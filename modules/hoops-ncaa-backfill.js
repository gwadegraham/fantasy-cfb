// Past NCAA tournaments into hoopsgames, for the March Madness bracket page's
// season switcher (routes/hoopsBracket.js offers a season only once its
// tournament games are stored).
//
// The nightly ingest only ever holds the active season, so prod had no past
// bracket to show. This fills them once, on demand: one billable CBBD call per
// season (/games?tournament=NCAA — about 67 rows, far under the 3000 cap), and
// zero for a season already stored in full.
//
// Past seasons only. The active season's tournament arrives through the
// normal schedule/refresh jobs, and backfilling it here would race them.
//
// The write is routes/hoopsGames.js's own upsert, so a backfilled row is the
// same shape the season ingest writes and a later full ingest updates it in
// place rather than duplicating it.
//
// Each season's teams come too (one more call): without a hoopsteams row for
// the season, a past game's page has no logo, colours or team link. Written
// through routes/hoopsTeams.js's upsert and logo probe, keyed on (id, season),
// so the active season's rows are never touched.

const cbbd = require('./cbbd-client');
const seasons = require('./active-season');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const hoopsGames = require('../routes/hoopsGames');
const hoopsTeams = require('../routes/hoopsTeams');

const NCAA = 'NCAA';
// A full field of 68 plays 67 games; the 76-team field (2027 on) plays 75.
// Below this a stored season is partial and gets fetched again.
const FULL_TOURNAMENT = 67;
// D-I has had 350+ teams every season since 2011; fewer stored is partial.
const FULL_TEAMS = 350;

async function storedCount(season) {
    return HoopsGame.countDocuments({ season, tournament: NCAA, status: 'final' });
}

// One season. Returns { season, status, fetched, written, calls }, where status
// is 'stored' (already complete, nothing spent), 'written', or 'dry-run'.
async function backfillSeason(season, { force = false, dryRun = false } = {}) {
    const before = await storedCount(season);
    if (!force && before >= FULL_TOURNAMENT) {
        return { season, status: 'stored', fetched: 0, written: 0, calls: 0, stored: before };
    }

    const { data, remainingCalls } = await cbbd.cbbdGet('/games', { season, seasonType: 'postseason', tournament: NCAA });
    // CBBD ignores a parameter it does not know rather than rejecting it, so
    // check the filter held: anything but NCAA rows means the response is not
    // what this script thinks it is.
    const games = data.filter(g => g && g.tournament === NCAA);
    if (games.length !== data.length) {
        throw new Error(`${season}: CBBD returned ${data.length - games.length} non-NCAA rows — the tournament filter did not hold; nothing written.`);
    }
    // The rows are written under their OWN season, so one from another season
    // would land there while the week stamping below targets this one.
    const elsewhere = games.filter(g => Number(g.season) !== season).length;
    if (elsewhere) throw new Error(`${season}: ${elsewhere} rows are from another season — the season filter did not hold; nothing written.`);
    if (!games.length) throw new Error(`${season}: CBBD returned no NCAA tournament games; nothing written.`);
    if (games.length >= cbbd.PAGE_CAP) throw new Error(`${season}: CBBD returned ${games.length} rows, the page cap; nothing written.`);
    const unfinished = games.filter(g => g.status !== 'final').length;
    if (unfinished) throw new Error(`${season}: ${unfinished} of ${games.length} tournament games are not final — not a past tournament; nothing written.`);

    const out = { season, fetched: games.length, calls: 1, remainingCalls, stored: before };
    if (dryRun) return Object.assign(out, { status: 'dry-run', written: 0 });

    const { seasonStart, moved } = await hoopsGames.resolveSeasonStart(season, games);
    const ops = await hoopsGames.keepStoredFinals(games.map(g => hoopsGames.buildUpsertOp(g, seasonStart)).filter(Boolean));
    const res = await HoopsGame.bulkWrite(ops, { ordered: false });
    if (moved && seasonStart) await hoopsGames.restampSeason(season, seasonStart);
    return Object.assign(out, { status: 'written', written: (res.upsertedCount || 0) + (res.matchedCount || 0) });
}

// The active basketball season, or a throw. Number(null) is 0, which would
// pass every "is this a past season" check, so null is refused first.
function activeSeason() {
    const raw = seasons.activeSeason('basketball');
    const active = raw == null ? NaN : Number(raw);
    if (!Number.isInteger(active)) throw new Error('No active basketball season — prime the season cache first.');
    return active;
}

// One season's D-I teams. Same return shape as backfillSeason.
async function backfillTeams(season, { force = false, dryRun = false } = {}) {
    const before = await HoopsTeam.countDocuments({ season });
    if (!force && before >= FULL_TEAMS) {
        return { season, status: 'stored', fetched: 0, written: 0, calls: 0, stored: before };
    }
    const { data, remainingCalls } = await cbbd.fetchTeams(season);
    if (data.length < FULL_TEAMS) throw new Error(`${season}: CBBD returned ${data.length} teams, expected ${FULL_TEAMS}+; nothing written.`);
    const out = { season, fetched: data.length, calls: 1, remainingCalls, stored: before };
    if (dryRun) return Object.assign(out, { status: 'dry-run', written: 0 });

    // Which logos load, before any is stored (free: a CDN request, not a
    // CBBD call). A failed probe stores no logos rather than broken ones.
    let haveLogo;
    try {
        haveLogo = await cbbd.logoUrlsThatExist(data.filter(t => !hoopsTeams.overrideFor(t)).map(t => hoopsTeams.probeUrl(hoopsTeams.apiLogos(t))));
    } catch (err) {
        haveLogo = new Set();
    }
    const ops = data.map(t => hoopsTeams.buildUpsertOp(t, season, haveLogo)).filter(Boolean);
    const res = await HoopsTeam.bulkWrite(ops, { ordered: false });
    return Object.assign(out, { status: 'written', written: (res.upsertedCount || 0) + (res.matchedCount || 0) });
}

// Seasons in ascending order; refuses the active season and anything later.
async function backfill(list, opts = {}) {
    const active = activeSeason();
    const bad = list.filter(s => !Number.isInteger(s) || s >= active);
    if (bad.length) throw new Error(`Past seasons only (the active basketball season is ${active}): ${bad.join(', ')}`);
    const results = [];
    for (const season of [...new Set(list)].sort((a, b) => a - b)) {
        const games = await backfillSeason(season, opts);
        results.push(Object.assign(games, { teams: await backfillTeams(season, opts) }));
    }
    return results;
}

// The last `n` seasons before the active one: 3 in the 2027 season is
// 2024, 2025, 2026.
function lastSeasons(n) {
    const active = activeSeason();
    return Array.from({ length: n }, (_, i) => active - n + i);
}

module.exports = { backfill, backfillSeason, backfillTeams, lastSeasons, FULL_TOURNAMENT, FULL_TEAMS };
