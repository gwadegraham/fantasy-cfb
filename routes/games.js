const express = require('express');
const router = express.Router();
const Game = require('../models/game');

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
    var team = req.params.team;
    var seasonType = req.params.seasonType;
    try {
        console.log("seasonType = " + seasonType + " // week = " + week + " // team = " + team);
        const game = await Game.find({$and: [ { $or: [{"homeTeam":team}, {"awayTeam":team}]}, {"season":process.env.YEAR}, {seasonType: seasonType}, {week: week}]});

        if (JSON.stringify(game) != '[]') {
            res.status(200).json(game);
        } else{
            res.status(400).json({message: `${team} did not have a game in week ${week}`});
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

// //Updating One
// router.patch('/:id', (req, res) => {

// });

//Deleting One
// router.delete('/:id', (req, res) => {

// });

module.exports = router;