const express = require('express');
const router = express.Router();
const TeamSeasonStat = require('../models/teamSeasonStat');

// Ingest season stats from CFBD API and store in Mongo.
// Called by the weekly job via internalFetch.
router.post('/ingest/:year', async (req, res) => {
    try {
        const year = req.params.year;
        const response = await fetch(
            `https://api.collegefootballdata.com/stats/season?year=${year}&classification=fbs`,
            {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': process.env.CFBD_API_KEY
                }
            }
        );

        if (!response.ok) {
            return res.status(response.status).json({ message: `CFBD returned ${response.status}` });
        }

        const rows = await response.json();
        if (!Array.isArray(rows)) {
            return res.status(400).json({ message: 'CFBD response was not an array' });
        }

        // Pivot flat rows into per-team objects: { season, team, conference, stats: { statName: value } }
        const teamMap = {};
        for (const row of rows) {
            const key = row.team;
            if (!teamMap[key]) {
                teamMap[key] = { season: row.season, team: row.team, conference: row.conference, stats: {} };
            }
            teamMap[key].stats[row.statName] = row.statValue;
        }

        const ops = Object.values(teamMap).map(t => ({
            updateOne: {
                filter: { season: t.season, team: t.team },
                update: {
                    $set: {
                        season: t.season,
                        team: t.team,
                        conference: t.conference,
                        games: t.stats.games || 0,
                        stats: t.stats
                    }
                },
                upsert: true
            }
        }));

        const result = ops.length
            ? await TeamSeasonStat.bulkWrite(ops, { ordered: false })
            : { upsertedCount: 0, modifiedCount: 0 };

        const created = result.upsertedCount || 0;
        console.log(`Season stats for ${year}: ${ops.length} teams, ${created} new, ${result.modifiedCount || 0} updated`);
        res.json({ teams: ops.length, created, updated: result.modifiedCount || 0 });
    } catch (err) {
        console.error('Season stats ingest error:', err);
        res.status(500).json({ message: err.message });
    }
});

// Get season stats for specific teams (used by game detail page).
// Query: ?season=2026&teams=Florida State,New Mexico State
router.get('/', async (req, res) => {
    try {
        const season = req.query.season || process.env.YEAR;
        const teams = req.query.teams ? req.query.teams.split(',') : [];
        if (!teams.length) return res.json([]);

        const docs = await TeamSeasonStat.find({ season, team: { $in: teams } }).lean();

        // Convert Map to plain object for JSON serialization
        const result = docs.map(d => ({
            season: d.season,
            team: d.team,
            conference: d.conference,
            games: d.games,
            stats: d.stats instanceof Map ? Object.fromEntries(d.stats) : d.stats
        }));

        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
