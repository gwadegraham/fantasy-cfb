// The basketball H2H win-probability bar's inputs (#310, PR 4 of the
// projection plan).
//
// Football's bar (routes/standings.js /h2h) reads, per week, per drafted team,
// per game, a { winProb, pointsIfWin } entry from the draft projection and
// hands them to h2h.matchupWinProb. Until this module, basketball had no such
// entry, so the route answered winP null (#553, 212ac72): a bar built from
// FINAL games alone read 100% / 0% for a side with one finished game against
// a side yet to play.
//
// This builds the same map from the basketball engine (modules/hoops-
// projection.js), in the same shape:
//
//   { [week]: { [teamId]: { [gameId]: { winProb, pointsIfWin, pointsIfLoss } } } }
//
// Pure: no database. The route owns the reads.
//
// ---- which probability, for which game ----
//
//   a game NOT yet final   projectRemaining: the logit-calibrated per-game
//                          odds, calibrated to the remaining-wins target that
//                          blends the preseason rate with the record actually
//                          played (K = 30). The same numbers the Standings
//                          projection uses for that game, so the bar and the
//                          projected finish cannot tell two stories.
//   a FINAL game           projectHoopsTeam over the whole regular season:
//                          the pre-season-calibrated odds — the retrospective
//                          "pre-game odds" line on a finished card. Football's
//                          retrospective line is the same kind of number (its
//                          full-season projection, graded on today's poll).
//
// Points-if-win and points-if-loss are graded on the caller's CURRENT rank
// map (hoops-ranks ranksFor), the same map the engine grades on everywhere.
//
// ---- a game the engine does not project ----
//
// The engine leaves out a game whose opponent has no barthag (a non-D-I
// opponent, ~1.5 games a team a season, won 98.9% of the time). The bar
// cannot: a game on the card with no entry contributes NOTHING to its side,
// and a side whose only unplayed game is unprojected reads 0% against a side
// with a banked result — the exact 100/0 this replaces. So every card game
// the engine skipped gets an entry here, priced by the same engine: P(win) is
// NON_D1_WIN_RATE against an unrated opponent (0.5 if our own team is the
// unrated one), and its points come from the real scoring engine on the
// current ranks — which, against an unranked opponent, is a Q4 win (0 by
// default).

const {
    buildHoopsPoolContext, projectHoopsTeam, projectRemaining,
    pointsIfWin, pointsIfLoss, NON_D1_WIN_RATE, teamWinProb, venueOfGame, isDead
} = require('./hoops-projection');
const { dedupeListings, groupHoopsGamesByTeam } = require('./hoops-draft-projection');

function put(out, week, teamId, gameId, entry) {
    if (week == null || gameId == null) return;
    const byTeam = out[week] = out[week] || {};
    (byTeam[teamId] = byTeam[teamId] || {})[gameId] = entry;
}

// teams      every HoopsTeam row of the season (hoops-draft-projection
//            TEAM_FIELDS): the opponents' ratings come from here.
// games      the season's regular-season HoopsGame rows touching the drafted
//            teams (GAME_FIELDS plus homePoints/awayPoints and status).
// draftedIds the rostered team ids.
// cardGames  the games the H2H cards show (hoops-h2h gateGames shape: id,
//            week, homeId, awayId). Each gets an entry, projected or not.
// ranks      { teamId: rank } — the current ranks.
// cfg        the league's resolved scoring config.
function hoopsProjByWeek({ teams, games, draftedIds, cardGames, ranks, cfg }) {
    const out = {};
    const ctx = buildHoopsPoolContext(teams, { ranks, cfg });
    const ids = new Set((draftedIds || []).map(String));
    const deduped = dedupeListings(games, teams);
    const byTeam = groupHoopsGamesByTeam(deduped.games, ids);
    const teamById = {};
    (teams || []).forEach(t => { teamById[String(t.id)] = t; });

    ids.forEach(id => {
        const team = teamById[id];
        if (!team) return;
        const sched = byTeam[id] || [];
        const full = projectHoopsTeam(team, sched, ctx, { perGame: true });
        const live = projectRemaining(team, sched, ctx, { perGame: true });
        const remaining = new Set((live.perGame || []).map(pg => pg.gameId));
        const entry = (pg) => ({ winProb: pg.winProb, pointsIfWin: pg.pointsIfWin, pointsIfLoss: pg.pointsIfLoss });
        // Finals keep the full-season (pre-game) number; everything still to
        // play takes the remaining-schedule one.
        (full.perGame || []).forEach(pg => { if (!remaining.has(pg.gameId)) put(out, pg.week, Number(id), pg.gameId, entry(pg)); });
        (live.perGame || []).forEach(pg => put(out, pg.week, Number(id), pg.gameId, entry(pg)));
    });

    // Card games the engine skipped, EXCEPT the ones it skips on purpose: a
    // dead row (cancelled/postponed) and the stale half of a duplicate
    // listing — pricing those would hand a side a game it will never play.
    // What is left is a game with a missing rating (see the header).
    const rawById = {};
    (games || []).forEach(g => { rawById[g.id] = g; });
    const dropped = new Set(deduped.dropped);
    (cardGames || []).forEach(cg => {
        [cg.homeId, cg.awayId].forEach(tid => {
            if (tid == null || !ids.has(String(tid))) return;
            const have = out[cg.week] && out[cg.week][Number(tid)] && out[cg.week][Number(tid)][cg.id];
            if (have) return;
            const raw = rawById[cg.id];
            if (!raw || isDead(raw) || dropped.has(raw.id)) return;
            put(out, cg.week, Number(tid), cg.id, fallbackEntry(Number(tid), raw, ctx));
        });
    });
    return out;
}

// One game the engine did not project, priced by the engine's own pieces.
function fallbackEntry(teamId, game, ctx) {
    const oppId = Number(game.homeTeamId) === teamId ? game.awayTeamId : game.homeTeamId;
    const mine = ctx.barthagById[String(teamId)];
    const theirs = ctx.barthagById[String(oppId)];
    let winProb;
    if (mine !== undefined && theirs !== undefined) winProb = teamWinProb(mine, theirs, venueOfGame(teamId, game), ctx.homeOdds);
    else if (mine !== undefined) winProb = NON_D1_WIN_RATE;
    else winProb = 0.5;
    return {
        winProb,
        pointsIfWin: pointsIfWin(teamId, game, ctx.ranks, ctx.cfg),
        pointsIfLoss: pointsIfLoss(teamId, game, ctx.ranks, ctx.cfg)
    };
}

// The week whose ranks the projection should grade on: the first week with
// a game still to play, else the last week with games. null with no games.
// `cardGames` are hoops-h2h gateGames rows, whose `completed` is isFinal.
function currentRankWeek(cardGames) {
    let first = null, last = null;
    (cardGames || []).forEach(g => {
        if (g.week == null) return;
        if (last === null || g.week > last) last = g.week;
        if (!g.completed && (first === null || g.week < first)) first = g.week;
    });
    return first !== null ? first : last;
}

module.exports = { hoopsProjByWeek, fallbackEntry, currentRankWeek };
