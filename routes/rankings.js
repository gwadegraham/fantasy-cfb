const express = require('express');
const router = express.Router();
const Ranking = require('../models/ranking');

// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

var rankingsApi = new cfb.RankingsApi();

//Getting All
router.get('/', async (req, res) => {
    try {
        const rankings = await Ranking.find();
        res.json(rankings);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting One By Week & Season Type
router.get('/:week/:seasonType', async (req, res) => {
    try {
        const ranking = await Ranking.find({week: req.params.week, seasonType: req.params.seasonType});

        if (JSON.stringify(ranking) === '[]') {
            res.status(400).json({message: `No rankings found for week ${req.body.week} & seasonType ${req.body.seasonType}`});
        } else {
            res.status(200).json(ranking);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting One By Year & Week & Season Type
router.get('/:season/:week/:seasonType', async (req, res) => {
    try {
        const ranking = await Ranking.findOne({season: req.params.season, week: req.params.week, seasonType: req.params.seasonType});

        if (JSON.stringify(ranking) == "null") {
            res.status(400).json({message: `No rankings found for season ${req.params.season} & week ${req.params.week} & seasonType ${req.params.seasonType}`});
        } else {
            res.status(200).json(ranking);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting All By Year
router.get('/:season/', async (req, res) => {
    try {
        const ranking = await Ranking.find({season: req.params.season});

        if (JSON.stringify(ranking) == "null") {
            res.status(400).json({message: `No rankings found for season ${req.params.season}`});
        } else {
            res.status(200).json(ranking);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Retrieving new rankings and saving to database || By Year & Week & Season Type
router.post('/retrieveRankings', async (req, res) => {
    try {
        var opts = {
        'week': req.body.week,
        'seasonType': req.body.seasonType
        };

        // Awaited (not .then with a broken err/error handler) so a rejected
        // API call or a failed save is caught by this try/catch instead of
        // becoming an unhandled promise rejection with no response sent.
        const data = await rankingsApi.getRankings(req.body.season, opts);
        console.log('Rankings API called successfully.');

        const ranking = new Ranking({
            season: req.body.season,
            seasonType: req.body.seasonType,
            week: req.body.week,
            polls: data[0].polls
        });

        const newRanking = await ranking.save();
        console.log("New Ranking Record", newRanking);

        res.status(201).json(newRanking);
    } catch (err) {
        console.log("Error retrieving rankings:", err.message);
        res.status(400).json({message: err.message});
    }
});

// Getting One By Week & Season Type & Poll
router.get('/:week/:seasonType/poll/:pollName', async (req, res) => {
    try {
        const ranking = await Ranking.find({ $and: [ {season: process.env.YEAR}, { seasonType: "regular"}, { week: req.params.week}, {polls: {$elemMatch: {"poll": req.params.pollName}}}]}, {"polls.ranks.$":1});

        if (JSON.stringify(ranking) === '[]') {
            res.status(400).json({message: `No rankings found for week ${req.params.week} & seasonType ${req.params.seasonType}`});
        } else {
            res.status(200).json(ranking);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Bulk-pull a whole season's rankings in one CFBD call and upsert each week's
// doc. Non-destructive: matches on (season, seasonType, week), updates existing
// and inserts new, never deletes — so it's safe to re-run and covers regular +
// postseason weeks at once. Replaces the fragile per-week form.
router.post('/:season/refresh', async (req, res) => {
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({ message: 'Invalid season' });
    }
    const season = Number(req.params.season);
    try {
        const response = await fetch(`https://api.collegefootballdata.com/rankings?year=${season}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
        });
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) {
            return res.status(400).json({ message: (data && data.message) || `CFBD request failed (${response.status})` });
        }

        let created = 0, updated = 0;
        for (const wk of data) {
            if (wk.week == null || !wk.seasonType) continue;
            const filter = { season: wk.season, seasonType: wk.seasonType, week: wk.week };
            const doc = { season: wk.season, seasonType: wk.seasonType, week: wk.week, polls: wk.polls || [] };
            const existing = await Ranking.findOne(filter);
            if (existing) { await Ranking.findOneAndUpdate(filter, doc); updated++; }
            else { await new Ranking(doc).save(); created++; }
        }
        return res.status(201).json({ season, weeks: data.length, created, updated });
    } catch (err) {
        return res.status(500).json({ message: err.message });
    }
});

module.exports = router;