// The basketball league scoreboard (#490): a week's slate from hoopsgames,
// with the league's drafted teams marked up with their owner and the points
// that team banked in that game — football's scoreboard (modules/
// league-scoreboard.js), fed by basketball, in the SAME response shape so
// public/scoreboard.js renders it unchanged.
//
// What is basketball's own:
//   - rosters are teamRefs (rosterIds), not football's full team objects;
//   - live/final comes from the game's status, which the live poller writes,
//     with football's time window only as the fallback for a lagging poller;
//   - "ranked" is T-Rank top 25 for that week (the same ranks scoring banks);
//   - no spread, weather, possession or down-and-distance.
//
// Pure, like football's: the route feeds it query results.

const { MAX_GAME_MS } = require('./game-window');
const { isFinal, rosterIds } = require('./hoops-scoring-pass');
const { entryFor } = require('./roster-teams');
const { initialsOf } = require('./league-scoreboard');
const { outlets } = require('./hoops-media');

// The rank the card shows and the "ranked" filter keys on: the top 25 only,
// as football shows the AP top 25. Every D-I team has a T-Rank, and "#212"
// beside every name is noise.
const TOP = 25;

// { <teamId>: owner } for one league season, from basketball rosters.
function ownersByTeam(franchises, season) {
    const out = {};
    (franchises || []).forEach(u => {
        const s = entryFor(u, season);
        if (!s) return;
        const owner = {
            userId: String(u._id),
            name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
            firstName: u.firstName || '',
            franchise: s.franchiseName || null,
            color: u.color || null,
            avatarUrl: u.avatarUrl || null,
            initials: initialsOf(u.firstName, u.lastName)
        };
        rosterIds(s).forEach(id => { out[id] = owner; });
    });
    return out;
}

// pre | live | final. The status is the truth once the poller has written
// it; a game past its tip that the poller has not reached yet reads live
// inside the game window. Past the window with no final, it is NOT called
// final — "Final" over no score is wrong — it stays pre (a postponement, or
// a listing that will be tidied away).
function gameState(game, nowMs) {
    if (isFinal(game)) return 'final';
    const status = String(game.status || '').toLowerCase();
    if (status === 'in_progress') return 'live';
    if (status === 'postponed' || status === 'cancelled' || game.startTimeTbd) return 'pre';
    const start = Date.parse(game.startDate);
    if (Number.isNaN(start) || start > nowMs) return 'pre';
    return nowMs - start <= MAX_GAME_MS ? 'live' : 'pre';
}

const STATUS_NOTE = { postponed: 'Postponed', cancelled: 'Canceled' };

function sideOf(game, which, ctx) {
    const id = Number(which === 'home' ? game.homeTeamId : game.awayTeamId);
    const meta = ctx.teams[id] || {};
    const owner = ctx.owners[id] || null;
    const points = which === 'home' ? game.homePoints : game.awayPoints;
    const rank = ctx.ranks[String(id)];
    const key = `${id}:${game.id}`;
    return {
        id,
        team: meta.school || (which === 'home' ? game.homeTeam : game.awayTeam),
        conference: (which === 'home' ? game.homeConference : game.awayConference) || null,
        abbr: meta.abbr || null,
        logo: meta.logo || null,
        rank: Number.isFinite(rank) && rank <= TOP ? rank : null,
        record: null,
        line: null,
        points: points != null ? points : null,
        possession: false,
        owner: owner ? Object.assign({}, owner, {
            points: ctx.points[key] != null ? ctx.points[key] : null
        }) : null
    };
}

function shapeGame(game, ctx) {
    const state = gameState(game, ctx.nowMs);
    const home = sideOf(game, 'home', ctx);
    const away = sideOf(game, 'away', ctx);
    const status = String(game.status || '').toLowerCase();
    return {
        id: game.id,
        week: game.week,
        seasonType: game.seasonType,
        startDate: game.startDate,
        startTimeTbd: !!game.startTimeTbd,
        neutralSite: !!game.neutralSite,
        state,
        period: state === 'live' && game.period != null ? game.period : null,
        clock: state === 'live' ? (game.clock || null) : null,
        situation: null,
        outlet: outlets(game.broadcasts),
        weather: null,
        notes: STATUS_NOTE[status] || game.gameNotes || null,
        venue: game.venue || null,
        home,
        away,
        spread: null,
        overUnder: null,
        ranked: !!(home.rank || away.rank),
        leagueGame: !!(home.owner || away.owner)
    };
}

// Kickoff-ordered, ties broken by id so the client's diff-and-patch refresh
// never reshuffles rows that did not change.
function shapeGames(games, ctx) {
    return (games || [])
        .map(g => shapeGame(g, ctx))
        .sort((a, b) => (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0) || a.id - b.id);
}

module.exports = { ownersByTeam, gameState, shapeGame, shapeGames, TOP };
