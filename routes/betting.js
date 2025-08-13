const express = require('express');
const router = express.Router();
const Betting = require('../models/bettingLine');

//Getting All
router.get('/', async (req, res) => {
    try {
        const bettingLines = await Betting.find();
        res.json(bettingLines);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting All By Season
router.get('/:year', async (req, res) => {
    try {
        const bettingLines = await Betting.find({season: req.params.year});

        if (JSON.stringify(bettingLines) === '[]') {
            res.status(400).json({message: `No betting lines found for year ${req.body.year}`});
        } else {
            res.status(200).json(bettingLines);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Year & Saving to Database
router.post('/new/:year', async (req, res) => {
    try {
        const response = await fetch(`https://api.collegefootballdata.com/lines?year=${req.body.season}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
            }
        });

        var allBettingLines = await response.json();

        var refreshedLines = [];
        var newLines = [];
        for (const bettingLine of allBettingLines) {
            var existingBettingLine = await Betting.findOne({id: bettingLine.id, year: bettingLine.year});

            if (existingBettingLine != null) {
                
                existingBettingLine.id = bettingLine.id;
                existingBettingLine.season = bettingLine.season;
                existingBettingLine.seasonType = bettingLine.seasonType;
                existingBettingLine.week = bettingLine.week;
                existingBettingLine.startDate = bettingLine.startDate;
                existingBettingLine.homeTeam = bettingLine.homeTeam;
                existingBettingLine.homeConference = bettingLine.homeConference;
                existingBettingLine.homeClassification = bettingLine.homeClassification;
                existingBettingLine.homeScore = bettingLine.homeScore;
                existingBettingLine.awayTeam = bettingLine.awayTeam;
                existingBettingLine.awayConference = bettingLine.awayConference;
                existingBettingLine.awayClassification = bettingLine.awayClassification;
                existingBettingLine.awayScore = bettingLine.awayScore;
                existingBettingLine.lines = bettingLine.lines;

                var filter = {id: bettingLine.id, year: bettingLine.year};
                try {
                    var updatedBettingLine = await Betting.findOneAndUpdate(filter, existingBettingLine, {new: true});
                    refreshedLines.push(updatedBettingLine);
                } catch (err) {
                    console.log("Error updating record with id:", existingBettingLine.id);
                    console.log("Update error:", err.message);
                } 

            } else {
                newLines.push(bettingLine);
            }
        }

        try {
            console.log("Refreshing " + refreshedLines.length + " records and adding " + newLines.length + " new records");
            const newCreatedBettingLines = await Betting.insertMany(newLines);

            var returnedBettingLines = {
                newLines: newCreatedBettingLines,
                refreshedLines: refreshedLines
            };

            return res.status(201).json(returnedBettingLines);
        } catch (err) {
            console.log("Error refreshing teams: " + err.message);
            res.status(400).json({message: err.message});
        }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

module.exports = router;