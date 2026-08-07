const { internalFetch } = require('./internal-api');
const { resolveConfig, MODELS, engagementForSeason, ruleEnabled } = require('./scoring-defaults');
const { CONDITIONS, buildContext } = require('./scoring-detectors');
const { resolveCaptain, captainWeeklyBonus } = require('./captain');
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

    // Folds each league's head-to-head win/tie bonuses into the stored weekly
    // scores. MUST run after updateScores (a week's result needs every manager's
    // total) and before updateCumulativeScores (which sums the bonus into
    // cumulativeScore). Goes through the API like every other scoring step so it
    // works both in-process and from a standalone job run. See the handler in
    // routes/scores.js for the idempotency guarantees.
    applyH2HBonuses: async function() {
        const response = await internalFetch(`${process.env.URL}/scores/h2h-bonus`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: JSON.stringify({ season: process.env.YEAR }),
        });

        const data = await response.json();
        if (response.status == 200) {
            console.log("✅ H2H bonuses applied", JSON.stringify(data.leagues || []));
        } else {
            console.log("❌ H2H bonuses could not be applied" + " | " + response.status);
        }
        return data;
    },

    updateScores: async function(season, week) {
        // One ranking cache per call: every game in the week shares its poll doc
        // instead of re-reading it from Mongo per game.
        var rankingCache = new Map();
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
                            teamScore = await module.exports.calculateScoreV1(team.id, game, week, process.env.YEAR, cfg, rankingCache);
                        } else if (cfg.model == "graham") {
                            teamScore = await module.exports.calculateScoreV2(team.id, game, week, process.env.YEAR, cfg, rankingCache);
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

            // Captain (weekly N×) for opted-in leagues — regular season only
            // (the postseason self-selects your teams). Resolved PER SEASON: a
            // season with no engagement entry is off, so scoring/rescoring a
            // season the mode was never enabled for adds nothing (and enabling
            // it for one season never touches another). Existing classic leagues
            // are likewise unchanged.
            var seasonEng = engagementForSeason(cfg.engagementBySeason, process.env.YEAR);
            var captainTeamId = null, captainBonus = 0;
            if (seasonEng.captainEnabled && season !== "postseason") {
                var priorWeekly = (user.seasons[0].weeklyScore || [])
                    .filter(e => e.season !== "postseason" && parseInt(e.week) < parseInt(week));
                captainTeamId = resolveCaptain(user.seasons[0].captains, week, user.seasons[0].teams, priorWeekly);
                captainBonus = captainWeeklyBonus(teamScores, captainTeamId, seasonEng.captainMultiplier);
                score += captainBonus;
            }

            var scoreObject = {
                "week": week,
                "score": score,
                "scoreByTeam": teamScores
            };
            if (captainTeamId != null && captainBonus > 0) {
                scoreObject.captainTeamId = captainTeamId;
                scoreObject.captainBonus = captainBonus;
            }

            if ((season == "postseason")) {
                scoreObject["season"] = season;

                // Key postseason entries by (season, week), not season alone, so
                // multiple postseason weeks accumulate as separate entries rather
                // than each call overwriting the previous one. (CFBD currently
                // packs the FBS postseason into a single week, so today this only
                // ever creates one entry — it's a safeguard against a future
                // multi-week postseason.)
                var postWeek = parseInt(scoreObject.week);
                if (await user.seasons[0].weeklyScore.some(e => e.season === "postseason" && e.week === postWeek)) {
                    var spliceIndex = user.seasons[0].weeklyScore.findIndex(x => x.season === "postseason" && x.week === postWeek);
                    user.seasons[0].weeklyScore.splice(spliceIndex, 1, scoreObject);
                    await updateUser(user._id, user.seasons[0].weeklyScore);
                } else {
                    user.seasons[0].weeklyScore.push(scoreObject);
                    await updateUser(user._id, user.seasons[0].weeklyScore);
                }
            } else if (await user.seasons[0].weeklyScore.some(e => e.season !== "postseason" && e.week === parseInt(scoreObject.week))) {
                // Match regular weeks only (exclude postseason entries), so a
                // regular week N never clobbers a postseason entry that shares
                // the same week number.
                var spliceIndex = user.seasons[0].weeklyScore.findIndex(x => x.season !== "postseason" && x.week === parseInt(scoreObject.week));
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
        // One ranking cache per call: both league models + same-week games share
        // each poll doc instead of re-reading it from Mongo per game per model.
        var rankingCache = new Map();

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

                gameScoreV1 = await module.exports.calculateScoreV1(teamId, game, game.week, season, clauntsCfg, rankingCache);
                gameScoreV2 = await module.exports.calculateScoreV2(teamId, game, game.week, season, grahamCfg, rankingCache);

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
    calculateScoreV1: async function (team, data, week, season = process.env.YEAR, cfg = MODELS.claunts.defaults, cache) {
        var rankings = await getRankingsForGame(data, week, season, cache);
        return evaluate('claunts', team, data, rankings, normalizeCfg('claunts', cfg));
    },

    // Scoring for the Graham league (graham model). See calculateScoreV1 re: cfg.
    calculateScoreV2: async function (team, data, week, season = process.env.YEAR, cfg = MODELS.graham.defaults, cache) {
        var rankings = await getRankingsForGame(data, week, season, cache);
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
        // Forward the FULL config — model, values, combineMode, disabled AND
        // enabled — so the scoring jobs honor every structural change a
        // commissioner makes (combine mode, disabled postseason events, opted-in
        // finer win categories), not just point values. Dropping any of these
        // here would make computed scores silently ignore structural config while
        // the rules page still showed it.
        if (data && data.values) return resolveConfig(league, {
            model: data.model,
            values: data.values,
            combineMode: data.combineMode,
            disabled: data.disabled,
            enabled: data.enabled,
            engagement: data.engagement,
            engagementBySeason: data.engagementBySeason
        });
    } catch (e) { /* fall through to defaults */ }
    return resolveConfig(league, null);
}

// Builds the rankings-fetch URL for a game and returns the parsed rankings.
// Fetches the ranking doc for a game's week from the internal /rankings
// endpoint (a Mongo read). The same (season, week, seasonType) doc is needed by
// every game in a week and by both league models, so callers that score many
// games in one run (updateScores / calculateTeamScores) pass a `cache` Map to
// reuse it instead of re-reading it per game. Without a cache it always fetches
// — so direct callers stay stateless and correct even if rankings change.
async function getRankingsForGame(game, week, season, cache) {
    var key = (game.seasonType == "postseason")
        ? `${season}|1|regular`
        : `${season}|${week}|${game.seasonType}`;
    if (cache && cache.has(key)) return cache.get(key);

    var url = (game.seasonType == "postseason")
        ? `${process.env.URL}/rankings/${season}/1/regular`
        : `${process.env.URL}/rankings/${season}/${week}/${game.seasonType}`;
    var response = await internalFetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    });
    var data = await response.json();
    if (cache) cache.set(key, data);
    return data;
}

// --- unified scoring engine ---------------------------------------------

// Coerces the `cfg` arg accepted by calculateScoreV1/V2 into the shape the
// engine needs: { combineMode, values, disabled }. A fully-resolved config
// (from resolveConfig / getScoringConfig) is passed through; a bare point-values
// object is wrapped, letting the model's default combine mode apply and leaving
// all postseason events enabled.
function normalizeCfg(model, cfg) {
    if (cfg && typeof cfg === 'object' && cfg.values && typeof cfg.values === 'object') {
        return { combineMode: cfg.combineMode, values: cfg.values, disabled: cfg.disabled || [], enabled: cfg.enabled || [] };
    }
    return { combineMode: undefined, values: cfg || {}, disabled: [], enabled: [] };
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
    var disabled = cfg.disabled || [];
    var enabled = cfg.enabled || [];
    var combineMode = (cfg.combineMode === 'sum' || cfg.combineMode === 'first')
        ? cfg.combineMode : structure.combineMode;
    var ctx = buildContext(team, game, rankings);

    // 1. Postseason events, in order. Each ON matching rule adds its points; a
    //    non-additive match stops evaluation. This first-match-stop reproduces
    //    the old elif precedence (bracket rounds short-circuit the bowl/regular
    //    paths, so a CFP game at a bowl venue never double-counts).
    var score = 0;
    var matchedPost = false;
    for (var i = 0; i < structure.postseason.length; i++) {
        var pr = structure.postseason[i];
        if (!ruleEnabled(pr, disabled, enabled)) continue;
        var pd = CONDITIONS[pr.condition];
        if (pd && pd(ctx)) {
            score += pointsOf(values, pr.pointsKey);
            matchedPost = true;
            if (!pr.additive) break;
        }
    }
    if (matchedPost) return score;

    // 2. Regular-win group (only if no postseason event matched). Off rules
    //    (a disabled default-on, or a not-opted-in default-off category) are
    //    skipped. Combine mode 'sum' adds every matching rule (Graham); 'first'
    //    takes the first match in priority order (Claunts).
    for (var j = 0; j < structure.regularWin.length; j++) {
        var rr = structure.regularWin[j];
        if (!ruleEnabled(rr, disabled, enabled)) continue;
        var rd = CONDITIONS[rr.condition];
        if (rd && rd(ctx)) {
            score += pointsOf(values, rr.pointsKey);
            if (combineMode !== 'sum') break;
        }
    }
    return score;
}

// Exported for the draft-grade projection (modules/draft-projection.js), which
// reuses the EXACT engine on synthesized games + a locally-supplied rankings
// object — so it never triggers the network rankings fetch that
// calculateScoreV1/V2 do, and stays byte-for-byte consistent with live scoring.
module.exports.evaluate = evaluate;
module.exports.normalizeCfg = normalizeCfg;

// One signature winning game per model, used to build a plain-language "worked
// example" of the two combine modes for the admin UI. Only the WHICH-rules-fire
// mapping is authored here; the points come from the league's live values, so
// the example stays correct as a commissioner edits them.
var EXAMPLE_SCENARIOS = {
    // Non-conference win over a top-10 team → matches the ranked-win rule and
    // the base-win rule.
    claunts: { label: 'a non-conference win over a top-10 team',
        ctx: { isConference: false, rankVal: 2, isPowerFiveUpset: false } },
    // Conference win over a top-10 team → stacks base + conference + top-10 win.
    graham: { label: 'a conference win over a top-10 team',
        ctx: { isConference: true, rankVal: 2, isPowerFiveUpset: false } }
};

// Runs the model's signature win through the REAL condition detectors and
// reports which regular-win rules it matches, in the model's priority order.
// Off rules (a disabled default-on, or a not-opted-in default-off category) are
// skipped so the example matches how the win actually scores. Each match carries
// its point `key` so the admin can recompute the example live from the
// (possibly-unsaved) input values; `points` is the saved-value fallback. The
// client derives the per-mode totals ('first' = only the first match; 'sum' =
// every match added).
function explainRegularWin(model, values, disabled, enabled) {
    var structure = (MODELS[model] || MODELS.claunts).structure;
    var scn = EXAMPLE_SCENARIOS[model] || EXAMPLE_SCENARIOS.claunts;
    var ctx = Object.assign({
        game: { seasonType: 'regular', notes: '' },
        team: 'example', isRegular: true, won: true, opponent: 'Opponent'
    }, scn.ctx);
    var matched = [];
    for (var i = 0; i < structure.regularWin.length; i++) {
        var rr = structure.regularWin[i];
        if (!ruleEnabled(rr, disabled || [], enabled || [])) continue;
        var det = CONDITIONS[rr.condition];
        if (det && det(ctx)) {
            matched.push({ key: rr.pointsKey, label: rr.label, points: pointsOf(values, rr.pointsKey) });
        }
    }
    return { scenario: scn.label, matched: matched };
}
module.exports.explainRegularWin = explainRegularWin;

// Like evaluate(), but for a REAL game: returns the rule(s) that fired (label +
// points) plus the total, instead of a bare number. Mirrors evaluate()'s order
// and skip logic exactly, so `total` equals evaluate()'s score for the same
// inputs (locked by a parity test). Powers the member-facing "why did this game
// score this?" breakdown.
function explainGame(model, team, game, rankings, cfg) {
    var structure = (MODELS[model] || MODELS.claunts).structure;
    var values = cfg.values || {};
    var disabled = cfg.disabled || [];
    var enabled = cfg.enabled || [];
    var combineMode = (cfg.combineMode === 'sum' || cfg.combineMode === 'first')
        ? cfg.combineMode : structure.combineMode;
    var ctx = buildContext(team, game, rankings);
    var matched = [];
    var add = function (r, group) {
        matched.push({ key: r.pointsKey, label: r.label, points: pointsOf(values, r.pointsKey), group: group });
    };

    var matchedPost = false;
    for (var i = 0; i < structure.postseason.length; i++) {
        var pr = structure.postseason[i];
        if (!ruleEnabled(pr, disabled, enabled)) continue;
        var pd = CONDITIONS[pr.condition];
        if (pd && pd(ctx)) { add(pr, 'postseason'); matchedPost = true; if (!pr.additive) break; }
    }
    if (!matchedPost) {
        for (var j = 0; j < structure.regularWin.length; j++) {
            var rr = structure.regularWin[j];
            if (!ruleEnabled(rr, disabled, enabled)) continue;
            var rd = CONDITIONS[rr.condition];
            if (rd && rd(ctx)) { add(rr, 'regular'); if (combineMode !== 'sum') break; }
        }
    }
    return { matched: matched, total: matched.reduce(function (s, m) { return s + m.points; }, 0) };
}
module.exports.explainGame = explainGame;
// Exposed so the per-game breakdown route can reuse the EXACT scoring inputs
// (resolved config + the game's week rankings) the scoring jobs use.
module.exports.getScoringConfig = getScoringConfig;
module.exports.getRankingsForGame = getRankingsForGame;