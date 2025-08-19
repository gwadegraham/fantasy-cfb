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

//Getting All By Season
router.get('/season/:seasonYear', async (req, res) => {
    try {
        const users = await User.find({"seasons.season": {"$eq": req.params.seasonYear}},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": req.params.seasonYear}}}});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By League
router.get('/league/:leagueCodeReq/all', async (req, res) => {
    var leagueCode = req.params.leagueCodeReq;
    try {
        console.log("finding all users in league", leagueCode);
        const users = await User.find({"league": leagueCode});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By League & Current Year
router.get('/league/:leagueCodeReq', async (req, res) => {
    var leagueCode = req.params.leagueCodeReq;
    try {
        console.log("finding all users in league", leagueCode);
        const users = await User.find({"seasons.season": {"$eq": process.env.YEAR}, "league": leagueCode},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": process.env.YEAR}}}});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By League & Previous Year
router.get('/league/:leagueCodeReq/previous', async (req, res) => {
    var leagueCode = req.params.leagueCodeReq;
    try {
        console.log("finding user in league", leagueCode);
        const users = await User.find({"seasons.season": {"$eq": (process.env.YEAR - 1)}, "league": leagueCode},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": (process.env.YEAR - 1)}}}});
        res.json(users);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Id
router.get('/:id', async (req, res) => {
    var userId = req.params.id;

    try {
        const user = await User.find({_id: userId});
        res.json(user);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting One By Season
router.get('/:id/season', async (req, res) => {
    var userId = req.params.id;
    var year = process.env.YEAR;

    try {
        const user = await User.find({_id: userId, "seasons.season": {"$eq": year}},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": year}}}});
        res.json(user);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Creating One
router.post('/', async (req, res) => {

    var date = new Date();
    var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});

    const user = new User({
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        seasons: req.body.seasons,
        color: req.body.color,
        league: req.body.league,
        lastUpdated: centralTime
    });

    try {
        const newUser = await user.save();
        res.status(201).json(newUser);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating One
router.patch('/:id', getUser, async (req, res) => {

    var date = new Date();
    var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
    res.user.lastUpdated = centralTime;

    if (req.body.cumulativeScore != null) {
        res.user.seasons[0].cumulativeScore = req.body.cumulativeScore;
    } 

    else {
        res.user.seasons[0].weeklyScore = req.body.weeklyScore;
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

//Updating new Season & Teams for One
router.patch('/draft/:id', getUserNewSeason, async (req, res) => {

    var newSeason = {
        "season": req.body.season,
        "teams": req.body.teams
    };

    var date = new Date();
    var centralTime = date.toLocaleString("en-US", {timeZone: "America/Chicago"});
    res.user.lastUpdated = centralTime;

    console.log("res.user", res.user)

    if (req.body.season != null && req.body.teams != null) {
        var seasonExist = res.user.seasons.findIndex(x => x.season == newSeason.season);

        if (seasonExist > -1) {
            res.user.seasons[seasonExist] = newSeason;
        } else {
            res.user.seasons.push(newSeason);
        }
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
        user = await User.findOne({_id: req.params.id, "seasons.season": {"$eq": process.env.YEAR}},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": {"$elemMatch": {"season": {"$eq": process.env.YEAR}}}});
        if (user == null) {
            return res.status(404).json({message: 'Cannot find user'});
        }
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
    res.user = user;
    next();
}

async function getUserNewSeason(req, res, next) {
    let user;
    try {
        user = await User.findOne({_id: req.params.id},
                    {"firstName": 1, "lastName": 1, "league": 1, "lastUpdated": 1, "color": 1, "seasons": 1});
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