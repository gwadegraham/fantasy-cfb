const { internalFetch } = require('./internal-api');
const { resolveConfig, MODELS } = require('./scoring-defaults');
const { CONDITIONS, buildContext } = require('./scoring-detectors');
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

                        // Pass the full resolved config (model + combineMode +
                        // values + disabled) so commissioner structure changes
                        // are honored, not just point values.
                        if (cfg.model == "claunts") {
                            teamScore = await module.exports.calculateScoreV1(team.id, game, week, process.env.YEAR, cfg);
                        } else if (cfg.model == "graham") {
                            teamScore = await module.exports.calculateScoreV2(team.id, game, week, process.env.YEAR, cfg);
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

                gameScoreV1 = await module.exports.calculateScoreV1(teamId, game, game.week, season, clauntsCfg);
                gameScoreV2 = await module.exports.calculateScoreV2(teamId, game, game.week, season, grahamCfg);

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

    // Scoring for the Claunts league (claunts model). `cfg` may be a flat point-
    // values object (back-compat with callers/tests that only tune values) or a
    // fully-resolved config { model, combineMode, values, disabled }.
    calculateScoreV1: async function (team, data, week, season = process.env.YEAR, cfg = MODELS.claunts.defaults) {
        var rankings = await getRankingsForGame(data, week, season);
        return evaluate('claunts', team, data, rankings, normalizeCfg('claunts', cfg));
    },

    // Scoring for the Graham league (graham model). See calculateScoreV1 re: cfg.
    calculateScoreV2: async function (team, data, week, season = process.env.YEAR, cfg = MODELS.graham.defaults) {
        var rankings = await getRankingsForGame(data, week, season);
        return evaluate('graham', team, data, rankings, normalizeCfg('graham', cfg));
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

// --- unified scoring engine ---------------------------------------------

// Coerces the `cfg` arg accepted by calculateScoreV1/V2 into the shape the
// engine needs: { combineMode, values, disabled }. A fully-resolved config
// (from resolveConfig / getScoringConfig) is passed through; a bare point-values
// object is wrapped, letting the model's default combine mode apply and leaving
// all postseason events enabled.
function normalizeCfg(model, cfg) {
    if (cfg && typeof cfg === 'object' && cfg.values && typeof cfg.values === 'object') {
        return { combineMode: cfg.combineMode, values: cfg.values, disabled: cfg.disabled || [] };
    }
    return { combineMode: undefined, values: cfg || {}, disabled: [] };
}

function pointsOf(values, key) {
    var v = values[key];
    return typeof v === 'number' ? v : 0;
}

// The single data-driven engine both leagues run through. `model` selects the
// code-owned structure (rule lists + default combine mode); `cfg` supplies the
// commissioner's point values, combine-mode override, and disabled postseason
// events. See modules/scoring-defaults.js for the structure and the exact
// precedence rationale.
function evaluate(model, team, game, rankings, cfg) {
    var structure = (MODELS[model] || MODELS.claunts).structure;
    var values = cfg.values || {};
    var disabled = new Set(cfg.disabled || []);
    var combineMode = (cfg.combineMode === 'sum' || cfg.combineMode === 'first')
        ? cfg.combineMode : structure.combineMode;
    var ctx = buildContext(team, game, rankings);

    // 1. Postseason events, in order. Each enabled matching rule adds its
    //    points; a non-additive match stops evaluation. This first-match-stop
    //    reproduces the old elif precedence (bracket rounds short-circuit the
    //    bowl/regular paths, so a CFP game at a bowl venue never double-counts).
    var score = 0;
    var matchedPost = false;
    for (var i = 0; i < structure.postseason.length; i++) {
        var pr = structure.postseason[i];
        if (disabled.has(pr.condition)) continue;
        var pd = CONDITIONS[pr.condition];
        if (pd && pd(ctx)) {
            score += pointsOf(values, pr.pointsKey);
            matchedPost = true;
            if (!pr.additive) break;
        }
    }
    if (matchedPost) return score;

    // 2. Regular-win group (only if no postseason event matched). Combine mode
    //    'sum' adds every matching rule (Graham); 'first' takes the first match
    //    in priority order (Claunts).
    for (var j = 0; j < structure.regularWin.length; j++) {
        var rr = structure.regularWin[j];
        var rd = CONDITIONS[rr.condition];
        if (rd && rd(ctx)) {
            score += pointsOf(values, rr.pointsKey);
            if (combineMode !== 'sum') break;
        }
    }
    return score;
}