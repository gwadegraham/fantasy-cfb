const express = require('express');
const router = express.Router();
const Recruiting = require('../models/recruiting');
const recruiting = require('../models/recruiting');

//Getting All
router.get('/', async (req, res) => {
    try {
        const recruitingRankings = await Recruiting.find();
        res.json(recruitingRankings);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Year
router.get('/:year', async (req, res) => {
    try {
        const recruitingRankings = await Recruiting.find({year: req.params.year});
        res.status(200).json(recruitingRankings);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting One By Year & Team
router.get('/:year/:team', async (req, res) => {
    try {
        const recruitingRanking = await Recruiting.find({year: req.params.year, team: req.params.team});

        if (JSON.stringify(recruitingRanking) === '[]') {
            res.status(400).json({message: `No recruiting rankings found for year ${req.body.year} & team ${req.body.team}`});
        } else {
            res.status(200).json(recruitingRanking);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//TODO: Add route to retrieve all rankings for a given year
module.exports = router;