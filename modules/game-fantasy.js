// The fantasy read of one football game (#506 Phase 3): for each side, who
// has the team in the league being viewed, what the game banked them, and —
// before it is decided — what a win (and a loss) would pay.
//
// Pure: GET /games/fantasy/:league/:gameId (routes/games.js) does the reads
// and hands them in. Ownership and banked points come from the same two
// helpers the league scoreboard uses (modules/league-scoreboard.js), so the
// game page and the scoreboard can never name different owners or points.
//
// The stakes run the REAL scoring engine (modules/scoring.js evaluate) on the
// game with the result filled in each way — the trick the draft projection
// uses — so "+3 for a win" is the number the scoring pass would bank, with the
// league's own values, combine mode, toggles and the week's poll. Base rules
// only: Captain and the head-to-head bonus are a manager's weekly choices and
// results, not a property of the game.

// One side's owner and banked points. `banked` is null until the scoring pass
// has written a row for this game — "not scored yet" is not the same as 0.
function sideRead(game, which, owners, points) {
    const id = which === 'home' ? game.homeId : game.awayId;
    const o = owners[id] || null;
    const key = `${id}:${game.id}`;
    return {
        teamId: id,
        owner: o ? { userId: o.userId, firstName: o.firstName, name: o.name, franchise: o.franchise } : null,
        banked: o && points[key] != null ? points[key] : null
    };
}

// The game as the scoring pass would see it if `teamId` won (or lost): the
// same document with a 1–0 score filled in. Only the result is synthesised;
// conference, season type, notes and week — everything the rules read — are
// the game's own.
const { resolveCaptain } = require('./captain');

function asResult(game, teamId, won) {
    const isHome = Number(game.homeId) === Number(teamId);
    const homeWins = isHome === won;
    return Object.assign({}, game, { homePoints: homeWins ? 1 : 0, awayPoints: homeWins ? 0 : 1 });
}

// { ifWin, ifLoss } for one side. `evaluate` is modules/scoring.js's, passed
// in so this module stays free of the engine's network-backed requires.
function stakeFor(evaluate, cfg, game, teamId, rankings, bracket) {
    return {
        ifWin: evaluate(cfg.model, teamId, asResult(game, teamId, true), rankings, cfg, bracket),
        ifLoss: evaluate(cfg.model, teamId, asResult(game, teamId, false), rankings, cfg, bracket)
    };
}

// The Captain multiplier on this side's stakes, when — and only when — this
// team is the manager's captain for the game's week RIGHT NOW: the pick if
// they made one, else the auto-captain scoring would fall back to (the same
// resolveCaptain the scoring pass uses, so the note can't promise a bonus
// scoring won't pay). Regular season only, as in scoring. null otherwise, so
// changing the captain makes the note go away on the next read.
function captainFor(franchise, season, game, teamId, engagement) {
    if (!engagement || !engagement.captainEnabled) return null;
    if (game.seasonType === 'postseason') return null;
    const s = ((franchise && franchise.seasons) || []).find(x => Number(x.season) === Number(season));
    if (!s) return null;
    const prior = (s.weeklyScore || []).filter(e => e.season !== 'postseason' && Number(e.week) < Number(game.week));
    const captain = resolveCaptain(s.captains, game.week, s.teams, prior);
    return captain != null && Number(captain) === Number(teamId) ? (engagement.captainMultiplier || 2) : null;
}

module.exports = { sideRead, asResult, stakeFor, captainFor };
