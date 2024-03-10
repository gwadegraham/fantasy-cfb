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
        const teamLogos = await Team.find({school: {$in: req.body.teams}}, "school logos");

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

    if (req.body.weeklyScore != null) {
        res.team.weeklyScore = req.body.weeklyScore;
    } 


    if (req.body.cumulativeScoreV1 != null) {
        res.team.cumulativeScoreV1 = req.body.cumulativeScoreV1;
    }
    
    if (req.body.cumulativeScoreV2 != null) {
        res.team.cumulativeScoreV2 = req.body.cumulativeScoreV2;
    }

    try {
        const updatedTeam = await res.team.save();
        res.status(200).json(updatedTeam);
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

// //Creating One
// router.post('/', async (req, res) => {

//     console.log("teams", req.body.teams);
//     const user = new User({
//         firstName: req.body.firstName,
//         lastName: req.body.lastName,
//         teams: req.body.teams
//     });

//     try {
//         const newUser = await user.save();
//         res.status(201).json(newUser);
//     } catch (err) {
//         res.status(400).json({message: err.message});
//     }
// });

// //Updating One
// router.patch('/:id', (req, res) => {

// });

//Deleting One
// router.delete('/:id', (req, res) => {

// });

async function getTeam(req, res, next) {
    let team;
    try {
        // team = await Team.findById(req.params.id);
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

module.exports = router;