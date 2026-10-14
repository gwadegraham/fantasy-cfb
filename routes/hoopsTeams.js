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
const roster = require('../modules/hoops-roster');
const visibility = require('../modules/hoops-visibility');
const Draft = require('../models/draft');
const League = require('../models/league');
const { pickLogo } = require('../public/logo.js');
const { teamsById, applyTeamFields } = require('../modules/team-refresh');

// Basketball logos come straight from CBBD's /teams `logos` array (#508). It
// is football's shape exactly — light and dark at 500/256/128/96/64/48/32/16,
// on cdn.collegefootballdata.com/cbb-logos[-dark]/ keyed on sourceId — so
// public/logo.js pickLogo works unchanged and nothing in public/ branches on
// sport. Measured 7 Oct 2026: 365/365 teams carry 16 entries, every URL 200.
//
// Only strings are kept: a null or object entry would reach an <img src>.
function apiLogos(t) {
    return Array.isArray(t && t.logos) ? t.logos.filter(u => typeof u === 'string' && u) : [];
}

// The one URL per team the ingest probes before storing any of them: the
// largest light logo. Same selector the renderers use, so the probe checks a
// URL a page could actually ask for.
function probeUrl(logos) {
    return pickLogo(logos, { dark: false });
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

// `haveLogo` is the set of probe URLs that actually loaded (see
// cbbd.logoUrlsThatExist). A team whose probe failed stores [] rather than 16
// links the page would render as broken images — finding #1 of the original
// ingest, when 101 of 365 teams were given URLs that all 403.
function buildUpsertOp(t, season, haveLogo) {
    if (!t || t.id == null) return null;
    const given = apiLogos(t);
    const hasLogo = !!(given.length && haveLogo && haveLogo.has(probeUrl(given)));
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
        logos: hasLogo ? given : [],
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

// Push fresh display fields (logos, school, colours) into the copy of each
// team a basketball draft stored on its picks (drafts.picks[].team) — what
// the draft room and board render. The same job routes/teams.js does for
// football, with the same helper. Rosters need nothing: a basketball roster
// holds references (seasons[].teamRefs), which resolve to these rows.
//
// Scoped to BASKETBALL leagues and THIS season, and both scopes matter. Team
// ids are per-sport (CBB 87 is Florida, football 87 is Notre Dame), so an
// unscoped pass would rename teams across sports; and HoopsTeam rows are
// per-season, so a forced backfill must not repaint a different season's draft.
//
// Three more rules, each from QA on #543:
//   - a probe MISS never blanks a pick. The team row stores [] so nothing
//     unverified is served from it, but a pick's existing logos keep working
//     until a later ingest confirms new ones. One CDN outage during this run
//     would otherwise strip every logo off the draft room and board.
//   - a LIVE draft is skipped. The draft socket $pushes picks without bumping
//     __v, so saving a whole picks array loaded a moment earlier would erase
//     the pick made in between. Re-run the ingest after the draft ends.
//   - leagues are read by their stored sport, not the season cache, which
//     answers 'football' for every league when unprimed — a silent no-op.
async function refreshDraftCopies(season, docs) {
    const out = { drafts: 0, failed: 0, skippedLive: 0 };
    const leagueDocs = await League.find({ sport: 'basketball' }, { code: 1, _id: 0 }).lean();
    const codes = leagueDocs.map(l => l.code);
    if (!codes.length) return out;
    const byId = teamsById((docs || []).map(d => {
        if (Array.isArray(d.logos) && d.logos.length) return d;
        const { logos, ...rest } = d;
        return rest;
    }));
    const drafts = await Draft.find({ league: { $in: codes }, season, 'picks.0': { $exists: true } });
    for (const d of drafts) {
        if (d.status === 'active') { out.skippedLive++; continue; }
        // picks[].team is Mixed: mutate, then flag the path for mongoose.
        if (!applyTeamFields((d.picks || []).map(p => p.team), byId)) continue;
        try { d.markModified('picks'); await d.save(); out.drafts++; } catch (err) {
            out.failed++;
            console.log(`Hoops draft copies: draft ${d._id} not saved: ${err.message}`);
        }
    }
    return out;
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
        haveLogo = await cbbd.logoUrlsThatExist(result.data.map(t => probeUrl(apiLogos(t))));
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

    // Draft picks hold their own copy of each team, so a re-ingest alone
    // leaves them on the old URLs. After the write, so a failure here never
    // costs the team rows.
    let draftCopies = { drafts: 0, failed: 0, skippedLive: 0 };
    try {
        draftCopies = await refreshDraftCopies(season, ops.map(o => o.updateOne.update.$set));
    } catch (err) {
        console.log(`Hoops team ingest: draft copy refresh failed: ${err.message}`);
        draftCopies.error = err.message;
    }

    // withLogos is reported because it is the number that silently regressed
    // before: "365 teams" was true while 101 of them carried dead URLs.
    const withLogos = ops.filter(o => o.updateOne.update.$set.logos.length).length;
    console.log(`Hoops teams · ${season}: ${created} created, ${updated} updated `
        + `(${ops.length} teams, ${withLogos} with logos)`);
    return res.status(200).json({
        season, created, updated, teams: ops.length, withLogos, draftCopies,
        fetched: result.data.length, remainingCalls: result.remainingCalls
    });
  } catch (err) {
    console.log(`Hoops team ingest: unexpected error: ${err && err.message}`);
    return res.status(500).json({ message: err && err.message });
  }
});

// Re-import a season's jersey numbers — the admin's door for a late roster
// addition. The schedule ingest already does this once a season on its own;
// this forces it. One billable call (CBBD /teams/roster answers for every
// team); safe to re-run, upserts by (season, athleteId).
router.post('/:season/roster', async (req, res) => {
  try {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    // The same input check as the team ingest above, for the same reason:
    // /teams/roster answers for ANY season, so a wrong number writes a real
    // but wrong set of numbers rather than erroring.
    const expected = activeSeason('basketball');
    const force = req.query.force === '1' || req.query.force === 'true';
    if (!force && Number.isFinite(expected) && season !== expected) {
        return res.status(422).json({
            message: `Season ${season} is not the stored basketball season (${expected}). `
                + 'CBBD numbers a split season by its ENDING year — the 2026-27 season is 2027. '
                + 'Pass ?force=1 to import it anyway.',
            requested: season, expected
        });
    }

    let result;
    try {
        result = await roster.importSeason(season);
    } catch (err) {
        const code = err.unreachable ? 502 : (err.status >= 500 || err.status === 429 ? 502 : 400);
        console.log(`Hoops roster import failed: ${err.message}`);
        return res.status(code).json({ message: err.message, upstreamStatus: err.status || null });
    }
    console.log(`Hoops roster · ${season}: ${result.players} numbered player(s) across ${result.teams} team(s)`);
    return res.status(200).json(result);
  } catch (err) {
    console.log(`Hoops roster import: unexpected error: ${err && err.message}`);
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
router.get('/:id/page', async (req, res) => {
    try {
        if (!(await visibility.seesBasketball(req))) return res.status(404).json({ message: 'Not found' });
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
module.exports.refreshDraftCopies = refreshDraftCopies;
module.exports.withHash = withHash;
