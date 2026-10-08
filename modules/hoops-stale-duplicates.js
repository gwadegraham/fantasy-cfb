// Stale copies of rescheduled games (#498).
//
// When a game moves, CBBD (and ESPN behind it) sometimes keeps the old
// listing under its own id. We upsert by id, so both land here: the real one
// goes final, the old one sits "scheduled" for ever. Nothing is double-scored
// — only a played game goes final — but the copy shows on schedules as a
// game that never happened.
//
// Rather than guess up front which listing is the real one, wait: once a
// listing is GRACE_MS past its date, still unplayed, and the same matchup in
// the same setting HAS gone final, the listing is the stale one. That rule
// never touches a real rematch — both of those get played.

const { isFinal } = require('./hoops-scoring-pass');

const GRACE_MS = 2 * 24 * 60 * 60 * 1000;

const sameMatchup = (a, b) => Number(a.homeTeamId) === Number(b.homeTeamId)
    && Number(a.awayTeamId) === Number(b.awayTeamId)
    && !!a.neutralSite === !!b.neutralSite;

// Could this listing be a stale copy? Unplayed and well past its date.
function overdue(game, now = Date.now()) {
    if (isFinal(game)) return false;
    const start = new Date(game.startDate).getTime();
    return Number.isFinite(start) && Number(now) - start > GRACE_MS;
}

// The played game that replaced this listing, or null.
function supersededBy(game, games, now = Date.now()) {
    if (!overdue(game, now)) return null;
    return games.find(o => o.id !== game.id && isFinal(o) && sameMatchup(o, game)) || null;
}

function dropStale(games, now = Date.now()) {
    return games.filter(g => !supersededBy(g, games, now));
}

module.exports = { GRACE_MS, overdue, supersededBy, dropStale };
