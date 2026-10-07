// Basketball team ingest (#317, Hardwood B4).
//
// A parallel tree to routes/teams.js, same reasoning as routes/hoopsGames.js.

const express = require('express');
const router = express.Router();
const HoopsTeam = require('../models/hoopsTeam');
const cbbd = require('../modules/cbbd-client');
const { activeSeason } = require('../modules/active-season');
// Namespaces, not destructures, so a test can stand in for them.
const seasons = require('../modules/active-season');
const leagueSelection = require('../modules/league-selection');
const teamPage = require('../modules/hoops-team-page');

// Basketball logos come from ESPN's CDN, keyed on sourceId — which IS the ESPN
// id, so no mapping is invented, only the image host is borrowed.
//
// ⚠️ THIS IS A STOPGAP WITH A KNOWN DESTINATION. The CBBD maintainer confirmed
// the API returns no logos for basketball teams anywhere today, and has a
// ticket open for future support. When that ships, this function is the only
// thing that changes — edit it and re-run POST /hoops/teams/:season/ingest.
// No migration, no schema change.
//
// Why not CFBD's CDN, which football already uses. Measured across all 365
// teams for 2027:
//
//   cdn.collegefootballdata.com/logos/     (sourceId)  264/365
//   cdn.collegefootballdata.com/cbb-logos/ (CBB id)    251/365
//   both paths combined                                339/365
//   a.espncdn.com/i/teamlogos/ncaa/        (sourceId)  365/365
//
// Both CFBD paths are partial mirrors — /logos only covers schools with a
// football programme, and cbb-logos misses 26 including Gonzaga and Xavier
// (403 at every size) and has no dark variants at all. ESPN is the origin the
// ids belong to, and has both light and dark for every team.
//
// ⚠️ ESPN SERVES ONE SIZE: 500, light and dark. Every other size 404s —
// measured on Gonzaga across 256/128/96/64/48/32/16, all missing in both
// variants. Football's 16-entry ladder (eight sizes) does NOT exist here.
//
// Copying that ladder anyway would have reproduced the original bug exactly:
// 14 of every 16 URLs dead. Two entries is the honest answer, and pickLogo
// handles a short array fine — it filters by the dark preference, takes the
// largest, and falls back to the whole list when the preferred variant is
// absent.
const LOGO_SIZES = [500];
const ESPN_LOGOS = 'https://a.espncdn.com/i/teamlogos/ncaa';
function logosFor(sourceId) {
    if (!sourceId) return [];
    const out = [];
    LOGO_SIZES.forEach(size => {
        out.push(`${ESPN_LOGOS}/${size}/${sourceId}.png`);
        out.push(`${ESPN_LOGOS}/${size}-dark/${sourceId}.png`);
    });
    return out;
}

// CBBD sends colours as bare hex — "037961", not "#037961" — while every
// renderer in public/ and every stored football row expects the prefix. Adding
// it here means a hoops colour is interchangeable with a football one.
//
// Idempotent, so a value that already has the prefix is left alone rather than
// becoming '##037961' the first time CBBD changes its mind.
function withHash(c) {
    if (typeof c !== 'string' || !c.trim()) return undefined;
    const v = c.trim();
    return v.startsWith('#') ? v.toLowerCase() : `#${v.toLowerCase()}`;
}

// `haveLogo` is the set of sourceIds the CDN actually serves. Passing it in
// rather than synthesising blindly is the whole of finding #1: 101 of 365 teams
// have no logo there and were being given 16 URLs that all 403.
function buildUpsertOp(t, season, haveLogo) {
    if (!t || t.id == null) return null;
    const hasLogo = haveLogo ? haveLogo.has(String(t.sourceId)) : false;
    const doc = {
        id: t.id,
        season,
        sourceId: t.sourceId == null ? undefined : String(t.sourceId),
        school: t.school,
        mascot: t.mascot,
        abbreviation: t.abbreviation,
        displayName: t.displayName,
        shortDisplayName: t.shortDisplayName,
        color: withHash(t.primaryColor),
        alt_color: withHash(t.secondaryColor),
        logos: hasLogo ? logosFor(t.sourceId) : [],
        conferenceId: t.conferenceId,
        conference: t.conference,
        currentVenueId: t.currentVenueId,
        currentVenue: t.currentVenue,
        currentCity: t.currentCity,
        currentState: t.currentState
    };
    // A row with no school is unusable — it is the human-facing key the Torvik
    // pool import will match on — so it is skipped rather than stored blank.
    if (!doc.school) return null;

    // A field CBBD STOPS sending must be removed, not left behind. Deleting the
    // key from $set only skips it, so a team whose wrong secondary colour is
    // corrected upstream keeps the wrong value forever and no re-run clears it.
    // 34 of 365 already have no secondaryColor, so this is the common path.
    const unset = {};
    Object.keys(doc).forEach(k => {
        if (doc[k] === undefined || doc[k] === null) { delete doc[k]; unset[k] = ''; }
    });
    const update = { $set: doc };
    if (Object.keys(unset).length) update.$unset = unset;

    // Keyed on (id, season): /teams answers for any season and 27 teams change
    // conference between 2026 and 2027, so an id-only key let the wrong season
    // silently rewrite the live rows.
    return { updateOne: { filter: { id: t.id, season }, update, upsert: true } };
}

// Ingest every D-I team for a season. One CBBD call; safe to re-run.
router.post('/:season/ingest', async (req, res) => {
  // Everything inside ONE try. An async handler that throws before its first
  // try sends NO RESPONSE AT ALL — Express 4 does not route the rejection — so
  // the request hangs rather than failing. That is what
  // `require('../modules/active-season')` instead of destructuring it did here:
  // activeSeason was the module object, calling it was a TypeError, and every
  // route test timed out at 20s with no error to read. Same shape as the
  // PATCH /users/draft/:id hang fixed in #461.
  try {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);

    // ⚠️ THE EMPTY-LIST GUARD USED HERE WAS DEAD CODE.
    //
    // It was copied from routes/hoopsGames.js, whose comment says the wrong
    // season number returns 200 with []. That is true of /games and FALSE of
    // /teams: season=2026 returns 365 teams, so the guard could never fire for
    // the off-by-one it named. Even season=1900 returns 40 rows.
    //
    // Nothing in the response identifies its season, so the check has to be on
    // the INPUT. The stored basketball season is the authority (CBBD numbers a
    // split season by its ENDING year — 2026-27 is 2027), and a deliberate
    // backfill of another season says so with ?force=1.
    const expected = activeSeason('basketball');
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!force && Number.isFinite(expected) && season !== expected) {
        return res.status(422).json({
            message: `Season ${season} is not the stored basketball season (${expected}). `
                + 'CBBD numbers a split season by its ENDING year — the 2026-27 season is 2027 — '
                + 'and /teams answers for ANY season, so a wrong number silently rewrites '
                + `${'conference'} data rather than erroring. Pass ?force=1 to ingest it anyway.`,
            requested: season, expected
        });
    }

    let result;
    try {
        result = await cbbd.fetchTeams(season);
    } catch (err) {
        // fetch REJECTS on a network failure and Express 4 does not route an
        // async handler's rejection — an unguarded throw takes the dyno down.
        // Don't collapse every upstream status into 400. A 429 (quota) or a CBBD
        // 500 reported as "bad request" points debugging at the wrong side.
        const code = err.unreachable ? 502 : (err.status >= 500 || err.status === 429 ? 502 : 400);
        console.log(`Hoops team ingest failed: ${err.message}`);
        return res.status(code).json({ message: err.message, upstreamStatus: err.status || null });
    }

    // Still worth refusing, but as a shape check rather than a season check —
    // /teams has never returned [] for any season tried, so an empty answer
    // means something changed upstream.
    if (!result.data.length) {
        return res.status(500).json({
            message: `CBBD returned no teams at all for season ${season}, which it has never `
                + 'done for any season — the endpoint or its contract changed.'
        });
    }

    // Which logos actually exist, before any are stored. Free (a CDN request,
    // not a CBBD call) and batched.
    let haveLogo;
    try {
        haveLogo = await cbbd.logoIdsThatExist(result.data.map(t => t.sourceId));
    } catch (err) {
        console.log(`Hoops team ingest: logo probe failed (${err.message}) — storing no logos`);
        haveLogo = new Set();
    }

    const ops = result.data.map(t => buildUpsertOp(t, season, haveLogo)).filter(Boolean);
    if (!ops.length) {
        return res.status(500).json({
            message: `CBBD returned ${result.data.length} team(s) for season ${season}, none of `
                + 'which carried an id and a school — the response shape changed.'
        });
    }

    // Counts off the WRITE RESULT, and matchedCount rather than modifiedCount —
    // see the note in routes/hoopsGames.js. An unchanged team modifies nothing
    // and would otherwise read as a partial failure on every re-run.
    let created = 0, updated = 0, failure = null;
    try {
        const write = await HoopsTeam.bulkWrite(ops, { ordered: false });
        created = write.upsertedCount || 0;
        updated = write.matchedCount || 0;
    } catch (err) {
        const partial = (err && err.result) || null;
        created = partial ? (partial.upsertedCount || 0) : 0;
        updated = partial ? (partial.matchedCount || 0) : 0;
        const writeErrors = (err && err.writeErrors) || [];
        const code = (e) => (e.err ? e.err.code : e.code);
        const unexpected = writeErrors.filter(e => code(e) !== 11000);
        failure = (!writeErrors.length || unexpected.length) ? err.message : null;
    }
    if (failure) {
        console.log(`Hoops team ingest write failed: ${failure}`);
        return res.status(500).json({ season, created, updated, message: `Team write failed: ${failure}` });
    }

    // withLogos is reported because it is the number that silently regressed
    // before: "365 teams" was true while 101 of them carried dead URLs.
    const withLogos = haveLogo.size;
    console.log(`Hoops teams · ${season}: ${created} created, ${updated} updated `
        + `(${ops.length} teams, ${withLogos} with logos)`);
    return res.status(200).json({
        season, created, updated, teams: ops.length, withLogos,
        fetched: result.data.length, remainingCalls: result.remainingCalls
    });
  } catch (err) {
    console.log(`Hoops team ingest: unexpected error: ${err && err.message}`);
    return res.status(500).json({ message: err && err.message });
  }
});

// The basketball team page's data (#494). Read-only, no CBBD calls.
//
// The league comes from the SERVER's validated selection, the same answer
// the navbar renders — never from a query string. Who rosters a team, and
// what it has banked, is the one league-private thing on this payload, and
// a ?league= would let anyone ask about a league they are not in, which is
// exactly how the basketball league would become discoverable early.
// A football (or no) selection still gets the page, just without an owner.
// Whether this viewer may know basketball exists at all: an Admin, or
// someone holding a franchise in a basketball league. The league stays
// invisible to everyone else until it is announced, and EXISTENCE counts —
// a page any signed-in member could open by URL would be the leak. A
// refusal is a 404, not a 403, for the same reason.
async function seesBasketball(req) {
    try {
        const mine = await leagueSelection.viewableBy(req);
        return (mine || []).some(code => seasons.sportForLeague(code) === 'basketball');
    } catch (e) {
        console.error(`hoops team page: visibility check failed: ${e.message}`);
        return false;
    }
}

router.get('/:id/page', async (req, res) => {
    try {
        if (!(await seesBasketball(req))) return res.status(404).json({ message: 'Not found' });
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) return res.status(400).json({ message: 'team id must be a number' });
        let league = '';
        try {
            league = await leagueSelection.selectedLeague(req);
        } catch (e) {
            console.error(`hoops team page: league selection failed: ${e.message}`);
        }
        const basketball = !!league && seasons.sportForLeague(league) === 'basketball';
        const season = basketball ? seasons.seasonForLeague(league) : seasons.activeSeason('basketball');
        if (season == null) return res.status(404).json({ message: 'No basketball season is active' });
        const page = await teamPage.build(id, { season, league: basketball ? league : null });
        if (!page) return res.status(404).json({ message: 'No such basketball team this season' });
        return res.json(page);
    } catch (err) {
        console.error(`hoops team page ${req.params.id}: ${err && err.message}`);
        return res.status(500).json({ message: 'Could not load this team' });
    }
});

module.exports = router;
module.exports.buildUpsertOp = buildUpsertOp;
module.exports.seesBasketball = seesBasketball;
module.exports.logosFor = logosFor;
module.exports.withHash = withHash;
