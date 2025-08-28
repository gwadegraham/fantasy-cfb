const express = require('express');
const router = express.Router();
const scoringModule = require('../modules/scoring.js');

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