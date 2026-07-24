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

        const allBettingLines = await response.json();
        if (!Array.isArray(allBettingLines)) {
            return res.status(400).json({ message: 'CFBD lines response was not a list' });
        }

        // Upsert every line in one bulk write, keyed on the CFBD line id (unique
        // per game). The old code did a findOne + findOneAndUpdate PER line —
        // ~1,600 sequential round-trips for a full season, which blew past
        // Heroku's 30s request limit (H12) and killed the nightly scoring job.
        const ops = allBettingLines
            .filter(bl => bl && bl.id != null)
            .map(bl => ({
                updateOne: {
                    filter: { id: bl.id },
                    update: { $set: {
                        id: bl.id,
                        season: bl.season,
                        seasonType: bl.seasonType,
                        week: bl.week,
                        startDate: bl.startDate,
                        homeTeam: bl.homeTeam,
                        homeConference: bl.homeConference,
                        homeClassification: bl.homeClassification,
                        homeScore: bl.homeScore,
                        awayTeam: bl.awayTeam,
                        awayConference: bl.awayConference,
                        awayClassification: bl.awayClassification,
                        awayScore: bl.awayScore,
                        lines: bl.lines
                    } },
                    upsert: true
                }
            }));

        const result = ops.length
            ? await Betting.bulkWrite(ops, { ordered: false })
            : { upsertedCount: 0, modifiedCount: 0 };
        const created = result.upsertedCount || 0;
        console.log(`Betting lines for ${req.body.season}: ${ops.length} total, ${created} new, ${result.modifiedCount || 0} updated`);
        return res.status(201).json({ total: ops.length, created, updated: result.modifiedCount || 0 });
    } catch (err) {
        res.status(400).json({message: err.message});
    }
});

module.exports = router;