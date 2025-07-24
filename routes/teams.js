const express = require('express');
const router = express.Router();
const Team = require('../models/team');

//Getting All
router.get('/', async (req, res) => {
    try {
        const teams = await Team.find();
        res.json(teams);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting Multiple Logos
router.post('/teamLogos', async (req, res) => {
    try {
        const teamLogos = await Team.find({id: {$in: req.body.teams}}, "id school logos");

        if (JSON.stringify(teamLogos) === '[]') {
            res.status(400).json({message: `No teams found with names ${req.body.teams}`});
        } else {
            res.status(200).json(teamLogos);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting One
router.get('/:id', async (req, res) => {
    try {
        const teamName = await Team.find({id: req.params.id}, "school");

        if (JSON.stringify(teamName) === '[]') {
            res.status(400).json({message: `No teams found with id ${req.body.id}`});
        } else {
            res.status(200).json(teamName);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Updating One
router.patch('/:id', getTeam, async (req, res) => {

    var index = res.team.seasons.findIndex(x => x.season == process.env.YEAR);

    if (index == -1) {
        var newSeasonObject = {
            season: process.env.YEAR,
            conference: res.team.conference,
            weeklyScore: req.body.weeklyScore,
            cumulativeScoreV1: req.body.cumulativeScoreV1,
            cumulativeScoreV2: req.body.cumulativeScoreV2
        };

        res.team.seasons.push(newSeasonObject);
    } else {
        if (req.body.weeklyScore != null) {
            res.team.seasons[index].weeklyScore = req.body.weeklyScore;
        } 
    
    
        if (req.body.cumulativeScoreV1 != null) {
            res.team.seasons[index].cumulativeScoreV1 = req.body.cumulativeScoreV1;
        }
        
        if (req.body.cumulativeScoreV2 != null) {
            res.team.seasons[index].cumulativeScoreV2 = req.body.cumulativeScoreV2;
        }
    }

    try {
        const updatedTeam = await res.team.save();
        res.status(200).json(updatedTeam);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating One With Season
router.patch('/:id/:season', getTeam, async (req, res) => {

    var index = res.team.seasons.findIndex(x => x.season == req.params.season);

    if (index == -1) {
        var newSeasonObject = {
            season: req.params.season,
            conference: res.team.conference,
            weeklyScore: req.body.weeklyScore,
            cumulativeScoreV1: req.body.cumulativeScoreV1,
            cumulativeScoreV2: req.body.cumulativeScoreV2
        };

        res.team.seasons.push(newSeasonObject);
    } else {
        if (req.body.weeklyScore != null) {
            res.team.seasons[index].weeklyScore = req.body.weeklyScore;
        } 
    
        if (req.body.cumulativeScoreV1 != null) {
            res.team.seasons[index].cumulativeScoreV1 = req.body.cumulativeScoreV1;
        }
        
        if (req.body.cumulativeScoreV2 != null) {
            res.team.seasons[index].cumulativeScoreV2 = req.body.cumulativeScoreV2;
        }
    }

    try {
        const updatedTeam = await res.team.save();
        res.status(200).json(updatedTeam);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Updating Expected Wins for One With Season
router.patch('/:team/:season/expectedWins', getTeamByName, async (req, res) => {

    var index = res.team.seasons.findIndex(x => x.season == req.params.season);

    if (index > -1) {
        if (req.body.expectedWins != null) {
            res.team.seasons[index].expectedWins = req.body.expectedWins;
        } 
    }

    try {
        const updatedTeam = await res.team.save();
        res.status(200).json(updatedTeam);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

//Refreshing All
router.post('/refresh', async (req, res) => {
    try {
        const response = await fetch(`https://api.collegefootballdata.com/teams/fbs?year=${req.body.year}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
            }
        });

        var allTeams = await response.json();

        var refreshedTeams = [];
        var newTeams = [];
        for (const team of allTeams) {
            var existingTeam = await Team.findOne({id: team.id});

            if (existingTeam != null) {
               
                existingTeam.school = team.school;
                existingTeam.mascot = team.mascot;
                existingTeam.abbreviation = team.abbreviation;
                existingTeam.alternateNames = team.alternateNames;
                existingTeam.color = team.color;
                existingTeam.alt_color = team.alt_color;
                existingTeam.logos = team.logos;
                existingTeam.twitter = team.twitter;
                existingTeam.location = team.location;

                var seasonIndex = existingTeam.seasons.findIndex(x => x.season == req.body.year);
                if (seasonIndex >= 0) {
                    existingTeam.seasons[seasonIndex].conference = team.conference;
                } else {
                    var newSeasonObject = {
                        season: req.body.year,
                        conference: team.conference
                    };

                    existingTeam.seasons.push(newSeasonObject);
                }

                var filter = {id: existingTeam.id};
                try {
                    var updatedTeam = await Team.findOneAndUpdate(filter, existingTeam, {new: true});
                    refreshedTeams.push(updatedTeam);
                } catch (err) {
                    console.log("Error updating team with id:", existingTeam.id);
                    console.log("Update error:", err.message);
                } 

            } else {
                var newSeasonObject = {
                    season: req.body.year,
                    conference: team.conference
                };
                team.seasons = [];
                team.seasons.push(newSeasonObject);
                newTeams.push(team)
            }
        }

        try {
            console.log("Refreshing " + refreshedTeams.length + " teams and adding " + newTeams.length + " new teams");
            const newCreatedTeams = await Team.insertMany(newTeams);

            var returnedTeams = {
                newTeams: newCreatedTeams,
                refreshedTeams: refreshedTeams
            };

            return res.status(201).json(returnedTeams);
        } catch (err) {
            console.log("Error refreshing teams: " + err.message);
            res.status(400).json({message: err.message});
        }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

async function getTeam(req, res, next) {
    let team;
    try {
        team = await Team.findOne({id: req.params.id});
        if (team == null) {
            return res.status(404).json({message: 'Cannot find team'});
        }
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
    res.team = team;
    next();
}

async function getTeamByName(req, res, next) {
    let team;
    try {
        team = await Team.findOne( { $or: [{"school": req.params.team}, {"alternateNames": req.params.team}]});
        if (team == null) {
            return res.status(404).json({message: 'Cannot find team ' + req.params.team});
        }
    } catch (err) {
        return res.status(500).json({message: err.message});
    }
    res.team = team;
    next();
}

module.exports = router;