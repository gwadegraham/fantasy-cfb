const express = require('express');
const router = express.Router();
const CfpBracket = require('../models/cfpBracket');
const { deriveBracket, BracketRejected } = require('../modules/cfp-bracket');

// The CFP bracket, one document per season. Scoring reads it to classify
// postseason rounds by game id instead of parsing CFBD's `notes` prose — see
// modules/cfp-bracket.js for why.
//
// cfb.js v4.3.2 has no PlayoffsApi, so the refresh uses raw fetch, the same way
// routes/games.js and routes/rankings.js call /games and /rankings.

// Getting One By Season
router.get('/cfp/:season', async (req, res) => {
    // Answer garbage input directly instead of letting Mongo's cast failure
    // surface as a 500 in the logs.
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    try {
        const bracket = await CfpBracket.findOne({ season: req.params.season });

        if (!bracket) {
            return res.status(404).json({ message: `No CFP bracket found for season ${req.params.season}` });
        }
        res.status(200).json(bracket);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Pull a season's bracket in one CFBD call and upsert it. Non-destructive and
// safe to re-run: matches on season, replaces the stored snapshot, never
// deletes. Re-run through the postseason as results fill in.
//
// Uses /playoffs/cfp, NOT /playoffs/cfp/games. Same one-call cost, and the
// parent states `firstRoundBye` outright — the flattened form forces deriving
// the bye from `source: null`, which is a trap worth avoiding (see
// crossCheckByes in modules/cfp-bracket.js).
router.post('/cfp/:season/refresh', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    try {
        const response = await fetch(`https://api.collegefootballdata.com/playoffs/cfp?year=${season}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
        });
        const data = await response.json();
        if (!response.ok) {
            return res.status(400).json({ message: (data && data.message) || `CFBD request failed (${response.status})` });
        }

        // A refused bracket is a 400, not a 500: the request worked, the payload
        // isn't something we'll score off. The caller keeps the bracket it had
        // (or none), and postseason scoring falls back to the notes path.
        let derived;
        try {
            derived = deriveBracket(data);
        } catch (err) {
            if (err instanceof BracketRejected) {
                console.log(`CFP bracket ${season} rejected:`, err.message);
                return res.status(400).json({ message: err.message, rejected: true });
            }
            throw err;
        }

        // CFBD echoes the requested year, but store the season we asked for so a
        // payload for the wrong season can't land under this one's key.
        derived.season = season;
        derived.retrievedAt = new Date();

        // REPLACE, not update: the doc is a snapshot of one CFBD response, and a
        // merge would leave stale fields behind when the new payload doesn't have
        // them — re-ingesting a completed 2025 bracket over a hypothetical
        // re-opened one would keep the old `champion` forever.
        const existing = await CfpBracket.findOne({ season: season });
        const bracket = await CfpBracket.findOneAndReplace(
            { season: season }, derived, { upsert: true, new: true });

        console.log(`CFP bracket ${season}: ${derived.games.length} games, ${derived.participants.length} participants (${existing ? 'updated' : 'created'})`);
        return res.status(201).json({
            season: season,
            created: !existing,
            games: derived.games.length,
            participants: derived.participants.length,
            status: derived.status,
            bracket: bracket
        });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

module.exports = router;
