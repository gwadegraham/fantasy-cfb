const express = require('express');
const router = express.Router();
const scoringModule = require('../modules/scoring.js');
const User = require('../models/user');
const Game = require('../models/game');
const { computeAdminStatus } = require('../modules/admin-status');

// Read-only status summary for the admin console: how far scoring/games have
// progressed and whether any completed results are still unscored. Derived from
// existing data — no new job instrumentation.
router.get('/status/:season', async (req, res) => {
    try {
        const season = req.params.season;
        const users = await User.find({ "seasons.season": season });
        const games = await Game.find(
            { season: Number(season) },
            { id: 1, week: 1, seasonType: 1, completed: 1, homeId: 1, awayId: 1, homePoints: 1, awayPoints: 1, _id: 0 }
        );
        res.json(computeAdminStatus(users, games, season));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Recalculating & Updating Scores
router.post('/update', async (req, res) => {
    try {
        var seasonType = req.body.seasonType;
        var weekNumber = req.body.week;

        await scoringModule.updateScores(seasonType, weekNumber);
        await scoringModule.updateCumulativeScores();

        res.status(200).json({"seasonType": seasonType, "weekNumber": weekNumber});
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

module.exports = router;