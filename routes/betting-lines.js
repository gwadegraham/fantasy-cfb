const express = require('express');
const router = express.Router();
const Betting = require('../models/bettingLine');

// The field set both read routes answer with.
//
// THREE callers read these documents, and between them they read exactly four
// fields — homeTeam, awayTeam, and lines[].provider / lines[].formattedSpread:
//   public/standings.js  displaySchedule, via getAllBettingLines
//   public/userHome.js   buildGameCard
//   public/team.js       renderTeamScheduleInfo
//
// Each one matches a line to a game on homeTeam + awayTeam, then picks the
// DraftKings entry (or the first) and splits its formattedSpread. Nothing reads
// spread, spreadOpen, overUnder, overUnderOpen, the moneylines, the conferences,
// the classifications, the scores, startDate, week or seasonType.
//
// Unprojected, that cost (measured against a dev copy of prod):
//   season 2026:  994 docs,  518KB, 6050ms   ->  115KB, 1747ms
//   season 2025: 1597 docs, 1196KB, 12833ms  ->  290KB, 4236ms
//
// Bytes, not query time: the cluster is a free-tier M0 capped near 85KB/s, so
// the payload IS the latency. Past seasons are worse than the current one
// because a finished season has every week's lines in it.
//
// Nested _id cannot be excluded alongside an inclusion projection (Mongo rejects
// it with "Cannot do inclusion on field homeTeam in exclusion projection"), but
// it does not need to be — Mongoose leaves lines[]._id out when the projection
// names nested fields, so the shape is already clean.
const LINE_READ_FIELDS = {
    _id: 0,
    homeTeam: 1, awayTeam: 1,
    'lines.provider': 1, 'lines.formattedSpread': 1
};

// Getting All
//
// No caller in the app reaches this — every consumer asks for a season. It is
// projected anyway rather than left as a bare find(): GET is open to any
// authenticated member (see server.js), and unprojected this scans all 4164
// stored lines across every season in one response.
router.get('/', async (req, res) => {
    try {
        const bettingLines = await Betting.find({}, LINE_READ_FIELDS).lean();
        res.json(bettingLines);
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

// Getting All By Season
router.get('/:year', async (req, res) => {
    try {
        const bettingLines = await Betting.find({season: req.params.year}, LINE_READ_FIELDS).lean();

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