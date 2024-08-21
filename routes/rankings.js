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

// Retrieving new rankings and saving to database || By Year & Week & Season Type
router.post('/retrieveRankings', async (req, res) => {
    try {
        var opts = { 
        'week': req.body.week,
        'seasonType': req.body.seasonType
        };

        rankingsApi.getRankings(req.body.season, opts).then(async function(data) {
            console.log('Rankings API called successfully. Returned data: ', data);

            const ranking = new Ranking({
                season: req.body.season,
                seasonType: req.body.seasonType,
                week: req.body.week,
                polls: data[0].polls
            });

            const newRanking = await ranking.save();

            console.log("New Ranking Record", newRanking);

            res.status(201).json(newRanking);
        }, function(error) {
            res.status(400).json({message: err.message});
        });
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting One By Week & Season Type & Poll
router.get('/:week/:seasonType/poll/:pollName', async (req, res) => {
    try {
        const ranking = await Ranking.find({ $and: [ {season: process.env.YEAR}, { seasonType: req.params.seasonType}, { week: req.params.week}, {polls: {$elemMatch: {"poll": req.params.pollName}}}]}, {"polls.ranks.$":1});

        if (JSON.stringify(ranking) === '[]') {
            res.status(400).json({message: `No rankings found for week ${req.params.week} & seasonType ${req.params.seasonType}`});
        } else {
            res.status(200).json(ranking);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

module.exports = router;