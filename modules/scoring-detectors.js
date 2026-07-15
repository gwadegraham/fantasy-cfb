// Fixed vocabulary of scoring "condition detectors" plus the low-level game
// predicates they build on. These encode WHAT a game/team situation is; the
// point VALUES and which conditions are scored live in the per-league config
// (see scoring-defaults.js) and are applied by the engine in scoring.js.
//
// Commissioners can change point values, toggle postseason events, and flip the
// regular-win combine mode — but they do NOT invent new conditions. This module
// is that closed vocabulary. The predicate bodies are lifted verbatim from the
// pre-Phase-2 engine so behavior is byte-for-byte identical.

// --- low-level game predicates -------------------------------------------

function isConference(game) {
    if ((game.homeConference == "FBS Independents") || (game.awayConference == "FBS Independents")) {
        return false;
    } else {
        return game.conferenceGame;
    }
}

// Finds the relevant poll (CFP committee if present, else AP Top 25). Returns
// null if rankings weren't loaded for the week or neither poll is present, so
// callers degrade gracefully instead of throwing.
function findPoll(rankings) {
    if (!rankings || !Array.isArray(rankings.polls)) return null;
    var poll = rankings.polls.find(x => x.poll === 'Playoff Committee Rankings')
        || rankings.polls.find(x => x.poll === 'AP Top 25');
    if (!poll || !Array.isArray(poll.ranks)) return null;
    return poll;
}

// 0 = unranked, 1 = ranked #11-25, 2 = ranked #1-10.
function rankValue(team, rankings) {
    var poll = findPoll(rankings);
    if (!poll) return 0;
    var entry = poll.ranks.find(y => y.school === team);
    if (!entry) return 0;
    return entry.rank <= 10 ? 2 : 1;
}

function isPowerFiveUpset(teamConf, oppConf) {
    var powerFive = ["ACC", "Big 12", "Big Ten", "SEC"];
    return (!powerFive.includes(teamConf)) && (powerFive.includes(oppConf));
}

function notesIncludes(game, text) {
    return !!game.notes && game.notes.toLowerCase().includes(text);
}

function isConferenceChampion(game) {
    return notesIncludes(game, "championship") && (game.seasonType == "regular");
}

function isBowlGame(game) {
    return notesIncludes(game, "bowl") && !notesIncludes(game, "playoff") && (game.seasonType == "postseason");
}

function isFirstRound(game) {
    return notesIncludes(game, "first round") && (game.seasonType == "postseason");
}

function isQuarterFinalist(game) {
    return notesIncludes(game, "quarterfinal") && (game.seasonType == "postseason");
}

function isSemiFinalist(game) {
    return notesIncludes(game, "semifinal") && (game.seasonType == "postseason");
}

function isFinalist(game) {
    return notesIncludes(game, "national championship") && (game.seasonType == "postseason");
}

function isTop4Seed(game, teamId) {
    return isQuarterFinalist(game) && (game.homeId == teamId);
}

// --- context ------------------------------------------------------------

// Normalizes one (team, game, rankings) into the fields every condition needs.
// team may not appear in the game (defensive): won/opponent stay false/empty and
// only appearance-based bracket conditions can fire, matching the old code which
// awarded bracket points regardless of which side the team was on.
function buildContext(team, game, rankings) {
    var isHome = game.homeId == team;
    var isAway = game.awayId == team;
    var won = isHome ? (game.homePoints > game.awayPoints)
        : isAway ? (game.awayPoints > game.homePoints) : false;
    var opponent = isHome ? game.awayTeam : (isAway ? game.homeTeam : null);
    var teamConf = isHome ? game.homeConference : (isAway ? game.awayConference : null);
    var oppConf = isHome ? game.awayConference : (isAway ? game.homeConference : null);
    return {
        game: game,
        team: team,
        isRegular: game.seasonType == "regular",
        won: won,
        opponent: opponent,
        rankVal: rankValue(opponent, rankings),
        isConference: isConference(game),
        isPowerFiveUpset: isPowerFiveUpset(teamConf, oppConf)
    };
}

// --- condition vocabulary -----------------------------------------------
// Each entry maps a condition key -> predicate(ctx). Regular-win conditions are
// gated to won && regular so bracket/bowl games that fall through score 0.

const CONDITIONS = {
    // Regular-season / non-bracket win conditions.
    baseWin: (ctx) => ctx.won && ctx.isRegular && !isConferenceChampion(ctx.game),
    conferenceWin: (ctx) => ctx.won && ctx.isRegular && ctx.isConference && !isConferenceChampion(ctx.game),
    confBonus: (ctx) => ctx.won && ctx.isRegular && ctx.isConference && !isConferenceChampion(ctx.game),
    nonConfRankedWin: (ctx) => ctx.won && ctx.isRegular && !ctx.isConference && ctx.rankVal > 0 && !isConferenceChampion(ctx.game),
    rankedTop25Bonus: (ctx) => ctx.won && ctx.isRegular && ctx.rankVal === 1 && !isConferenceChampion(ctx.game),
    rankedTop10Bonus: (ctx) => ctx.won && ctx.isRegular && ctx.rankVal === 2 && !isConferenceChampion(ctx.game),
    nonP5UpsetBonus: (ctx) => ctx.won && ctx.isRegular && ctx.isPowerFiveUpset && !isConferenceChampion(ctx.game),

    // Conference championship (regular-season titled game), win only.
    confChampionship: (ctx) => ctx.won && isConferenceChampion(ctx.game),

    // Bowls (non-playoff postseason).
    bowlAppearance: (ctx) => isBowlGame(ctx.game),
    bowlWin: (ctx) => ctx.won && isBowlGame(ctx.game),

    // CFP bracket. Appearance conditions fire win or lose; *Loss/*Win are gated.
    cfpFirstRound: (ctx) => isFirstRound(ctx.game),
    cfpFirstRoundLoss: (ctx) => isFirstRound(ctx.game) && !ctx.won,
    cfpQuarterfinal: (ctx) => isQuarterFinalist(ctx.game),
    cfpQuarterfinalTop4Bonus: (ctx) => isTop4Seed(ctx.game, ctx.team),
    cfpSemifinal: (ctx) => isSemiFinalist(ctx.game),
    nationalChampionship: (ctx) => isFinalist(ctx.game),           // appearance (Claunts)
    nationalChampionshipWin: (ctx) => ctx.won && isFinalist(ctx.game) // win only (Graham)
};

module.exports = {
    CONDITIONS,
    buildContext,
    // exported for reuse/tests:
    isConference, findPoll, rankValue, isPowerFiveUpset,
    isConferenceChampion, isBowlGame, isFirstRound,
    isQuarterFinalist, isSemiFinalist, isFinalist, isTop4Seed
};
