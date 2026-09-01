// CFBD /games/players box-score fetch — per-player stats.
//
// Called after games complete (from the live update pipeline) or weekly via the
// enrichment job. Stores top performers per stat category on the Game doc's
// `playerStats` map so the game detail view can render a full box score.
//
// Ingestion strategy:
//   - Saturday + CFP days: called on each game-completion batch (same hook as
//     team box scores) so box scores are available within minutes.
//   - Other game days: called once when the last game of the day finishes.
//   - Enrichment job: weekly backfill/catch-up for any games that were missed.

const Game = require('../models/game');

const CFBD_BASE = 'https://api.collegefootballdata.com';

// How many players to keep per category (the rest are noise on a box score).
const LIMITS = { passing: 2, rushing: 5, receiving: 6, defensive: 6, kicking: 2, punting: 2 };

// ---- stat extractors -------------------------------------------------------
// CFBD /games/players nests stats as:
//   game.teams[].categories[].types[].athletes[]
// Each type has { name (stat name), athletes: [{ id, name, stat }] }.
// We flatten by category into one object per athlete, then sort/trim.

function num(v) {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
}

// Collect athletes from a CFBD category, keyed by athlete name.
// Returns Map<name, { name, ...stats }>.
function collectAthletes(types) {
    const byName = new Map();
    for (const t of (types || [])) {
        for (const a of (t.athletes || [])) {
            const name = a.name || 'Unknown';
            if (!byName.has(name)) byName.set(name, { name });
            byName.get(name)[t.name] = a.stat;
        }
    }
    return byName;
}

function normalizePassing(types) {
    const athletes = collectAthletes(types);
    return [...athletes.values()]
        .map(a => {
            const ca = String(a['C/ATT'] || '0/0').split('/');
            return {
                name: a.name,
                c: num(ca[0]),
                att: num(ca[1]),
                yds: num(a.YDS),
                td: num(a.TD),
                int: num(a.INT),
                qbr: num(a.QBR),
            };
        })
        .filter(p => p.att > 0)
        .sort((a, b) => b.yds - a.yds)
        .slice(0, LIMITS.passing);
}

function normalizeRushing(types) {
    const athletes = collectAthletes(types);
    return [...athletes.values()]
        .map(a => ({
            name: a.name,
            car: num(a.CAR),
            yds: num(a.YDS),
            td: num(a.TD),
            lng: num(a.LONG),
        }))
        .filter(p => p.car > 0)
        .sort((a, b) => b.yds - a.yds)
        .slice(0, LIMITS.rushing);
}

function normalizeReceiving(types) {
    const athletes = collectAthletes(types);
    return [...athletes.values()]
        .map(a => ({
            name: a.name,
            rec: num(a.REC),
            yds: num(a.YDS),
            td: num(a.TD),
            lng: num(a.LONG),
        }))
        .filter(p => p.rec > 0)
        .sort((a, b) => b.yds - a.yds)
        .slice(0, LIMITS.receiving);
}

function normalizeDefensive(types) {
    const athletes = collectAthletes(types);
    return [...athletes.values()]
        .map(a => ({
            name: a.name,
            tot: num(a.TOT),
            solo: num(a.SOLO),
            tfl: num(a.TFL),
            sacks: num(a.SACKS),
            int: num(a.INT),
        }))
        .filter(p => p.tot > 0)
        .sort((a, b) => b.tot - a.tot)
        .slice(0, LIMITS.defensive);
}

function normalizeKicking(types) {
    const athletes = collectAthletes(types);
    return [...athletes.values()]
        .map(a => {
            const fg = String(a.FG || '0/0').split('/');
            const xp = String(a.XP || '0/0').split('/');
            const fgm = num(fg[0]), fga = num(fg[1]);
            const xpm = num(xp[0]), xpa = num(xp[1]);
            return {
                name: a.name,
                fgm, fga,
                pct: fga > 0 ? Math.round((fgm / fga) * 1000) / 10 : 0,
                lng: num(a.LONG),
                xpm, xpa,
                pts: num(a.PTS),
            };
        })
        .filter(p => p.fga > 0 || p.xpa > 0)
        .sort((a, b) => b.pts - a.pts)
        .slice(0, LIMITS.kicking);
}

function normalizePunting(types) {
    const athletes = collectAthletes(types);
    return [...athletes.values()]
        .map(a => ({
            name: a.name,
            no: num(a.NO),
            yds: num(a.YDS),
            avg: num(a.AVG),
            lng: num(a.LONG),
            tb: num(a.TB),
            in20: num(a.In_20 || a.IN_20 || a['In 20']),
        }))
        .filter(p => p.no > 0)
        .sort((a, b) => b.no - a.no)
        .slice(0, LIMITS.punting);
}

const CATEGORY_NORMALIZERS = {
    passing:       normalizePassing,
    rushing:       normalizeRushing,
    receiving:     normalizeReceiving,
    defensive:     normalizeDefensive,
    kicking:       normalizeKicking,
    punting:       normalizePunting,
};

// Normalize one team's categories array into our schema shape.
function normalizePlayerStats(categories) {
    if (!Array.isArray(categories)) return {};
    const out = {};
    for (const cat of categories) {
        const fn = CATEGORY_NORMALIZERS[cat.name];
        if (fn) out[cat.name] = fn(cat.types);
    }
    return out;
}

// ---- CFBD fetch ------------------------------------------------------------

async function fetchPlayerStats(season, week, seasonType) {
    const st = seasonType === 'postseason' ? 'postseason' : 'regular';
    const url = `${CFBD_BASE}/games/players?year=${season}&week=${week}&seasonType=${st}&classification=fbs`;
    const res = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
        }
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`CFBD /games/players ${res.status}: ${body.slice(0, 200)}`);
    }
    const remHeader = res.headers.get('x-calllimit-remaining');
    const remainingCalls = remHeader != null ? Number(remHeader) : null;
    const data = await res.json();
    return { games: Array.isArray(data) ? data : [], remainingCalls };
}

// ---- ingest ----------------------------------------------------------------

// Ingest player box scores for a set of game IDs (or all games in a week).
// When gameIds is provided, only those games are updated (post-completion hook).
// When omitted, all games returned by the week query are updated (enrichment).
async function ingestPlayerStats(season, week, seasonType, gameIds) {
    const { games, remainingCalls } = await fetchPlayerStats(season, week, seasonType);
    let ingested = 0;

    for (const g of games) {
        if (!g.id) continue;
        if (gameIds && gameIds.length && !gameIds.includes(g.id)) continue;

        const teams = g.teams || [];
        const statsMap = {};
        for (const t of teams) {
            const side = (t.homeAway || '').toLowerCase();
            if (side !== 'home' && side !== 'away') continue;
            statsMap[side] = normalizePlayerStats(t.categories);
        }

        if (Object.keys(statsMap).length) {
            await Game.updateOne({ id: g.id }, { $set: { playerStats: statsMap } });
            ingested++;
        }
    }

    if (ingested) console.log(`Player box scores: ingested ${ingested} game(s)`);
    return { ingested, remainingCalls };
}

module.exports = {
    fetchPlayerStats, normalizePlayerStats, ingestPlayerStats,
    collectAthletes, LIMITS, CATEGORY_NORMALIZERS,
    // individual normalizers exported for testing
    normalizePassing, normalizeRushing, normalizeReceiving,
    normalizeDefensive, normalizeKicking, normalizePunting,
};
