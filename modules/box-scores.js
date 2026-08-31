// CFBD /games/teams box-score fetch — post-game team stats.
//
// Called once per game when it newly completes (from the live update pipeline).
// Stores stat categories on the Game doc's `teamStats` map so parlay resolution
// can read them without another API call.

const Game = require('../models/game');

const CFBD_BASE = 'https://api.collegefootballdata.com';

// Stat keys returned by CFBD /games/teams → our Game schema field names.
// CFBD names are lowercase-with-spaces ("net passing yards"); we normalise
// to camelCase for the schema. Only categories we care about for parlays.
const STAT_MAP = {
    'totalYards':          'totalYards',
    'netPassingYards':     'netPassingYards',
    'rushingYards':        'rushingYards',
    'passingTDs':          'passingTDs',
    'rushingTDs':          'rushingTDs',
    'turnovers':           'turnovers',
    'fumblesLost':         'fumblesLost',
    'interceptions':       'interceptions',
    'tackles For Loss':    'tacklesForLoss',
    'sacks':               'sacks',
    'penalties':           'penalties',
    'thirdDownEff':        'thirdDownPct',
    'fourthDownEff':       'fourthDownPct',
    'totalPenaltiesYards': 'totalPenaltiesYards',
    'possessionTime':      'possessionSeconds',
};

// Parse a CFBD stat value. Most are plain numbers, but some are fractions
// ("5-12" for third-down efficiency → 41.67) or "MM:SS" for possession time
// (→ total seconds).
function parseStatValue(key, raw) {
    if (raw == null) return undefined;
    const s = String(raw);

    if (key === 'possessionTime') {
        const parts = s.split(':');
        if (parts.length === 2) {
            const m = parseInt(parts[0], 10);
            const sec = parseInt(parts[1], 10);
            if (!isNaN(m) && !isNaN(sec)) return m * 60 + sec;
        }
        return undefined;
    }

    if (key === 'thirdDownEff' || key === 'fourthDownEff') {
        const parts = s.split('-');
        if (parts.length === 2) {
            const made = parseFloat(parts[0]);
            const att = parseFloat(parts[1]);
            if (!isNaN(made) && att > 0) return Math.round((made / att) * 10000) / 100;
        }
        return undefined;
    }

    const n = parseFloat(s);
    return isNaN(n) ? undefined : n;
}

// Transform a CFBD team stats array [{ category, stat }] into our flat object.
function normalizeTeamStats(cfbdStats) {
    if (!Array.isArray(cfbdStats)) return {};
    const out = {};
    for (const entry of cfbdStats) {
        const mapped = STAT_MAP[entry.category];
        if (!mapped) continue;
        const v = parseStatValue(entry.category, entry.stat);
        if (v !== undefined) out[mapped] = v;
    }
    return out;
}

// Fetch box scores for a batch of game IDs from CFBD /games/teams.
// Returns { games: [...], remainingCalls }.
async function fetchBoxScores(gameIds, season) {
    if (!gameIds || !gameIds.length) return { games: [], remainingCalls: null };

    const url = `${CFBD_BASE}/games/teams?year=${season}&gameId=${gameIds.join(',')}`;
    const res = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
        }
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`CFBD /games/teams ${res.status}: ${body.slice(0, 200)}`);
    }

    const remHeader = res.headers.get('x-calllimit-remaining');
    const remainingCalls = remHeader != null ? Number(remHeader) : null;
    const data = await res.json();

    return { games: Array.isArray(data) ? data : [], remainingCalls };
}

// Ingest box scores for newly completed games. Called with the array of game
// IDs that just flipped to completed. Writes teamStats to each Game doc.
// Returns { ingested, remainingCalls }.
async function ingestBoxScores(gameIds, season) {
    if (!gameIds || !gameIds.length) return { ingested: 0, remainingCalls: null };

    const { games, remainingCalls } = await fetchBoxScores(gameIds, season);
    let ingested = 0;

    for (const g of games) {
        if (!g.id) continue;

        // CFBD returns an array of team entries per game.
        // Each entry: { school, conference, homeAway, points, stats: [...] }
        const teams = g.teams || [];
        const statsMap = {};
        for (const t of teams) {
            const side = (t.homeAway || '').toLowerCase();
            if (side !== 'home' && side !== 'away') continue;
            const normalized = normalizeTeamStats(t.stats);
            // pointsAllowed = opponent's points
            const opp = teams.find(o => o !== t);
            if (opp && opp.points != null) normalized.pointsAllowed = opp.points;
            statsMap[side] = normalized;
        }

        if (Object.keys(statsMap).length) {
            await Game.updateOne({ id: g.id }, { $set: { teamStats: statsMap } });
            ingested++;
        }
    }

    if (ingested) console.log(`Box scores: ingested ${ingested} game(s)`);
    return { ingested, remainingCalls };
}

module.exports = {
    fetchBoxScores, normalizeTeamStats, parseStatValue, ingestBoxScores,
    STAT_MAP
};
