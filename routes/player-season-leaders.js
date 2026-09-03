const express = require('express');
const router = express.Router();
const PlayerSeasonLeader = require('../models/playerSeasonLeader');

const LEADERS_PER_CATEGORY = 2;

const CATEGORY_DEFS = {
    passing: {
        source: 'passing',
        sortBy: 'YDS',
        stats: ['ATT', 'COMPLETIONS', 'YDS', 'TD', 'INT', 'PCT']
    },
    rushing: {
        source: 'rushing',
        sortBy: 'YDS',
        stats: ['CAR', 'YDS', 'TD', 'YPC']
    },
    receiving: {
        source: 'receiving',
        sortBy: 'YDS',
        stats: ['REC', 'YDS', 'TD', 'YPR']
    },
    tackles: {
        source: 'defensive',
        sortBy: 'TOT',
        stats: ['TOT', 'SOLO', 'TFL', 'SACKS']
    },
    sacks: {
        source: 'defensive',
        sortBy: 'SACKS',
        stats: ['SACKS', 'TFL', 'QB HUR']
    },
    interceptions: {
        source: 'interceptions',
        sortBy: 'INT',
        stats: ['INT', 'YDS', 'TD']
    },
    kicking: {
        source: 'kicking',
        sortBy: 'PTS',
        stats: ['FGM', 'FGA', 'XPM', 'XPA', 'PTS']
    }
};

function pivotPlayers(rows) {
    const byTeam = {};
    for (const row of rows) {
        if (!byTeam[row.team]) byTeam[row.team] = {};
        const teamPlayers = byTeam[row.team];

        const cat = row.category;
        if (!teamPlayers[cat]) teamPlayers[cat] = {};

        const pid = row.playerId;
        if (!teamPlayers[cat][pid]) {
            teamPlayers[cat][pid] = {
                playerId: row.playerId,
                name: row.player,
                position: row.position || null,
                team: row.team,
                stats: {}
            };
        }
        teamPlayers[cat][pid].stats[row.statType] = parseFloat(row.stat) || 0;
    }
    return byTeam;
}

function pickLeaders(teamPlayers) {
    const leaders = {};

    for (const [catKey, def] of Object.entries(CATEGORY_DEFS)) {
        const pool = teamPlayers[def.source];
        if (!pool) { leaders[catKey] = []; continue; }

        let players = Object.values(pool);

        // For sacks, only players with at least 1 sack
        if (catKey === 'sacks') {
            players = players.filter(p => (p.stats.SACKS || 0) >= 1);
        }
        // For interceptions, at least 1 INT
        if (catKey === 'interceptions') {
            players = players.filter(p => (p.stats.INT || 0) >= 1);
        }

        players.sort((a, b) => (b.stats[def.sortBy] || 0) - (a.stats[def.sortBy] || 0));

        leaders[catKey] = players.slice(0, LEADERS_PER_CATEGORY).map(p => {
            const entry = { name: p.name, pos: p.position };
            for (const st of def.stats) {
                let v = p.stats[st] || 0;
                if (st === 'PCT' && v > 0) v = v <= 1 ? Math.round(v * 100) : Math.round(v);
                entry[st] = v;
            }
            return entry;
        });
    }

    return leaders;
}

router.post('/ingest/:year', async (req, res) => {
    try {
        const year = req.params.year;
        const response = await fetch(
            `https://api.collegefootballdata.com/stats/player/season?year=${year}`,
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

        const byTeam = pivotPlayers(rows);

        const ops = Object.entries(byTeam).map(([team, teamPlayers]) => ({
            updateOne: {
                filter: { season: Number(year), team },
                update: {
                    $set: {
                        season: Number(year),
                        team,
                        leaders: pickLeaders(teamPlayers)
                    }
                },
                upsert: true
            }
        }));

        const result = ops.length
            ? await PlayerSeasonLeader.bulkWrite(ops, { ordered: false })
            : { upsertedCount: 0, modifiedCount: 0 };

        const created = result.upsertedCount || 0;
        console.log(`Player season leaders for ${year}: ${ops.length} teams, ${created} new, ${result.modifiedCount || 0} updated`);
        res.json({ teams: ops.length, created, updated: result.modifiedCount || 0 });
    } catch (err) {
        console.error('Player season leaders ingest error:', err);
        res.status(500).json({ message: err.message });
    }
});

router.get('/', async (req, res) => {
    try {
        const season = req.query.season || process.env.YEAR;
        const teams = req.query.teams ? req.query.teams.split(',') : [];
        if (!teams.length) return res.json([]);

        const docs = await PlayerSeasonLeader.find({ season, team: { $in: teams } }).lean();
        res.json(docs.map(d => ({ season: d.season, team: d.team, leaders: d.leaders })));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
module.exports.CATEGORY_DEFS = CATEGORY_DEFS;
module.exports.pivotPlayers = pivotPlayers;
module.exports.pickLeaders = pickLeaders;
