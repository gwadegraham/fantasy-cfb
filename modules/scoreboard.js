// CFBD /scoreboard integration — lightweight live-score updates.
//
// The live poller calls updateFromScoreboard() every 2 min during games.
// It writes in-progress scores (homePoints/awayPoints) and live state
// (period, clock, possession, status) to existing Game docs, then returns
// which games newly completed so the caller can trigger scoring + parlays.
//
// It also appends to game.wpSnapshots — the accumulated win-probability curve.
// That series can only be built live (see the field's comment in models/game.js),
// so every tick that isn't recorded is a hole in the chart that cannot be filled
// in later.
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
        // NOTE the nesting: CFBD sends win probability per team, inside the
        // homeTeam/awayTeam objects — there is no top-level homeWinProb. It is
        // populated ONLY while status is in_progress (null when scheduled, and
        // null again once completed), so an absent value is normal, not an error.
        homeWinProb: home.winProbability != null ? home.winProbability : undefined
    };
}

// Build the win-probability snapshot for an in-progress tick, or null when this
// game has nothing to record (not live, or CFBD withheld winProbability).
function buildSnapshot(norm, now) {
    if (norm.completed) return null;
    if (norm.homeWinProb == null) return null;
    return {
        at: now,
        period: norm.period != null ? norm.period : undefined,
        clock: norm.clock,
        homeWinProb: norm.homeWinProb,
        homePoints: norm.homePoints,
        awayPoints: norm.awayPoints,
        situation: norm.situation,
        lastPlay: norm.lastPlay
    };
}

// The closing point of the curve, written on the tick a game goes final. CFBD
// stops sending winProbability the moment a game completes, so the true 1/0
// ending has to come from the score instead — without this the chart just stops
// at whatever the last live sample happened to say.
function buildFinalSnapshot(norm, now) {
    if (!norm.completed) return null;
    if (norm.homePoints == null || norm.awayPoints == null) return null;
    const homeWon = norm.homePoints > norm.awayPoints;
    const tied = norm.homePoints === norm.awayPoints;
    return {
        at: now,
        period: norm.period != null ? norm.period : undefined,
        clock: '0:00',
        homeWinProb: tied ? 0.5 : (homeWon ? 1 : 0),
        homePoints: norm.homePoints,
        awayPoints: norm.awayPoints
    };
}

// Drop a snapshot that repeats the previous one. The poller fires on a wall
// clock, but the game clock stops — a timeout, a review, or a TV break can leave
// two ticks describing the identical game moment. Without this the series grows
// flat duplicates that distort a chart plotted against game clock.
function isDuplicateSnapshot(last, snap) {
    if (!last || !snap) return false;
    return last.period === snap.period
        && last.clock === snap.clock
        && last.homeWinProb === snap.homeWinProb;
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
    // $slice: -1 pulls only the trailing snapshot, not the whole accumulated
    // series — by late season a game doc holds ~100 of them.
    const existing = await Game.find(
        { id: { $in: sbIds } },
        { id: 1, completed: 1, wpSnapshots: { $slice: -1 } }
    ).lean();
    const wasCompleted = new Set(existing.filter(g => g.completed).map(g => g.id));
    const lastSnapshot = new Map(existing.map(g => [g.id, (g.wpSnapshots || [])[0] || null]));

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

        // Accumulate the win-probability curve. A live tick appends the current
        // sample; the tick that flips a game final appends the terminal 1/0.
        // Both are $push, so the series survives the $set clears above.
        const now = new Date();
        const snap = norm.completed && !wasCompleted.has(sb.id)
            ? buildFinalSnapshot(norm, now)
            : buildSnapshot(norm, now);
        const update = { $set };
        if (snap && !isDuplicateSnapshot(lastSnapshot.get(sb.id), snap)) {
            update.$push = { wpSnapshots: snap };
        }

        const result = await Game.updateOne({ id: sb.id }, update);
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
    fetchScoreboard, normalizeScoreboardGame, updateFromScoreboard,
    buildSnapshot, buildFinalSnapshot, isDuplicateSnapshot
};
