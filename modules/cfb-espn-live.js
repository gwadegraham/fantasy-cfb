// Football's live box score from ESPN's summary feed (modules/espn-summary.js),
// in the shapes CFBD's post-game ingest stores, so the game page draws both
// with the same code.
//
// Same rule as basketball (modules/hoops-espn-live.js): ESPN only while CFBD
// has nothing. CFBD's /games/players and /games/teams land after the game
// (modules/player-box-scores.js, box-scores.js); until then the page has no
// box at all. Nothing in scoring reads this.
//
// ---- ids ----
//
// CFBD's football game ids ARE ESPN event ids, and its team ids are ESPN's
// team ids, so no lookup is needed. Sides are still matched on team id, never
// on ESPN's homeAway: at a neutral site the two disagree (#632, #657).
//
// ---- the feed ----
//
// boxscore.players[] is one entry per team, each with statistics[] per
// category: { name, labels: ['C/ATT', 'YDS', ...], athletes: [{ athlete,
// stats: ['9/15', '111', ...] }] }. The labels are CFBD's own stat names, so
// each category is turned into CFBD's { name, athletes: [{ name, stat }] }
// types and run through CFBD's normalizers. Verified live 4 Nov 2026 (three
// MAC games sampled every 3 min): the player lines grow play by play.
//
// What ESPN does not send live: QBR (null here, so the page drops the
// column), interceptions in the defensive line (a category of its own, merged
// in), and the team totals for TDs, sacks and TFL (summed from every player).

const { CATEGORY_NORMALIZERS } = require('./player-box-scores');
const { normalizeTeamStats } = require('./box-scores');
const espnSummary = require('./espn-summary');

// How long after kickoff a final with no CFBD box yet still gets ESPN's.
// CFBD's player box lands within hours (on each Saturday completion batch,
// else when the day's last game ends, else the weekly enrichment); past this,
// a game that never got one shows none, as it does today.
const LOOKBACK_MS = 3 * 24 * 3600 * 1000;

// ESPN's own team-total row ("Team", sometimes " Team") under rushing and
// fumbles. Not a player.
const isTeamRow = (name) => String(name || '').trim().toLowerCase() === 'team';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

// One ESPN category → CFBD's types: one entry per stat label.
function typesOf(cat) {
    const athletes = (cat.athletes || []).filter(a => a && a.athlete && !isTeamRow(a.athlete.displayName));
    return (cat.labels || []).map((label, i) => ({
        name: label,
        athletes: athletes.map(a => ({ name: String(a.athlete.displayName).trim(), stat: (a.stats || [])[i] }))
    }));
}

const sumOf = (cat, label) => {
    if (!cat) return 0;
    const i = (cat.labels || []).indexOf(label);
    if (i < 0) return 0;
    return (cat.athletes || []).filter(a => a && a.athlete && !isTeamRow(a.athlete.displayName))
        .reduce((s, a) => s + num((a.stats || [])[i]), 0);
};

function playerStatsOf(team) {
    const cats = {};
    for (const c of team.statistics || []) cats[c.name] = c;
    const out = {};
    for (const [name, fn] of Object.entries(CATEGORY_NORMALIZERS)) {
        if (!cats[name]) continue;
        const types = typesOf(cats[name]);
        if (name === 'defensive' && cats.interceptions) {
            const ints = typesOf(cats.interceptions).find(t => t.name === 'INT');
            if (ints) types.push(ints);
        }
        out[name] = fn(types);
    }
    // CFBD carries QBR; ESPN's live passing line does not. Null, not 0.
    for (const p of out.passing || []) p.qbr = null;
    return out;
}

function teamStatsOf(boxTeam, players) {
    const cats = {};
    for (const c of (players && players.statistics) || []) cats[c.name] = c;
    const out = normalizeTeamStats((boxTeam.statistics || []).map(s => ({ category: s.name, stat: s.displayValue })));
    return Object.assign(out, {
        passingTDs: sumOf(cats.passing, 'TD'),
        rushingTDs: sumOf(cats.rushing, 'TD'),
        sacks: sumOf(cats.defensive, 'SACKS'),
        tacklesForLoss: sumOf(cats.defensive, 'TFL')
    });
}

// ESPN's game leaders per side: { passingYards, rushingYards, receivingYards,
// totalTackles } → { name, pos, line } with line ESPN's own ("9/15, 111 YDS, 1 TD").
function leadersOf(entry) {
    const out = {};
    for (const L of (entry && entry.leaders) || []) {
        const top = L && L.leaders && L.leaders[0];
        if (!top || !top.athlete) continue;
        out[L.name] = {
            name: String(top.athlete.displayName || '').trim(),
            pos: (top.athlete.position && top.athlete.position.abbreviation) || null,
            line: top.displayValue || ''
        };
    }
    return out;
}

// The shaper espn-summary caches for one game: summary → { playerStats,
// teamStats, leaders }, each { home, away } on OUR sides, or null when the
// feed has no box yet or its teams are not this game's.
function shape(game) {
    const sideOf = (id) => (String(id) === String(game.homeId) ? 'home' : String(id) === String(game.awayId) ? 'away' : null);
    return function (body) {
        const box = body && body.boxscore;
        const players = (box && box.players) || [];
        if (!players.length) return null;
        const out = { playerStats: { home: null, away: null }, teamStats: { home: null, away: null }, leaders: { home: {}, away: {} } };
        for (const p of players) {
            const s = p && p.team ? sideOf(p.team.id) : null;
            if (s) out.playerStats[s] = playerStatsOf(p);
        }
        // Both sides or nothing: one unmatched team means the ids are wrong,
        // and half a box under the wrong names is worse than none.
        if (!out.playerStats.home || !out.playerStats.away) return null;
        for (const t of box.teams || []) {
            const s = t && t.team ? sideOf(t.team.id) : null;
            if (s) out.teamStats[s] = teamStatsOf(t, players.find(p => p.team && String(p.team.id) === String(t.team.id)));
        }
        for (const l of body.leaders || []) {
            const s = l && l.team ? sideOf(l.team.id) : null;
            if (s) out.leaders[s] = leadersOf(l);
        }
        return out;
    };
}

const hasBox = (ps) => !!ps && ['home', 'away'].some(k => ps[k] && Object.keys(ps[k]).length);

// Whether ESPN's box stands in for this game: started and not complete, or
// complete with no CFBD box yet, inside the lookback.
function wantsEspn(game, now = Date.now()) {
    if (!game || !game.startDate) return false;
    const start = new Date(game.startDate).getTime();
    if (!(start <= now)) return false;
    if (!game.completed) return true;
    return !hasBox(game.playerStats) && now - start <= LOOKBACK_MS;
}

// { source: 'espn', final, playerStats, teamStats, leaders } or null.
async function forGame(game, { now = Date.now() } = {}) {
    if (!wantsEspn(game, now)) return null;
    const r = await espnSummary.summaryFor('football', game.id, shape(game), now);
    if (!r.value) return null;
    return Object.assign({ source: 'espn', final: !!game.completed }, r.value);
}

module.exports = { shape, forGame, wantsEspn, typesOf, isTeamRow, LOOKBACK_MS };
