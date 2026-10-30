const express = require('express');
const { activeSeason } = require('../modules/active-season');
const router = express.Router();
const PlayerSeasonLeader = require('../models/playerSeasonLeader');
const { ingestSeasonLeaders } = require('../modules/player-season-leaders');

// Manual runs only. The weekly job calls ingestSeasonLeaders in-process,
// because this route can outlast Heroku's 30s router limit — see the module.
router.post('/ingest/:year', async (req, res) => {
    try {
        res.json(await ingestSeasonLeaders(req.params.year));
    } catch (err) {
        console.error('Player season leaders ingest error:', err);
        res.status(err.status || 500).json({ message: err.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const season = req.query.season || activeSeason('football');
        const teams = req.query.teams ? req.query.teams.split(',') : [];
        if (!teams.length) return res.json([]);

        const docs = await PlayerSeasonLeader.find({ season, team: { $in: teams } }).lean();
        res.json(docs.map(d => ({ season: d.season, team: d.team, leaders: d.leaders })));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
