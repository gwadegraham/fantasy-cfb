// Basketball live scores from CBBD /scoreboard (#505) — the counterpart of
// football's modules/scoreboard.js.
//
// /scoreboard is QUOTA-FREE (it does not count against the shared 30k pool),
// which is what makes polling it every few seconds on game nights affordable.
// Shape, from CBBD's published spec (api-docs.json, ScoreboardGame): id,
// status (scheduled | in_progress | final | postponed | cancelled), period,
// clock, and per side { id, points, lineScores }. There is no possession or
// last-play detail, unlike football's.
//
// ⚠️ UNVERIFIED AGAINST A LIVE GAME as of Oct 2026 — the endpoint returns []
// out of season. The shape is the spec's; whether its `id` is the same id
// /games returns (the one our rows carry) is assumed, not observed. The poll
// reports how many scoreboard rows matched a stored game, so a mismatch shows
// up as "0 of 140 matched" on the first night rather than as silence.

const HoopsGame = require('../models/hoopsGame');

const LIVE = new Set(['in_progress', 'final']);

function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// The $set for one scoreboard row, or null if there is nothing to write.
//
// Points are written only once a game is under way or over: CBBD sends 0-0
// on a SCHEDULED game (routes/hoopsGames.js documents the same trap on the
// ingest), and storing those zeros would make every unplayed game a 0-0
// result. A FINAL already stored is never walked back to in_progress — a
// lagging scoreboard must not un-finish a game that has been scored.
// Only what CHANGED is returned (null when nothing did), so a poll over an
// unchanged scoreboard writes nothing — no bulkWrite, and no JobRun, on a
// quiet minute of a busy night.
function changedOnly(set, stored) {
    if (!stored) return set;
    const same = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
    const out = {};
    for (const [k, v] of Object.entries(set)) if (!same(v, stored[k])) out[k] = v;
    return Object.keys(out).length ? out : null;
}

function updateFor(row, stored) {
    if (!row || row.id == null || !row.status) return null;
    const status = String(row.status).toLowerCase();
    if (stored && stored.status === 'final' && status !== 'final') return null;
    const set = { status };
    if (LIVE.has(status)) {
        const home = num(row.homeTeam && row.homeTeam.points);
        const away = num(row.awayTeam && row.awayTeam.points);
        if (home !== null) set.homePoints = home;
        if (away !== null) set.awayPoints = away;
        const hl = row.homeTeam && row.homeTeam.lineScores;
        const al = row.awayTeam && row.awayTeam.lineScores;
        if (Array.isArray(hl)) set.homePeriodPoints = hl.map(Number);
        if (Array.isArray(al)) set.awayPeriodPoints = al.map(Number);
        if (num(row.period) !== null) set.period = num(row.period);
        if (row.clock != null) set.clock = String(row.clock);
        if (status === 'final' && home !== null && away !== null && home !== away) {
            set.homeWinner = home > away;
            set.awayWinner = away > home;
        }
    }
    return changedOnly(set, stored);
}

// Apply a scoreboard payload to the stored games. Returns what changed and
// which games went final on this pass (with the week they belong to, for the
// completion batch).
async function applyScoreboard(rows) {
    const list = (rows || []).filter(r => r && r.id != null);
    if (!list.length) return { rows: 0, matched: 0, updated: 0, newlyFinal: [] };
    const ids = list.map(r => Number(r.id));
    const stored = await HoopsGame.find({ id: { $in: ids } }, {
        id: 1, status: 1, week: 1, season: 1, seasonType: 1, homePoints: 1, awayPoints: 1,
        homePeriodPoints: 1, awayPeriodPoints: 1, period: 1, clock: 1, homeWinner: 1, awayWinner: 1, _id: 0
    }).lean();
    const byId = new Map(stored.map(g => [Number(g.id), g]));

    const ops = [];
    const newlyFinal = [];
    for (const row of list) {
        const prev = byId.get(Number(row.id));
        if (!prev) continue;
        const set = updateFor(row, prev);
        if (!set) continue;
        ops.push({ updateOne: { filter: { id: Number(row.id) }, update: { $set: set } } });
        // Read the result off the row as it now stands — a final whose score
        // was already stored by an earlier in-progress poll carries no points
        // in its (changed-only) $set.
        const home = set.homePoints != null ? set.homePoints : prev.homePoints;
        const away = set.awayPoints != null ? set.awayPoints : prev.awayPoints;
        if (set.status === 'final' && prev.status !== 'final'
            && home != null && away != null && home !== away) {
            newlyFinal.push({ id: Number(row.id), week: prev.week, season: prev.season, seasonType: prev.seasonType || 'regular' });
        }
    }
    if (ops.length) await HoopsGame.bulkWrite(ops, { ordered: false });
    return { rows: list.length, matched: byId.size, updated: ops.length, newlyFinal };
}

module.exports = { applyScoreboard, updateFor };
