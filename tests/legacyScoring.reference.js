// FROZEN reference copy of the pre-Phase-2 scoring engine (calculateScoreV1 /
// calculateScoreV2 and their helpers), lifted verbatim from modules/scoring.js
// as of the "Configurable scoring (Phase 1)" merge. This is the oracle the
// parity test compares the new unified engine against — it must NOT be changed
// when the engine is refactored, or the parity guarantee is meaningless.
//
// The only edits vs. the original: point values are inlined via the passed
// `cfg` (defaulting to the model defaults) exactly as the Phase-1 engine did,
// and rankings are supplied directly rather than fetched (the test provides
// them) so this file has no I/O.

const { CLAUNTS_DEFAULTS, GRAHAM_DEFAULTS } = require('../modules/scoring-defaults');

// --- public entry points (frozen) ---------------------------------------

function calculateScoreV1(team, game, rankings, cfg = CLAUNTS_DEFAULTS) {
    var score = 0;
    if (isQuarterFinalist(game)) {
        score += cfg.cfpQuarterfinal;
    } else if (isSemiFinalist(game)) {
        score += cfg.cfpSemifinal;
    } else if (isFinalist(game)) {
        score += cfg.nationalChampionship;
    } else if (game.homeId == team) {
        score += scoreV1RegularOrBowl(game, game.homePoints > game.awayPoints, game.awayTeam, rankings, cfg);
    } else if (game.awayId == team) {
        score += scoreV1RegularOrBowl(game, game.awayPoints > game.homePoints, game.homeTeam, rankings, cfg);
    }
    return score;
}

function calculateScoreV2(team, game, rankings, cfg = GRAHAM_DEFAULTS) {
    var score = 0;
    if (isFirstRound(game)) {
        score += cfg.cfpFirstRound;
    } else if (isQuarterFinalist(game)) {
        if (isTop4Seed(game, team)) score += cfg.cfpQuarterfinalTop4Bonus;
        score += cfg.cfpQuarterfinal;
    } else if (isSemiFinalist(game)) {
        score += cfg.cfpSemifinal;
    } else if (game.homeId == team) {
        score += scoreV2RegularOrBowl(game, game.homePoints > game.awayPoints, game.awayTeam, game.homeConference, game.awayConference, rankings, cfg);
    } else if (game.awayId == team) {
        score += scoreV2RegularOrBowl(game, game.awayPoints > game.homePoints, game.homeTeam, game.awayConference, game.homeConference, rankings, cfg);
    }
    return score;
}

// --- helpers (frozen) ----------------------------------------------------

function scoreV1RegularOrBowl(game, won, opponent, rankings, cfg) {
    var score = 0;
    var isBowlTeam = isBowlParticipant(game);
    if (isBowlTeam) score += cfg.bowlAppearance;
    if (won) {
        if (isFinalist(game)) {
            score += cfg.nationalChampionship;
        } else if (isBowlWin(game)) {
            score += cfg.bowlWin;
        } else if (isConferenceChampion(game)) {
            score += cfg.confChampionship;
        } else if (!isBowlTeam && !isFirstRound(game)) {
            score += cfg.nonConfWinUnranked;
            if (isConference(game)) {
                score = cfg.confWin;
            } else if (isRankedV1(opponent, rankings)) {
                score = cfg.nonConfWinRanked;
            }
        }
    } else if (isFirstRound(game)) {
        score += cfg.cfpAppearance;
    }
    return score;
}

function scoreV2RegularOrBowl(game, won, opponent, teamConf, oppConf, rankings, cfg) {
    if (!won) return 0;
    if (isFinalist(game)) return cfg.nationalChampionship;
    if (isBowlWin(game)) return cfg.bowlWin;
    if (isConferenceChampion(game)) return cfg.confChampionship;

    var score = cfg.baseWin;
    if (isConference(game)) score += cfg.confBonus;
    var rankVal = isRanked(opponent, rankings);
    if (rankVal === 2) score += cfg.rankedTop10Bonus;
    else if (rankVal === 1) score += cfg.rankedTop25Bonus;
    if (isPowerFive(teamConf, oppConf)) score += cfg.nonP5UpsetBonus;
    return score;
}

function isConference(game) {
    if ((game.homeConference == "FBS Independents") || (game.awayConference == "FBS Independents")) {
        return false;
    } else {
        return game.conferenceGame;
    }
}

function findPoll(rankings) {
    if (!rankings || !Array.isArray(rankings.polls)) return null;
    var poll = rankings.polls.find(x => x.poll === 'Playoff Committee Rankings')
        || rankings.polls.find(x => x.poll === 'AP Top 25');
    if (!poll || !Array.isArray(poll.ranks)) return null;
    return poll;
}

function isRankedV1(team, rankings) {
    var poll = findPoll(rankings);
    if (!poll) return false;
    return poll.ranks.some(y => y.school === team);
}

function isRanked(team, rankings) {
    var poll = findPoll(rankings);
    if (!poll) return 0;
    var entry = poll.ranks.find(y => y.school === team);
    if (!entry) return 0;
    return entry.rank <= 10 ? 2 : 1;
}

function isPowerFive(teamConf, oppConf) {
    var powerFive = new Array("ACC", "Big 12", "Big Ten", "SEC");
    if ((!powerFive.includes(teamConf)) && (powerFive.includes(oppConf))) {
        return true;
    } else {
        return false;
    }
}

function isConferenceChampion(game) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("championship") && (game.seasonType == "regular");
    }
    return false;
}

function isBowlWin(game) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("bowl") && !game.notes.toLowerCase().includes("playoff") && (game.seasonType == "postseason");
    }
    return false;
}

function isBowlParticipant(game) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("bowl") && !game.notes.toLowerCase().includes("playoff") && (game.seasonType == "postseason");
    }
    return false;
}

function isFirstRound(game) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("first round") && (game.seasonType == "postseason");
    }
    return false;
}

function isTop4Seed(game, teamId) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("quarterfinal") && (game.seasonType == "postseason") && (game.homeId == teamId);
    }
    return false;
}

function isQuarterFinalist(game) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("quarterfinal") && (game.seasonType == "postseason");
    }
    return false;
}

function isSemiFinalist(game) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("semifinal") && (game.seasonType == "postseason");
    }
    return false;
}

function isFinalist(game) {
    if (game.notes) {
        return game.notes.toLowerCase().includes("national championship") && (game.seasonType == "postseason");
    }
    return false;
}

module.exports = { calculateScoreV1, calculateScoreV2 };
