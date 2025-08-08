const express = require('express');
const router = express.Router();
const Record = require('../models/record');

//Getting All
router.get('/', async (req, res) => {
    try {
        const records = await Record.find();
        res.json(records);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting One By School & Season
router.get('/:year/:team', async (req, res) => {
    try {
        const teamRecord = await Record.find({year: req.params.year, team: req.params.team});

        if (JSON.stringify(teamRecord) === '[]') {
            res.status(400).json({message: `No team record found for year ${req.body.year} & team ${req.body.team}`});
        } else {
            res.status(200).json(teamRecord);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting All By Conference & Season
router.get('/:year/conference/:conference', async (req, res) => {
    try {
        const conferenceRecords = await Record.find({year: req.params.year, conference: req.params.conference});

        if (JSON.stringify(conferenceRecords) === '[]') {
            res.status(400).json({message: `No conference records found for year ${req.body.year} & team ${req.body.conference}`});
        } else {
            res.status(200).json(conferenceRecords);
        }

    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

//Getting All By Year & Saving to Database
router.post('/new/:year', async (req, res) => {
    try {
        const response = await fetch(`https://api.collegefootballdata.com/records?year=${req.body.season}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
            }
        });

        var allRecords = await response.json();

        var refreshedRecords = [];
        var newRecords = [];
        for (const record of allRecords) {
            var existingRecord = await Record.findOne({teamId: record.teamId, year: record.year});

            if (existingRecord != null) {
                
                existingRecord.classification = record.classification;
                existingRecord.conference = record.conference;
                existingRecord.division = record.division;
                existingRecord.expectedWins = record.expectedWins;
                existingRecord.total = record.total;
                existingRecord.conferenceGames = record.conferenceGames;
                existingRecord.homeGames = record.homeGames;
                existingRecord.awayGames = record.awayGames;
                existingRecord.neutralSiteGames = record.neutralSiteGames;
                existingRecord.regularSeason = record.regularSeason;
                existingRecord.postseason = record.postseason;

                var filter = {teamId: record.teamId, year: record.year};
                try {
                    var updatedRecord = await Record.findOneAndUpdate(filter, existingRecord, {new: true});
                    refreshedRecords.push(updatedRecord);
                } catch (err) {
                    console.log("Error updating record with team:", existingRecord.team);
                    console.log("Update error:", err.message);
                } 

            } else {
                newRecords.push(record);
            }
        }

        try {
            console.log("Refreshing " + refreshedRecords.length + " records and adding " + newRecords.length + " new records");
            const newCreatedRecords = await Record.insertMany(newRecords);

            var returnedRecords = {
                newRecords: newCreatedRecords,
                refreshedRecords: refreshedRecords
            };

            return res.status(201).json(returnedRecords);
        } catch (err) {
            console.log("Error refreshing teams: " + err.message);
            res.status(400).json({message: err.message});
        }
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

module.exports = router;