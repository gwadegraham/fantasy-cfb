const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
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
        // Guard the $in value: only accept an array of ids so a crafted body
        // (e.g. an operator object) can't be injected into the query.
        if (!Array.isArray(req.body.teams)) {
            return res.status(400).json({message: 'teams must be an array of team ids'});
        }
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

//Getting All Logos
router.get('/teamLogos/all', async (req,res) => {
    try {
        const teamLogos = await Team.find({}, "id logos");

        if (JSON.stringify(teamLogos) === '[]') {
            res.status(400).json({message: `Couldn't get all logos for all teams`});
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

// Getting All Info for One
router.get('/info/:id', async (req, res) => {
    try {
        const teamName = await Team.find({id: req.params.id});

        if (JSON.stringify(teamName) === '[]') {
            res.status(400).json({message: `No teams found with id ${req.body.id}`});
        } else {
            res.status(200).json(teamName);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting All Teams from One Conference
router.get('/conference/:conference', async (req, res) => {
    try {
        const teamName = await Team.find({seasons: {
            $elemMatch: {
                season: process.env.YEAR,
                conference: req.params.conference
            }
        }});

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
router.post('/:season/expectedWins', async (req, res) => {

    // Validate season is a 4-digit year before using it in a file path,
    // otherwise a value like "../../server" is a path-traversal vector.
    if (!/^\d{4}$/.test(req.params.season)) {
        return res.status(400).json({message: 'Invalid season'});
    }

    // Read fresh (not require()) so editing the JSON and re-running picks up
    // the new values without needing a server restart.
    var teamJsonData;
    try {
        const file = path.join(__dirname, '..', 'json', `expectedWins${req.params.season}.json`);
        teamJsonData = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        return res.status(404).json({message: `No expected wins data for season ${req.params.season}`});
    }
    var updatedTeams = [];

    for (const teamJson of teamJsonData) {

        var team = await getTeamByName(teamJson.team);
        if (team == null) {
            console.log(`Skipping unknown team: ${teamJson.team}`);
            continue;
        }

        var index = team.seasons.findIndex(x => x.season == req.params.season);

        if (index > -1) {
            if (teamJson.expectedWins != null) {
                team.seasons[index].expectedWins = teamJson.expectedWins;
            }
        }

        try {
            const updatedTeam = await team.save();
            updatedTeams.push(updatedTeam);
        } catch (err) {
            // Log and keep going; sending a response here would collide with
            // the res.status(200) after the loop ("headers already sent").
            console.log(`Error saving expected wins for ${teamJson.team}: ${err.message}`);
        }
    }

    res.status(200).json(updatedTeams);
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

async function getTeamByName(teamName) {
    // Returns the matching team, or null if not found / on error. This is a
    // plain helper (no res in scope), so the caller decides how to respond.
    try {
        return await Team.findOne( { $or: [{"school": teamName}, {"alternateNames": teamName}]});
    } catch (err) {
        console.log(`Error looking up team ${teamName}: ${err.message}`);
        return null;
    }
}

module.exports = router;