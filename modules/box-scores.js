// CFBD /games/teams box-score fetch — post-game team stats.
//
// Called once per game when it newly completes (from the live update pipeline).
// Stores stat categories on the Game doc's `teamStats` map so the game detail
// view can render the team comparison and parlay resolution can grade stat legs
// without another API call.
//
// Fetched a WEEK AT A TIME, not by game id. `gameId` alone is rejected —
// CFBD answers 400 "either week, team, or conference are required" — and when a
// week IS supplied the gameId filter is ignored outright (a single-id request
// comes back with the whole week). So the only working shape is to pull the week
// and filter to the ids we want locally, exactly as player-box-scores.js does.

const Game = require('../models/game');

const CFBD_BASE = 'https://api.collegefootballdata.com';

// Stat keys returned by CFBD /games/teams → our Game schema field names.
// Keys must match CFBD's category strings EXACTLY; an unmatched key is silently
// skipped by normalizeTeamStats, so a typo reads as "this game had no TFLs"
// rather than as an error. Only the categories the game detail comparison and
// the stat-parlay legs actually use.
const STAT_MAP = {
    'totalYards':          'totalYards',
    'netPassingYards':     'netPassingYards',
    'rushingYards':        'rushingYards',
    'passingTDs':          'passingTDs',
    'rushingTDs':          'rushingTDs',
    'turnovers':           'turnovers',
    'fumblesLost':         'fumblesLost',
    'interceptions':       'interceptions',
    'tacklesForLoss':      'tacklesForLoss',
    'sacks':               'sacks',
    'thirdDownEff':        'thirdDownPct',
    'fourthDownEff':       'fourthDownPct',
    'possessionTime':      'possessionSeconds',
};

// `totalPenaltiesYards` is the one category that carries two numbers: CFBD sends
// it as "5-35" (count-yards). It's handled outside STAT_MAP because it fills two
// schema fields — `penalties` (the count) and `totalPenaltiesYards` (the yards).
const PENALTIES_CATEGORY = 'totalPenaltiesYards';

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

// Split CFBD's "5-35" penalties value into { penalties: 5, totalPenaltiesYards: 35 }.
// Returns an empty object for anything that isn't that shape.
function parsePenalties(raw) {
    if (raw == null) return {};
    const parts = String(raw).split('-');
    if (parts.length !== 2) return {};
    const count = parseFloat(parts[0]);
    const yards = parseFloat(parts[1]);
    if (isNaN(count) || isNaN(yards)) return {};
    return { penalties: count, totalPenaltiesYards: yards };
}

// Transform a CFBD team stats array [{ category, stat }] into our flat object.
function normalizeTeamStats(cfbdStats) {
    if (!Array.isArray(cfbdStats)) return {};
    const out = {};
    for (const entry of cfbdStats) {
        if (entry.category === PENALTIES_CATEGORY) {
            Object.assign(out, parsePenalties(entry.stat));
            continue;
        }
        const mapped = STAT_MAP[entry.category];
        if (!mapped) continue;
        const v = parseStatValue(entry.category, entry.stat);
        if (v !== undefined) out[mapped] = v;
    }
    return out;
}

// Fetch every box score for one week from CFBD /games/teams. One call covers
// the whole week, so callers filter to the games they care about rather than
// paying per game. Returns { games: [...], remainingCalls }.
async function fetchBoxScores(season, week, seasonType) {
    const st = seasonType === 'postseason' ? 'postseason' : 'regular';
    const url = `${CFBD_BASE}/games/teams?year=${season}&week=${week}&seasonType=${st}&classification=fbs`;
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

// Ingest team box scores for a week, writing teamStats onto each Game doc.
// When gameIds is provided only those games are updated (the post-completion
// hook); when omitted every game in the week is (backfill). Signature mirrors
// ingestPlayerStats so the two hooks read the same at the call site.
// Returns { ingested, remainingCalls }.
async function ingestBoxScores(season, week, seasonType, gameIds) {
    const { games, remainingCalls } = await fetchBoxScores(season, week, seasonType);
    let ingested = 0;

    for (const g of games) {
        if (!g.id) continue;
        if (gameIds && gameIds.length && !gameIds.includes(g.id)) continue;

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
    fetchBoxScores, normalizeTeamStats, parseStatValue, parsePenalties,
    ingestBoxScores, STAT_MAP, PENALTIES_CATEGORY
};
