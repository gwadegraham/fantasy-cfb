// Per-team player season leaders from CFBD /stats/player/season.
//
// The weekly job calls ingestSeasonLeaders directly instead of POSTing to
// the route. The route goes through Heroku's router, which answers 503 at
// 30 seconds whatever the handler is doing, and this is not a fast call:
// CFBD's response is ~25 MB by late October (one row per player per stat,
// growing every week) and took ~12s on its own. On 27 Oct 2026 the job
// failed at exactly 30s with an empty-bodied 503. In-process there is no
// router, so only CFBD's own timeout below applies.

const PlayerSeasonLeader = require('./../models/playerSeasonLeader');

const FETCH_TIMEOUT_MS = 120000;

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

// Fetches, pivots and upserts one season. Throws on any failure; a CFBD
// error carries its HTTP status as err.status so the route can pass it on.
async function ingestSeasonLeaders(year, fetchImpl = fetch) {
    const response = await fetchImpl(
        `https://api.collegefootballdata.com/stats/player/season?year=${year}`,
        {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': process.env.CFBD_API_KEY
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        }
    );

    if (!response.ok) {
        const err = new Error(`CFBD returned ${response.status}`);
        err.status = response.status;
        throw err;
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) {
        const err = new Error('CFBD response was not an array');
        err.status = 400;
        throw err;
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
    const updated = result.modifiedCount || 0;
    console.log(`Player season leaders for ${year}: ${ops.length} teams, ${created} new, ${updated} updated`);
    return { teams: ops.length, created, updated };
}

module.exports = { CATEGORY_DEFS, pivotPlayers, pickLeaders, ingestSeasonLeaders };
