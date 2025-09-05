const express = require('express');
const router = express.Router();
const Game = require('../models/game');

// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
const { findOneAndUpdate } = require('../models/user');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

//Getting All
router.get('/', async (req, res) => {
    try {
        const games = await Game.find();
        res.json(games);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Team & Week
router.get('/seasonType/:seasonType/week/:weekNum/team/:team', async (req, res) => {
    var week = req.params.weekNum;
    var teamId = req.params.team;
    var seasonType = req.params.seasonType;
    try {
        const game = await Game.find({$and: [ { $or: [{"homeId":teamId}, {"awayId":teamId}]}, {"season":process.env.YEAR}, {seasonType: seasonType}, {week: week}]});

        if (JSON.stringify(game) != '[]') {
            res.status(200).json(game);
        } else{
            return res.status(400).json({message: `${teamId} did not have a game in week ${week}`});
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Team
router.get('/season/:season/team/:team', async (req, res) => {
    var team = req.params.team;
    var season = req.params.season;
    try {
        const games = await Game.find({$and: [ { $or: [{"homeTeam":team}, {"awayTeam":team}]}, {"season":season}]});
        res.status(200).json(games);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Team ID
router.get('/season/:season/teamId/:teamId', async (req, res) => {
    var teamId = req.params.teamId;
    var season = req.params.season;
    try {
        const games = await Game.find({$and: [ { $or: [{"homeId":teamId}, {"awayId":teamId}]}, {"season":season}]});
        res.status(200).json(games);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting API Calls Info
router.get('/info', async (req, res) => {
    try {
        const response = await fetch(`https://api.collegefootballdata.com/info`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
            }
        });

        var apiInfo = await response.json();
        res.status(200).json(apiInfo);

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Creating One
router.post('/', async (req, res) => {
    let existingGame;
    try {
        existingGame = await Game.find({ id: req.body.id });

        if (req.body.homePoints == null) {
            return res.status(400).json({message: `Game with id ${req.body.id} is not complete`});
        }
        else if (existingGame.length != 0) {
            return res.status(400).json({message: `Game with id ${existingGame[0]["id"]} already exists`});
        } else {
            const game = new Game(req.body);
        
            try {
                const newGame = await game.save();
                return res.status(201).json(newGame);
            } catch (err) {
                res.status(400).json({message: err.message});
            }
        }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Creating Many By Week
router.post('/week/mass-create', async (req, res) => {

    var allNewGames = [];
    var allExistingGames = [];
    var year = process.env.YEAR;
    var opts = {
        'week': req.body.week,
        'seasonType': req.body.seasonType,
        'division': 'fbs'
    };

    const response = await fetch(`https://api.collegefootballdata.com/games?year=${year}&week=${req.body.week}&seasonType=${req.body.seasonType}&division=fbs`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Authorization': process.env.CFBD_API_KEY
        }
    });

    var gameData = await response.json();
        
    for (const game of gameData) {
        var alreadyExists = await Game.find({ id: game.id });

        game.seasonType = game.seasonType;
        game.startDate = game.startDate;
        game.startTimeTbd = game.startTimeTBD;
        game.neutralSite = game.neutralSite;
        game.conferenceGame = game.conferenceGame;
        game.venueId = game.venueId;
        game.homeId = game.homeId;
        game.homeTeam = game.homeTeam;
        game.homeConference = game.homeConference;
        game.homeDivision = game.homeDivision;
        game.homePoints = game.homePoints;
        game.homeLineScores = game.homeLineScores;
        game.homePostWinProb = game.homePostWinProb;
        game.homePregameElo = game.homePregameElo;
        game.homePostgameElo = game.homePostgameElo;
        game.awayId = game.awayId;
        game.awayTeam = game.awayTeam;
        game.awayConference = game.awayConference;
        game.awayDivision = game.awayDivision;
        game.awayPoints = game.awayPoints;
        game.awayLineScores = game.awayLineScores;
        game.awayPostWinProb = game.awayPostWinProb;
        game.awayPregameElo = game.awayPregameElo;
        game.awayPostgameElo = game.awayPostgameElo;
        game.excitementIndex = game.excitementIndex;

        var date = new Date();
        var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
        game.lastUpdated = centralTime;

        if (alreadyExists.length == 0) {
            const newGame = new Game(game);
            allNewGames.push(newGame);
        } else {
            var filter = {id: game.id};
            delete game.id;
            try {
                var updatedGame = await Game.findOneAndUpdate(filter, game, {new: true});
                allExistingGames.push(updatedGame);
            } catch (err) {
                console.log("Error updating game with id:", game.id);
                console.log("Update error:", err.message);
            } 
        }
    }

    console.log("Total number of existing games: ", allExistingGames.length);

    try {
        try {
            console.log("all new games length", allNewGames.length);
            const newGames = await Game.insertMany(allNewGames);

            var returnedGames = {
                newGames: newGames,
                existingGames: allExistingGames
            };

            return res.status(201).json(returnedGames);
        } catch (err) {
            console.log("Error saving games: ", err.message)
            res.status(400).json({message: err.message});
        }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

module.exports = router;