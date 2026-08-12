// Fixed vocabulary of scoring "condition detectors" plus the low-level game
// predicates they build on. These encode WHAT a game/team situation is; the
// point VALUES and which conditions are scored live in the per-league config
// (see scoring-defaults.js) and are applied by the engine in scoring.js.
//
// Commissioners can change point values, toggle postseason events, and flip the
// regular-win combine mode — but they do NOT invent new conditions. This module
// is that closed vocabulary. The predicate bodies are lifted verbatim from the
// pre-Phase-2 engine so behavior is byte-for-byte identical.
//
// The bracket-round predicates take an optional second argument: the CFP
// bracket facts for that game (modules/cfp-bracket.js), when a bracket is on
// file. When present they are the answer; when absent the original notes-string
// path runs unchanged. See the block comment above bracketRound().

const { ROUNDS, teamInGame } = require('./cfp-bracket');

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

// The conferences the upset bonus treats as "power" — a win over one of these
// by a team outside them is the upset. Kept as a DEFAULT rather than a constant
// because which programs count as power is a league judgment, not a fact of the
// engine: Notre Dame sits in `FBS Independents`, so under the bare four it
// collected the underdog bonus on every P4 win despite being a top-5 program.
// A league overrides the list via its scoring config (`powerConferences`); the
// default below must stay exactly these four so the frozen-oracle parity test
// (tests/ScoringParity.spec.js) keeps proving the unchanged engine.
var POWER_CONFERENCES = ["ACC", "Big 12", "Big Ten", "SEC"];

function isPowerFiveUpset(teamConf, oppConf, powerConferences) {
    var powerFive = powerConferences || POWER_CONFERENCES;
    return (!powerFive.includes(teamConf)) && (powerFive.includes(oppConf));
}

function notesIncludes(game, text) {
    return !!game.notes && game.notes.toLowerCase().includes(text);
}

function isConferenceChampion(game) {
    return notesIncludes(game, "championship") && (game.seasonType == "regular");
}

// The round this game is, according to the CFP bracket — or null when we have no
// bracket evidence for it, which is every game outside the bracket (all
// non-playoff bowls, the whole regular season) and every season with no bracket
// on file (any season before the ingest existed, and the current one until
// selection day).
//
// null means "fall back to the notes strings", which is what the detectors below
// do. That fallback is permanent, not a migration step: the same detectors also
// run against games synthesized by modules/draft-projection.js, which have
// authored notes and no bracket, and against historical seasons via explainGame.
function bracketRound(bracket) {
    return (bracket && typeof bracket.round === 'string') ? bracket.round : null;
}

// A CFP bracket game is not a bowl, whatever it's called. The notes path has to
// infer this by excluding the word "playoff" from a string like "College
// Football Playoff Quarterfinal at the Rose Bowl Game" — so if that prose ever
// shortens to just "Rose Bowl", a quarterfinal scores as a plain bowl. With the
// bracket on file it can't.
function isBowlGame(game, bracket) {
    if (bracketRound(bracket)) return false;
    return notesIncludes(game, "bowl") && !notesIncludes(game, "playoff") && (game.seasonType == "postseason");
}

function isFirstRound(game, bracket) {
    var round = bracketRound(bracket);
    if (round) return round === ROUNDS.FIRST_ROUND;
    return notesIncludes(game, "first round") && (game.seasonType == "postseason");
}

function isQuarterFinalist(game, bracket) {
    var round = bracketRound(bracket);
    if (round) return round === ROUNDS.QUARTERFINAL;
    return notesIncludes(game, "quarterfinal") && (game.seasonType == "postseason");
}

function isSemiFinalist(game, bracket) {
    var round = bracketRound(bracket);
    if (round) return round === ROUNDS.SEMIFINAL;
    return notesIncludes(game, "semifinal") && (game.seasonType == "postseason");
}

function isFinalist(game, bracket) {
    var round = bracketRound(bracket);
    if (round) return round === ROUNDS.CHAMPIONSHIP;
    return notesIncludes(game, "national championship") && (game.seasonType == "postseason");
}

// The top-4 seeds get a bye, so they enter at the quarterfinal. The bracket says
// which team that is outright. Without it, the only available signal is that the
// bye seed hosts the quarterfinal — true in 2024 and 2025, but an inference off
// the home/away fields rather than a stated fact.
function isTop4Seed(game, teamId, bracket) {
    var round = bracketRound(bracket);
    if (round) {
        if (round !== ROUNDS.QUARTERFINAL) return false;
        var team = teamInGame(bracket, teamId);
        return !!(team && team.firstRoundBye);
    }
    return isQuarterFinalist(game) && (game.homeId == teamId);
}

// --- context ------------------------------------------------------------

// Normalizes one (team, game, rankings) into the fields every condition needs.
// team may not appear in the game (defensive): won/opponent stay false/empty and
// only appearance-based bracket conditions can fire, matching the old code which
// awarded bracket points regardless of which side the team was on.
//
// `bracket` is this ONE game's CFP bracket facts (from factsForGame), not the
// whole season's bracket — the round lookup happens before the context is built.
// Omitted or null everywhere a caller has no bracket, and the detectors fall
// back to notes.
//
// `powerConferences` is the league's power list for the upset bonus; omitted
// everywhere a caller has no config and the default four apply.
function buildContext(team, game, rankings, bracket, powerConferences) {
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
        bracket: bracket || null,
        isRegular: game.seasonType == "regular",
        won: won,
        opponent: opponent,
        rankVal: rankValue(opponent, rankings),
        isConference: isConference(game),
        isPowerFiveUpset: isPowerFiveUpset(teamConf, oppConf, powerConferences)
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

    // Optional finer Fixed-shape categories: conference/non-conference wins
    // split by opponent rank. rankVal is 2 for #1-10, 1 for #11-25, 0 unranked.
    confRankedWin: (ctx) => ctx.won && ctx.isRegular && ctx.isConference && ctx.rankVal > 0 && !isConferenceChampion(ctx.game),
    confWinTop10: (ctx) => ctx.won && ctx.isRegular && ctx.isConference && ctx.rankVal === 2 && !isConferenceChampion(ctx.game),
    confWinTop25: (ctx) => ctx.won && ctx.isRegular && ctx.isConference && ctx.rankVal === 1 && !isConferenceChampion(ctx.game),
    nonConfWinTop10: (ctx) => ctx.won && ctx.isRegular && !ctx.isConference && ctx.rankVal === 2 && !isConferenceChampion(ctx.game),
    nonConfWinTop25: (ctx) => ctx.won && ctx.isRegular && !ctx.isConference && ctx.rankVal === 1 && !isConferenceChampion(ctx.game),

    // Conference championship (regular-season titled game), win only.
    confChampionship: (ctx) => ctx.won && isConferenceChampion(ctx.game),

    // Bowls (non-playoff postseason).
    bowlAppearance: (ctx) => isBowlGame(ctx.game, ctx.bracket),
    bowlWin: (ctx) => ctx.won && isBowlGame(ctx.game, ctx.bracket),

    // CFP bracket. Appearance conditions fire win or lose; *Loss/*Win are gated.
    cfpFirstRound: (ctx) => isFirstRound(ctx.game, ctx.bracket),
    cfpFirstRoundLoss: (ctx) => isFirstRound(ctx.game, ctx.bracket) && !ctx.won,
    cfpQuarterfinal: (ctx) => isQuarterFinalist(ctx.game, ctx.bracket),
    cfpQuarterfinalTop4Bonus: (ctx) => isTop4Seed(ctx.game, ctx.team, ctx.bracket),
    cfpSemifinal: (ctx) => isSemiFinalist(ctx.game, ctx.bracket),
    nationalChampionship: (ctx) => isFinalist(ctx.game, ctx.bracket),           // appearance (Claunts)
    nationalChampionshipWin: (ctx) => ctx.won && isFinalist(ctx.game, ctx.bracket) // win only (Graham)
};

module.exports = {
    CONDITIONS,
    buildContext,
    // exported for reuse/tests:
    isConference, findPoll, rankValue, isPowerFiveUpset, POWER_CONFERENCES,
    isConferenceChampion, isBowlGame, isFirstRound,
    isQuarterFinalist, isSemiFinalist, isFinalist, isTop4Seed,
    bracketRound
};
