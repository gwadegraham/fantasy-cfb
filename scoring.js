// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

var rankingsApi = new cfb.RankingsApi();

module.exports= {

    updateCumulativeScores: async function() {
        var response = await fetch("/users", {
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
              
              
            var totalScore = user.weeklyScore.map(score).reduce(sum);
            updateUserCumulativeScore(user._id, totalScore);
        }
    },

    updateScores: async function(season, week) {
        var response = await fetch("/users", {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });

        var userData = await response.json();

        for (const user of userData) {
            var score = 0;

            for (const team of user.teams) {
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
                        score += await calculateScore(team.school, game, week);
                    }
                } else {
                    console.log(response.message);
                }
            }

            var scoreObject = {
                "week": week,
                "score": score
            };

            if ((season == "postseason")) {
                scoreObject["season"] = season;

                if (await user.weeklyScore.some(e => e.season === scoreObject.season)) {
                    var spliceIndex = user.weeklyScore.findIndex(x => x.season === scoreObject.season);
                    user.weeklyScore.splice(spliceIndex, 1, scoreObject);
                    await updateUser(user._id, user.weeklyScore);
                } else {
                    user.weeklyScore.push(scoreObject);
                    await updateUser(user._id, user.weeklyScore);
                }
            } else if (await user.weeklyScore.some(e => e.week === scoreObject.week)) {
                var spliceIndex = user.weeklyScore.findIndex(x => x.week === scoreObject.week);
                user.weeklyScore.splice(spliceIndex, 1, scoreObject);
                await updateUser(user._id, user.weeklyScore);
            } else if (user.weeklyScore.length == 0){
                await updateUser(user._id, scoreObject);
            } else {
                user.weeklyScore.push(scoreObject);
                await updateUser(user._id, user.weeklyScore);
            }

            
        }
    },
    
    getScores: async function (data) {

        data.forEach( async (user, index) => {
            var score = 0;
    
            if (!user.isUpdated) {
                
                const promises = user.teams.map(async (team) => {
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
                        console.log("games data", data);
                        score += calculateScore(team.school, data, 1);
                        console.log("updating score", score);
                    });
    
                    return score;
                  });
    
                const scores = await Promise.all(promises);
                console.log("scores promises", scores);
    
                console.log("sending score to updateUser", score);
                var newWeeklyScore = user.weeklyScore.push(score);
                updateUser(user._id, newWeeklyScore);
            }
        });
        
    }
};



async function calculateScore(team, data, week) {
    var game = data;
    var score = 0;

    var year = process.env.YEAR;
    var opts = {
        'week': week
    };
    var response = await rankingsApi.getRankings(year, opts);
    var rankings = await response;

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
                score += isRanked(game.awayTeam, rankings[0]);
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
                score += isRanked(game.homeTeam, rankings[0]);
                score = isPowerFive(game.awayConference, game.homeConference) ? (score + 2) : score;
            }
        }
    }
    console.log("team => " + team + " game => " + game.notes + " with score == " + score);
    return score;
}

async function updateUser(userId, scoreUpdate) {
    
    var requestBody = `{
        "weeklyScore": ${JSON.stringify(scoreUpdate)},
        "isUpdated": true
        }`;

    const response = await fetch("/users/" + userId, {
            method: 'PATCH',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: requestBody,
        });
    
        response.json().then(data => {
            if (response.status == 200) {
                console.log(`Update User ${userId} with new weeklyScore:`, data.weeklyScore);
            } else {
                console.log(data.message);
            }
        });
}

async function updateUserCumulativeScore(userId, cumulativeScore) {
    const response = await fetch("/users/" + userId, {
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
    var powerFive = new Array("ACC", "Big 12", "Big Ten", "SEC", "Pac-12");

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