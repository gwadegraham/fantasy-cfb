const { internalFetch } = require('./internal-api');
const { CLAUNTS_DEFAULTS, GRAHAM_DEFAULTS, resolveConfig } = require('./scoring-defaults');
// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

var rankingsApi = new cfb.RankingsApi();

module.exports= {

    updateCumulativeScores: async function() {
        var response = await internalFetch(`${process.env.URL}/users/season/${process.env.YEAR}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });

        var userData = await response.json();

        for (const user of userData) {
            function score(item){
                return typeof item.score === 'number' ? item.score : 0;
              }

              function sum(prev, next){
                return prev + next;
              }

            // Seed reduce with 0 so users with no weekly scores yet (new users
            // / start of season) return 0 instead of throwing "Reduce of empty
            // array with no initial value" and aborting the whole loop.
            var weeklyScore = user.seasons[0].weeklyScore || [];
            var totalScore = weeklyScore.map(score).reduce(sum, 0);
            updateUserCumulativeScore(user._id, totalScore);
        }
    },

    updateScores: async function(season, week) {
        var response = await internalFetch(`${process.env.URL}/users/season/${process.env.YEAR}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });

        var userData = await response.json();
        var configByLeague = {};

        for (const user of userData) {
            var score = 0;
            var teamScores = new Array();

            if (!configByLeague[user.league]) {
                configByLeague[user.league] = await getScoringConfig(user.league);
            }
            var cfg = configByLeague[user.league];

            for (const team of user.seasons[0].teams) {
                var gamePromise = await internalFetch(process.env.URL + `/games/seasonType/${season}/week/${week}/team/${team.id}`, {
                    method: 'GET',
                    headers: {
                    'Accept': 'application/json'
                    }
                });
    
                var game = await gamePromise;
                var response = await game.json();
    
                if (game.status == 200) {
                    for (const game of response) {
                        var teamScore = 0;

                        if (cfg.model == "claunts") {
                            teamScore = await module.exports.calculateScoreV1(team.id, game, week, process.env.YEAR, cfg.values);
                        } else if (cfg.model == "graham") {
                            teamScore = await module.exports.calculateScoreV2(team.id, game, week, process.env.YEAR, cfg.values);
                        }

                        score += teamScore;

                        var teamScoreObject = {
                            "team": team.school,
                            "teamId": team.id,
                            "gameId": game.id,
                            "score": teamScore
                        };

                        teamScores.push(teamScoreObject);
                    }
                } else {
                    console.log(response.message);
                }
            }

            var scoreObject = {
                "week": week,
                "score": score,
                "scoreByTeam": teamScores
            };

            if ((season == "postseason")) {
                scoreObject["season"] = season;

                if (await user.seasons[0].weeklyScore.some(e => e.season === scoreObject.season)) {
                    var spliceIndex = user.seasons[0].weeklyScore.findIndex(x => x.season === scoreObject.season);
                    user.seasons[0].weeklyScore.splice(spliceIndex, 1, scoreObject);
                    await updateUser(user._id, user.seasons[0].weeklyScore);
                } else {
                    user.seasons[0].weeklyScore.push(scoreObject);
                    await updateUser(user._id, user.seasons[0].weeklyScore);
                }
            } else if (await user.seasons[0].weeklyScore.some(e => e.week === parseInt(scoreObject.week))) {
                var spliceIndex = user.seasons[0].weeklyScore.findIndex(x => x.week === parseInt(scoreObject.week));
                user.seasons[0].weeklyScore.splice(spliceIndex, 1, scoreObject);
                await updateUser(user._id, user.seasons[0].weeklyScore);
            } else if (user.seasons[0].weeklyScore.length == 0){
                // First score of the season: weeklyScore is an array field, so
                // wrap the object rather than storing a bare object.
                await updateUser(user._id, [scoreObject]);
            } else {
                user.seasons[0].weeklyScore.push(scoreObject);
                await updateUser(user._id, user.seasons[0].weeklyScore);
            }

            
        }
    },

    calculateTeamScores: async function (season, teamId, teamName) {

        var cumulativeScoreV1 = 0;
        var cumulativeScoreV2 = 0;
        var weeklyScores = [];

        // Team scores track both leagues, so load each league's config.
        var clauntsCfg = await getScoringConfig('claunts-league');
        var grahamCfg = await getScoringConfig('graham-league');

        var gamesPromise = await internalFetch(process.env.URL + `/games/season/${season}/teamId/${teamId}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });

        var games = await gamesPromise;
        var response = await games.json();

        if (games.status == 200) {
            for (const game of response) {
                var gameScoreV1 = 0;
                var gameScoreV2 = 0;

                gameScoreV1 = await module.exports.calculateScoreV1(teamId, game, game.week, season, clauntsCfg.values);
                gameScoreV2 = await module.exports.calculateScoreV2(teamId, game, game.week, season, grahamCfg.values);

                cumulativeScoreV1 += gameScoreV1;
                cumulativeScoreV2 += gameScoreV2;

                var weekScoreObject = {
                    "week": game.week,
                    "seasonType": game.seasonType,
                    "scoreV1": gameScoreV1,
                    "scoreV2": gameScoreV2
                };

                weeklyScores.push(weekScoreObject);
            }
        } else {
            console.log(response.message);
        }

        weeklyScores.sort((a, b) => b.seasonType.localeCompare(a.seasonType) || a.week - b.week);

        var scoreUpdateObject = {
            "weeklyScore": weeklyScores,
            "cumulativeScoreV1": cumulativeScoreV1,
            "cumulativeScoreV2": cumulativeScoreV2
        };

        var response = await module.exports.updateTeamScoresWithYear(season, teamId, scoreUpdateObject);

        if (response.status == 200) {
            return response;
        }
    },

    //Scoring for Claunts League. cfg holds this league's point values.
    calculateScoreV1: async function (team, data, week, season = process.env.YEAR, cfg = CLAUNTS_DEFAULTS) {
        var game = data;
        var score = 0;
        var rankings = await getRankingsForGame(game, week, season);

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
    },

    //Scoring for Graham League. cfg holds this league's point values.
    calculateScoreV2: async function (team, data, week, season = process.env.YEAR, cfg = GRAHAM_DEFAULTS) {
        var game = data;
        var score = 0;
        var rankings = await getRankingsForGame(game, week, season);

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
    },

    updateTeamScores: async function (teamId, scoreUpdate) {
    
        var requestBody = {
            "weeklyScore": scoreUpdate.weeklyScore,
            "cumulativeScoreV1": scoreUpdate.cumulativeScoreV1,
            "cumulativeScoreV2": scoreUpdate.cumulativeScoreV2,
            };
    
        const response = await internalFetch(`${process.env.URL}/teams/${teamId}`, {
            method: 'PATCH',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
        });
    
        return response.json().then(data => {
            if (response.status == 200) {
                var updatedTeam = {status: response.status, updatedTeam: data};
                return updatedTeam;
            } else {
                console.log(data.message);
            }
        });
    },
    
    updateTeamScoresWithYear: async function (season, teamId, scoreUpdate) {
    
        var requestBody = {
            "weeklyScore": scoreUpdate.weeklyScore,
            "cumulativeScoreV1": scoreUpdate.cumulativeScoreV1,
            "cumulativeScoreV2": scoreUpdate.cumulativeScoreV2,
            };
    
        const response = await internalFetch(`${process.env.URL}/teams/${teamId}/${season}`, {
            method: 'PATCH',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
        });
    
        return response.json().then(data => {
            if (response.status == 200) {
                var updatedTeam = {status: response.status, updatedTeam: data};
                return updatedTeam;
            } else {
                console.log(data.message);
            }
        });
    }
};

async function updateUser(userId, scoreUpdate) {
    
    var requestBody = `{
        "weeklyScore": ${JSON.stringify(scoreUpdate)},
        "isUpdated": true
        }`;

    const response = await internalFetch(`${process.env.URL}/users/` + userId, {
            method: 'PATCH',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: requestBody,
        });
    
        response.json().then(data => {
            if (response.status == 200) {
                console.log(`✅ Successfully updated User ${userId} with new weeklyScore`);
            } else {
                console.log(data.message);
            }
        });
}

async function updateUserCumulativeScore(userId, cumulativeScore) {
    const response = await internalFetch(`${process.env.URL}/users/` + userId, {
            method: 'PATCH',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "cumulativeScore": ${JSON.stringify(cumulativeScore)},
            "isUpdated": true
            }`,
        });
    
        response.json().then(data => {
            if (response.status == 200) {
                console.log(`Update User ${userId} with new cumulativeScore:`, cumulativeScore);
            } else {
                console.log(data.message);
            }
        });
}



// Fetches the resolved scoring config (model + values) for a league via the
// API, so it works in the web process and in job processes alike. Falls back
// to that league's defaults on any error.
async function getScoringConfig(league) {
    try {
        var res = await internalFetch(`${process.env.URL}/scoring-config/${league}`, {
            method: 'GET', headers: { 'Accept': 'application/json' }
        });
        var data = await res.json();
        if (data && data.values) return resolveConfig(league, { model: data.model, values: data.values });
    } catch (e) { /* fall through to defaults */ }
    return resolveConfig(league, null);
}

// Builds the rankings-fetch URL for a game and returns the parsed rankings.
async function getRankingsForGame(game, week, season) {
    var url = (game.seasonType == "postseason")
        ? `${process.env.URL}/rankings/${season}/1/regular`
        : `${process.env.URL}/rankings/${season}/${week}/${game.seasonType}`;
    var response = await internalFetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    });
    return response.json();
}

// Claunts (V1) regular-season / bowl scoring for one team in a game.
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
            // Conference win is fixed (ranked or not); a non-conference win over
            // a ranked opponent scores more.
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

// Graham (V2) regular-season / bowl scoring for one team in a game (additive).
function scoreV2RegularOrBowl(game, won, opponent, teamConf, oppConf, rankings, cfg) {
    if (!won) return 0;
    if (isFinalist(game)) return cfg.nationalChampionship;
    if (isBowlWin(game)) return cfg.bowlWin;
    if (isConferenceChampion(game)) return cfg.confChampionship;

    var score = cfg.baseWin;
    if (isConference(game)) score += cfg.confBonus;
    var rankVal = isRanked(opponent, rankings);   // 0 unranked, 1 = #11-25, 2 = #1-10
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
    return entry.rank <= 10 ? 2 : 1;   // #1-10 -> 2, #11-25 -> 1
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
        if (game.notes.toLowerCase().includes("championship") && (game.seasonType == "regular")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isBowlWin(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("bowl") && !game.notes.toLowerCase().includes("playoff") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isBowlParticipant(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("bowl") && !game.notes.toLowerCase().includes("playoff") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    } else {
        return false;
    }
}

function isFirstRound(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("first round") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isTop4Seed(game, teamId) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("quarterfinal") && (game.seasonType == "postseason") && (game.homeId == teamId)) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isQuarterFinalist(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("quarterfinal") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isSemiFinalist(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("semifinal") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isFinalist(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("national championship") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}