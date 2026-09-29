// Basketball team ingest (#317, Hardwood B4).
//
// A parallel tree to routes/teams.js, same reasoning as routes/hoopsGames.js.

const express = require('express');
const router = express.Router();
const HoopsTeam = require('../models/hoopsTeam');
const cbbd = require('../modules/cbbd-client');

// The CFBD logo CDN, keyed on the ESPN id — which is what CBBD calls sourceId.
// Verified: Alabama is sourceId 333 and /logos/500/333.png returns 200, the
// same id football's Alabama row already stores.
//
// The 16-entry shape mirrors models/team.js exactly (light and dark at eight
// sizes) so public/logo.js pickLogo picks a basketball logo by the same rules
// it picks a football one, with no sport branch.
const LOGO_SIZES = [500, 256, 128, 96, 64, 48, 32, 16];
function logosFor(sourceId) {
    if (!sourceId) return [];
    const out = [];
    LOGO_SIZES.forEach(size => {
        out.push(`https://cdn.collegefootballdata.com/logos/${size}/${sourceId}.png`);
        out.push(`https://cdn.collegefootballdata.com/logos-dark/${size}/${sourceId}.png`);
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

function buildUpsertOp(t) {
    if (!t || t.id == null) return null;
    const doc = {
        id: t.id,
        sourceId: t.sourceId == null ? undefined : String(t.sourceId),
        school: t.school,
        mascot: t.mascot,
        abbreviation: t.abbreviation,
        displayName: t.displayName,
        shortDisplayName: t.shortDisplayName,
        color: withHash(t.primaryColor),
        alt_color: withHash(t.secondaryColor),
        logos: logosFor(t.sourceId),
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
    Object.keys(doc).forEach(k => { if (doc[k] === undefined || doc[k] === null) delete doc[k]; });
    return { updateOne: { filter: { id: t.id }, update: { $set: doc }, upsert: true } };
}

// Ingest every D-I team for a season. One CBBD call; safe to re-run.
router.post('/:season/ingest', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);

    let result;
    try {
        result = await cbbd.fetchTeams(season);
    } catch (err) {
        // fetch REJECTS on a network failure and Express 4 does not route an
        // async handler's rejection — an unguarded throw takes the dyno down.
        const code = err.unreachable ? 502 : 400;
        console.log(`Hoops team ingest failed: ${err.message}`);
        return res.status(code).json({ message: err.message });
    }

    // An empty team list is a failure, not an empty league. CBBD numbers a
    // split season by its ENDING year — the 2026-27 season is season 2027 —
    // and the wrong number returns HTTP 200 with [].
    if (!result.data.length) {
        return res.status(422).json({
            message: `CBBD returned no teams for season ${season}. It numbers a split season by `
                + 'its ENDING year — the 2026-27 season is season 2027.'
        });
    }

    const ops = result.data.map(buildUpsertOp).filter(Boolean);
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

    console.log(`Hoops teams · ${season}: ${created} created, ${updated} updated (${ops.length} teams)`);
    return res.status(200).json({
        season, created, updated, teams: ops.length,
        fetched: result.data.length, remainingCalls: result.remainingCalls
    });
});

module.exports = router;
module.exports.buildUpsertOp = buildUpsertOp;
module.exports.logosFor = logosFor;
module.exports.withHash = withHash;
