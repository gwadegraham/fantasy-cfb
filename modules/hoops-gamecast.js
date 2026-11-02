// The basketball gamecast's play log, for GET /hoops/games/:id/plays.
//
// Same rule as the box score and the chart (modules/hoops-game-page.js):
// ESPN while the game is on; once it is final, CBBD's log as stored with the
// chart (modules/hoops-shots.js), ESPN standing in only inside the batch's
// lookback while that has not landed. Charts — and so stored logs — exist
// only for games with a drafted team, so an undrafted final's gamecast goes
// when the lookback closes, as its chart does.
//
// The ESPN call is the one espn-summary already caches for the page: the
// same shape feeds the box, the chart and this log, so the gamecast costs no
// extra request.

const HoopsTeam = require('../models/hoopsTeam');
const espnSummary = require('./espn-summary');
const espnLive = require('./hoops-espn-live');
const shotCharts = require('./hoops-shots');
const boxScore = require('./hoops-box-score');
const { isFinal } = require('./hoops-scoring-pass');

// The re-sent tail on a partial fetch. ESPN corrects recent plays (a scorer,
// an assist) for a minute or so after them; older ones settle.
const RESEND = 10;

// ESPN's shaped summary for one game ({ box, shots, plays }), or null. Sides
// are matched on each team's ESPN id: at a neutral site ESPN's home can be
// CBBD's away (modules/hoops-espn-live.js).
async function espnFor(game) {
    if (!game || !game.sourceId) return null;
    const ids = await HoopsTeam.find({ season: Number(game.season), id: { $in: [Number(game.homeTeamId), Number(game.awayTeamId)] } },
        { id: 1, sourceId: 1, _id: 0 }).lean();
    const src = (teamId) => { const t = ids.find(x => Number(x.id) === Number(teamId)); return t && t.sourceId ? String(t.sourceId) : null; };
    const r = await espnSummary.summaryFor('basketball', game.sourceId,
        espnLive.shape(game, { home: src(game.homeTeamId), away: src(game.awayTeamId) }));
    return r.value;
}

const isLive = (game) => !isFinal(game) && String(game.status || '').toLowerCase() === 'in_progress';
const recent = (game, now) => now - new Date(game.startDate).getTime() <= boxScore.LOOKBACK_MS;

// { source, plays } for a game, or null when there is none to show.
async function forGame(game, { now = Date.now() } = {}) {
    if (isLive(game)) {
        const espn = await espnFor(game);
        return espn && espn.plays ? { source: 'espn', plays: espn.plays } : null;
    }
    if (!isFinal(game)) return null;
    const stored = await shotCharts.logFor(game.id).catch(() => null);
    if (stored) return { source: 'cbbd', plays: stored };
    if (!recent(game, now)) return null;
    const espn = await espnFor(game);
    return espn && espn.plays ? { source: 'espn', plays: espn.plays } : null;
}

// What the route sends. `since` is how many plays the page already holds:
// it gets the plays from RESEND before that, and puts them at `from`.
function slice(log, since) {
    const n = Number(since);
    const from = Number.isInteger(n) && n > 0 ? Math.max(0, Math.min(n, log.plays.length) - RESEND) : 0;
    return { source: log.source, total: log.plays.length, from, plays: log.plays.slice(from) };
}

module.exports = { forGame, espnFor, slice, RESEND };
