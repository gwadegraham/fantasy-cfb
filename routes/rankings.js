const express = require('express');
const router = express.Router();
const Ranking = require('../models/ranking');

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

// Getting One By Week & Season Type & Poll
router.get('/:week/:seasonType/:pollName', async (req, res) => {
    try {
        const ranking = await Ranking.find({ $and: [ { seasonType: req.params.seasonType}, { week: req.params.week}, {polls: {$elemMatch: {"poll": req.params.pollName}}}]}, {"polls.ranks.$":1});

        if (JSON.stringify(ranking) === '[]') {
            res.status(400).json({message: `No rankings found for week ${req.body.week} & seasonType ${req.body.seasonType}`});
        } else {
            res.status(200).json(ranking);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

module.exports = router;