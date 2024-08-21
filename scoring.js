// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

var rankingsApi = new cfb.RankingsApi();

module.exports= {

    updateCumulativeScores: async function() {
        var response = await fetch(`${process.env.URL}/users/season/${process.env.YEAR}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });

        var userData = await response.json();

        for (const user of userData) {
            function score(item){
                return item.score;
              }
              
              function sum(prev, next){
                return prev + next;
              }
              
              
            var totalScore = user.seasons[0].weeklyScore.map(score).reduce(sum);
            updateUserCumulativeScore(user._id, totalScore);
        }
    },

    updateScores: async function(season, week) {
        var response = await fetch(`${process.env.URL}/users/season/${process.env.YEAR}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });

        var userData = await response.json();

        for (const user of userData) {
            var score = 0;
            var teamScores = new Array();

            for (const team of user.seasons[0].teams) {
                var gamePromise = await fetch(process.env.URL + `/games/seasonType/${season}/week/${week}/team/${team.school}`, {
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

                        if (user.league == "claunts-league") {
                            teamScore = await module.exports.calculateScoreV1(team.school, game, week);
                        } else if (user.league == "graham-league") {
                            teamScore = await module.exports.calculateScoreV2(team.school, game, week);
                        }

                        score += teamScore;

                        var teamScoreObject = {
                            "team": team.school,
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
            } else if (await user.seasons[0].weeklyScore.some(e => e.week === scoreObject.week)) {
                var spliceIndex = user.seasons[0].weeklyScore.findIndex(x => x.week === scoreObject.week);
                user.seasons[0].weeklyScore.splice(spliceIndex, 1, scoreObject);
                await updateUser(user._id, user.seasons[0].weeklyScore);
            } else if (user.seasons[0].weeklyScore.length == 0){
                await updateUser(user._id, scoreObject);
            } else {
                user.seasons[0].weeklyScore.push(scoreObject);
                await updateUser(user._id, user.seasons[0].weeklyScore);
            }

            
        }
    },

    calculateTeamScores: async function (teamId, teamName) {

        var cumulativeScoreV1 = 0;
        var cumulativeScoreV2 = 0;
        var weeklyScores = [];

        var gamesPromise = await fetch(process.env.URL + `/games/season/${process.env.YEAR}/team/${teamName}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });

        var games = await gamesPromise;
        var response = await games.json();

        if (games.status == 200) {
            // console.log("games response", response.length)
            for (const game of response) {
                var gameScoreV1 = 0;
                var gameScoreV2 = 0;

                gameScoreV1 = await module.exports.calculateScoreV1(teamName, game, game.week);
                gameScoreV2 = await module.exports.calculateScoreV2(teamName, game, game.week);

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

        var response = await module.exports.updateTeamScores(teamId, scoreUpdateObject);

        if (response.status == 200) {
            return response;
        }
    },
    
    //TODO: Decide if this can be archived
    getScores: async function (data) {

        data.forEach( async (user, index) => {
            var score = 0;
    
            if (!user.isUpdated) {
                
                const promises = user.seasons[0].teams.map(async (team) => {
                    await fetch(process.env.URL + '/games-api', {
                        method: 'POST',
                        headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                        },
                        body: `{
                            "team": "${team.school}"
                            }`,
                    }).then(res => res.json()).then(data => {
                        // console.log("games data", data);
                        score += calculateScore(team.school, data, 1);
                        // console.log("updating score", score);
                    });
    
                    return score;
                  });
    
                const scores = await Promise.all(promises);
    
                var newWeeklyScore = user.seasons[0].weeklyScore.push(score);
                updateUser(user._id, newWeeklyScore);
            }
        });
        
    },

    calculateScoreV1: async function (team, data, week) {
        var game = data;
        var score = 0;
    
        var year = process.env.YEAR;
        var opts = {
            'week': week
        };
    
        // var response = await rankingsApi.getRankings(year, opts);
        // var rankings = await response;
        var response = await fetch(`${process.env.URL}/rankings/${process.env.YEAR}/${week}/${game.seasonType}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        var rankings = await response.json();

    
        var isSemiFinalist = isCFP(game);
    
        if (isSemiFinalist) {
            score += 7;
        } else if (game.homeTeam == team) {
            if (game.homePoints > game.awayPoints) {
                var isConfChampion = isConferenceChampion(game);
                var isBowlWinner = isBowlWin(game);
                var isNationalChamp = isNationalChampion(game);
    
                if (isNationalChamp) {
                    score += 10;
                } else if (isBowlWinner) {
                    score += 6;
                } else if (isConfChampion) {
                    score += 5;
                } else {
                    score += 1;
                    var ranked = isRankedV1(game.awayTeam, rankings);
    
                    if (ranked > 0) {
                        score += ranked;
                    } else {
                        score = isConference(game) ? (score + 1) : score;
                    }
                }  
            }
        } else if (game.awayTeam == team) {
            if (game.awayPoints > game.homePoints) {
                var isConfChampion = isConferenceChampion(game);
                var isBowlWinner = isBowlWin(game);
                var isNationalChamp = isNationalChampion(game);
    
                if (isNationalChamp) {
                    score += 10;
                } else if (isBowlWinner) {
                    score += 6;
                } else if (isConfChampion) {
                    score += 5;
                } else {
                    score += 1;
                    var ranked = isRankedV1(game.homeTeam, rankings);
    
                    if (ranked > 0) {
                        score += ranked;
                    } else {
                        score = isConference(game) ? (score + 1) : score;
                    }
                }
            }
        }
        // console.log("team => " + team + " game => " + game.notes + " with score == " + score);
        return score;
    },

    calculateScoreV2: async function (team, data, week) {
        var game = data;
        var score = 0;
    
        var year = process.env.YEAR;
        var opts = {
            'week': week
        };
    
        // var response = await rankingsApi.getRankings(year, opts);
        // var rankings = await response;
        var response = await fetch(`${process.env.URL}/rankings/${process.env.YEAR}/${week}/${game.seasonType}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        var rankings = await response.json();
    
        var isSemiFinalist = isCFP(game);
    
        if (isSemiFinalist) {
            score += 7;
        } else if (game.homeTeam == team) {
            if (game.homePoints > game.awayPoints) {
                var isConfChampion = isConferenceChampion(game);
                var isBowlWinner = isBowlWin(game);
                var isNationalChamp = isNationalChampion(game);
    
                if (isNationalChamp) {
                    score += 10;
                } else if (isBowlWinner) {
                    score += 6;
                } else if (isConfChampion) {
                    score += 5;
                } else {
                    score += 1;
                    score = isConference(game) ? (score + 1) : score;
                    score += isRanked(game.awayTeam, rankings);
                    score = isPowerFive(game.homeConference, game.awayConference) ? (score + 2) : score;
                }  
            }
        } else if (game.awayTeam == team) {
            if (game.awayPoints > game.homePoints) {
                var isConfChampion = isConferenceChampion(game);
                var isBowlWinner = isBowlWin(game);
                var isNationalChamp = isNationalChampion(game);
    
                if (isNationalChamp) {
                    score += 10;
                } else if (isBowlWinner) {
                    score += 6;
                } else if (isConfChampion) {
                    score += 5;
                } else {
                    score += 1;
                    score = isConference(game) ? (score + 1) : score;
                    score += isRanked(game.homeTeam, rankings);
                    score = isPowerFive(game.awayConference, game.homeConference) ? (score + 2) : score;
                }
            }
        }
        // console.log("team => " + team + " game => " + game.notes + " with score == " + score);
        return score;
    },

    updateTeamScores: async function (teamId, scoreUpdate) {
    
        var requestBody = {
            "weeklyScore": scoreUpdate.weeklyScore,
            "cumulativeScoreV1": scoreUpdate.cumulativeScoreV1,
            "cumulativeScoreV2": scoreUpdate.cumulativeScoreV2,
            };
    
        const response = await fetch(`${process.env.URL}/teams/${teamId}`, {
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

    const response = await fetch(`${process.env.URL}/users/` + userId, {
            method: 'PATCH',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: requestBody,
        });
    
        response.json().then(data => {
            if (response.status == 200) {
                console.log(`Update User ${userId} with new weeklyScore:`, data.seasons[0].weeklyScore);
            } else {
                console.log(data.message);
            }
        });
}

async function updateUserCumulativeScore(userId, cumulativeScore) {
    const response = await fetch(`${process.env.URL}/users/` + userId, {
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



function isConference(game) {
    if ((game.homeConference == "FBS Independents") || (game.awayConference == "FBS Independents")) {
        return false;
    } else {
        return game.conferenceGame;
    }
}

function isRankedV1(team, rankings) {
    var pollIndex = rankings.polls.findIndex(x => x.poll === 'Playoff Committee Rankings');

    if (pollIndex == -1) {
        pollIndex = rankings.polls.findIndex(x => x.poll === 'AP Top 25');
    }

    var rankIndex = rankings.polls[pollIndex].ranks.findIndex(y => y.school === team);


    if (rankIndex != -1) {
        var teamRank = rankings.polls[pollIndex].ranks[rankIndex].rank;

        return 2;
    } else {
        return 0;
    }
}

function isRanked(team, rankings) {
    var pollIndex = rankings.polls.findIndex(x => x.poll === 'Playoff Committee Rankings');

    if (pollIndex == -1) {
        pollIndex = rankings.polls.findIndex(x => x.poll === 'AP Top 25');
    }

    var rankIndex = rankings.polls[pollIndex].ranks.findIndex(y => y.school === team);


    if (rankIndex != -1) {
        var teamRank = rankings.polls[pollIndex].ranks[rankIndex].rank;

        if(teamRank >= 11) {
            return 1;
        } else if (teamRank <= 11) {
            return 2;
        }
    } else {
        return 0;
    }
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
        if (game.notes.toLowerCase().includes("bowl") && !game.notes.toLowerCase().includes("cfp") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isCFP(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("cfp semifinal") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}

function isNationalChampion(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("cfp national championship") && (game.seasonType == "postseason")) {
            return true;
        } else {
            return false;
        }
    }
     else {
        return false;
    }
}