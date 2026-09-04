// CFBD /scoreboard integration — lightweight live-score updates.
//
// The live poller calls updateFromScoreboard() every 10 min during games.
// It writes in-progress scores (homePoints/awayPoints) and live state
// (period, clock, possession, status) to existing Game docs, then returns
// which games newly completed so the caller can trigger scoring + parlays.
//
// Compared to the full /games endpoint that runFullUpdate uses:
//   - /scoreboard returns in-progress scores (not just final)
//   - Response is lighter (fewer fields, no ELO/excitement/highlights)
//   - Same 1 CFBD call per tick

const Game = require('../models/game');

const CFBD_BASE = 'https://api.collegefootballdata.com';

// Fetch the live scoreboard from CFBD. Returns { games, remainingCalls }.
async function fetchScoreboard() {
    const res = await fetch(`${CFBD_BASE}/scoreboard`, {
        headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
        }
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`CFBD /scoreboard ${res.status}: ${body.slice(0, 200)}`);
    }

    const remHeader = res.headers.get('x-calllimit-remaining');
    const remainingCalls = remHeader != null ? Number(remHeader) : null;
    const games = await res.json();

    return { games: Array.isArray(games) ? games : [], remainingCalls };
}

// Normalize the scoreboard's nested team objects into flat fields that match
// the Game schema. The scoreboard nests scores under homeTeam/awayTeam objects:
//   { id, homeTeam: { id, name, conference, points, ... }, awayTeam: { ... }, ... }
function normalizeScoreboardGame(sb) {
    const home = sb.homeTeam || {};
    const away = sb.awayTeam || {};
    const completed = sb.status === 'completed' || sb.status === 'final';

    return {
        id: sb.id,
        homePoints: home.points != null ? home.points : undefined,
        awayPoints: away.points != null ? away.points : undefined,
        homeLineScores: Array.isArray(home.lineScores) ? home.lineScores : undefined,
        awayLineScores: Array.isArray(away.lineScores) ? away.lineScores : undefined,
        completed,
        period: sb.period != null ? sb.period : undefined,
        clock: sb.clock || undefined,
        possession: sb.possession || undefined,
        status: sb.status || undefined,
        situation: sb.situation || undefined,
        lastPlay: sb.lastPlay || undefined,
        homeWinProb: sb.homeWinProb != null ? sb.homeWinProb : undefined
    };
}

// Update Game docs from scoreboard data. Only updates games that already exist
// in the DB (the schedule is pre-loaded). Returns { updated, newlyCompleted, remainingCalls }.
async function updateFromScoreboard() {
    const { games: sbGames, remainingCalls } = await fetchScoreboard();

    if (!sbGames.length) {
        return { updated: 0, newlyCompleted: [], remainingCalls };
    }

    // Batch-read existing games to know which ones are newly completing
    const sbIds = sbGames.map(g => g.id).filter(Boolean);
    const existing = await Game.find({ id: { $in: sbIds } }, { id: 1, completed: 1 }).lean();
    const wasCompleted = new Set(existing.filter(g => g.completed).map(g => g.id));

    let updated = 0;
    const newlyCompleted = [];

    for (const sb of sbGames) {
        if (!sb.id) continue;

        const norm = normalizeScoreboardGame(sb);
        const $set = { lastUpdated: new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }) };

        if (norm.homePoints !== undefined) $set.homePoints = norm.homePoints;
        if (norm.awayPoints !== undefined) $set.awayPoints = norm.awayPoints;
        if (norm.homeLineScores) $set.homeLineScores = norm.homeLineScores;
        if (norm.awayLineScores) $set.awayLineScores = norm.awayLineScores;
        if (norm.period !== undefined) $set.period = norm.period;
        if (norm.clock !== undefined) $set.clock = norm.clock;
        if (norm.possession !== undefined) $set.possession = norm.possession;
        if (norm.status !== undefined) $set.status = norm.status;
        if (norm.situation !== undefined) $set.situation = norm.situation;
        if (norm.lastPlay !== undefined) $set.lastPlay = norm.lastPlay;
        if (norm.homeWinProb !== undefined) $set.liveHomeWinProb = norm.homeWinProb;
        // Order matters: the clears below have to overwrite the assignments above,
        // because CFBD keeps sending lastPlay ("End of 4th quarter.") after a game
        // is final. Idempotent — a later tick on an already-final game re-clears.
        if (norm.completed) {
            $set.completed = true;
            $set.liveHomeWinProb = null;
            $set.situation = null;
            $set.lastPlay = null;
        }

        const result = await Game.updateOne({ id: sb.id }, { $set });
        if (result.modifiedCount > 0) {
            updated++;
            if (norm.completed && !wasCompleted.has(sb.id)) {
                newlyCompleted.push(sb.id);
            }
        }
    }

    if (updated) console.log(`Scoreboard: updated ${updated} game(s), ${newlyCompleted.length} newly completed`);
    return { updated, newlyCompleted, remainingCalls };
}

module.exports = {
    fetchScoreboard, normalizeScoreboardGame, updateFromScoreboard
};
