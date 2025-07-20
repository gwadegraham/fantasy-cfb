const express = require('express');
const router = express.Router();
const Recruiting = require('../models/recruiting');

// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

var recruitingApi = new cfb.RecruitingApi();

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

        if (JSON.stringify(recruitingRankings) === '[]') {
            res.status(400).json({message: `No recruiting rankings found for year ${req.body.year}`});
        } else {
            res.status(200).json(recruitingRankings);
        }
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Year & Team
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

//Getting All By Year & Saving to Database
router.post('/new/:year', async (req, res) => {
    var allNewRankings = [];

    try {
        var opts = { 
        'year': req.body.season,
        };

        recruitingApi.getRecruitingTeams(opts).then(async function(data) {

            const recruitingRanking = new Recruiting({
                season: req.body.season,
                seasonType: req.body.seasonType,
                week: req.body.week,
                polls: data[0].polls
            });

            for (const ranking of data) {
                var alreadyExists = await Recruiting.find({ year: ranking.year, team: ranking.team });
                ranking.year = ranking.year;
                ranking.rank = ranking.rank;
                ranking.team = ranking.team;
                ranking.points = ranking.points;
        
                if (alreadyExists.length == 0) {
                    const newRanking = new Recruiting(ranking);
                    allNewRankings.push(newRanking);
                }
            }
                
            try {
                console.log("all new rankings length", allNewRankings.length);
                const newRankings = await Recruiting.insertMany(allNewRankings);
                return res.status(201).json(newRankings);
            } catch (err) {
                console.log("Error saving recruiting rankings: ", err.message)
                res.status(400).json({message: err.message});
            }
        }, function(error) {
            res.status(400).json({message: err.message});
        });
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

module.exports = router;