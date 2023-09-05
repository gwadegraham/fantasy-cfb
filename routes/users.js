const express = require('express');
const router = express.Router();
const User = require('../models/user');
const scoring = require('../scoring');

//Getting All
router.get('/', async (req, res) => {
    try {
        const users = await User.find();
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By League
router.get('/league/:leagueCodeReq', async (req, res) => {
    var leagueCode = req.params.leagueCodeReq;
    try {
        console.log("finding user in league", leagueCode);
        const users = await User.find({league: leagueCode});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One
router.get('/:id', (req, res) => {
    res.send(req.params.id);
});

//Creating One
router.post('/', async (req, res) => {

    //console.log("teams", req.body.teams);
    const user = new User({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        teams: req.body.teams,
        league: req.body.league
    });

    try {
        const newUser = await user.save();
        //scoring.getScores([newUser]);

        res.status(201).json(newUser);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating One
router.patch('/:id', getUser, async (req, res) => {

    // var keys = Object.keys(req.body);
    //console.log("req.body.weeklyScore", req.body.weeklyScore);
    //console.log("req.body", req.body);

    if (req.body.cumulativeScore != null) {
        res.user.cumulativeScore = req.body.cumulativeScore;
    } 

    else {
        res.user.weeklyScore = req.body.weeklyScore;
    }
    if (req.body.isUpdated != null) {
        res.user.isUpdated = req.body.isUpdated;
    }
    try {
        const updatedUser = await res.user.save();
        res.status(200).json(updatedUser);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Deleting One
router.delete('/:id', getUser, async (req, res) => {
    try {
        await res.user.deleteOne();
        res.json({message: 'Deleted User'});
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

async function getUser(req, res, next) {
    let user;
    try {
        user = await User.findById(req.params.id);
        if (user == null) {
            return res.status(404).json({message: 'Cannot find user'});
        }
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
    res.user = user;
    next();
}

module.exports = router;