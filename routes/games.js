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

var gamesApi = new cfb.GamesApi();

//Getting All
router.get('/', async (req, res) => {
    try {
        const games = await Game.find();
        res.json(games);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Id
// router.get('/:id', (req, res) => {
//     res.send(req.params.id);
// });

//Getting One By Team & Week
router.get('/seasonType/:seasonType/week/:weekNum/team/:team', async (req, res) => {
    var week = req.params.weekNum;
    var teamId = req.params.team;
    var seasonType = req.params.seasonType;
    try {
        // console.log("seasonType = " + seasonType + " // week = " + week + " // team = " + team);
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

    console.log("opts", opts);
    const response = await fetch(`https://api.collegefootballdata.com/games?year=${year}&week=${req.body.week}&seasonType=${req.body.seasonType}&division=fbs`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Authorization': process.env.CFBD_API_KEY
        }
    });

    // var response = await gamesApi.getGames(year, opts);
    var gameData = await response.json();

    // console.log("gameData", gameData);
        
    for (const game of gameData) {
        // console.log("loop for game", game)
        var alreadyExists = await Game.find({ id: game.id });
        // console.log("alreadyExists", alreadyExists)
        game.seasonType = game.season_type;
        game.startDate = game.start_date;
        game.startTimeTbd = game.start_time_tbd;
        game.neutralSite = game.neutral_site;
        game.conferenceGame = game.conference_game;
        game.venueId = game.venue_id;
        game.homeId = game.home_id;
        game.homeTeam = game.home_team;
        game.homeConference = game.home_conference;
        game.homeDivision = game.home_division;
        game.homePoints = game.home_points;
        game.homeLineScores = game.home_line_scores;
        game.homePostWinProb = game.home_post_win_prob;
        game.homePregameElo = game.home_pregame_elo;
        game.homePostgameElo = game.home_postgame_elo;
        game.awayId = game.away_id;
        game.awayTeam = game.away_team;
        game.awayConference = game.away_conference;
        game.awayDivision = game.away_division;
        game.awayPoints = game.away_points;
        game.awayLineScores = game.away_line_scores;
        game.awayPostWinProb = game.away_post_win_prob;
        game.awayPregameElo = game.away_pregame_elo;
        game.awayPostgameElo = game.away_postgame_elo;
        game.excitementIndex = game.excitement_index;

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

    // let existingGame;
    try {
        // existingGame = await Game.find({ id: req.body.id });

        // if (req.body.homePoints == null) {
        //     return res.status(400).json({message: `Game with id ${req.body.id} is not complete`});
        // }
        // else if (existingGame.length != 0) {
        //     return res.status(400).json({message: `Game with id ${existingGame[0]["id"]} already exists`});
        // } else {
        //     const game = new Game(req.body);
        
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
        // }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

// //Updating One
// router.patch('/:id', (req, res) => {

// });

//Deleting One
// router.delete('/:id', (req, res) => {

// });

module.exports = router;