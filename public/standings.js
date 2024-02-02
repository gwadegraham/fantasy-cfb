import { setChartData } from './weekByWeek.js';

var isMobile;

function detectMobile() {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent)){
        // true for mobile device
        isMobile = true;
        console.log("mobile device");
    } else{
        // false for not mobile device
        isMobile = false;
        console.log("not mobile device");
    }
}

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = function() {
    detectMobile();

    leagueCode = window.localStorage.getItem("leagueCode");
    const currentSelectedLeague = window.localStorage.getItem("league");
    if (currentSelectedLeague) {
        $("#dropdownMenuButton").text(currentSelectedLeague);
    }
    getUsers();
  };

$(".dropdown-menu a").click(function(){
    $(this).parents(".dropdown").find('.btn').html($(this).text());
    $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
    var selectedLeague = $("#dropdownMenuButton").text();
    var selectedLeagueCode = $("#dropdownMenuButton").val();
    window.localStorage.setItem("league", selectedLeague);
    window.localStorage.setItem("leagueCode", selectedLeagueCode);
    window.location.reload();
});

async function getUsers() {
    const response = await fetch(`/users/league/${leagueCode}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        //await getScores(data);
        displayUsers(data);
        setBiggestWinner(data);
        setBestTeam(data);

        if (!isMobile) {
            setChartData(data);
            document.querySelector('[chart-container]').removeAttribute("style");
        }
    });
}

function displayUsers(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    data.sort((a, b) => {
        return b.cumulativeScore - a.cumulativeScore;
    });

    data.forEach( (user, index) => {
        str += '<tr>';
        str += '<th class="sticky-header">' + (index + 1) + '</th>';
        str += `<th class="sticky-header"><a href="/userHome?user=${user._id}">` + user.firstName + ' ' + user.lastName + '</a></th>';
        
        user.teams.forEach(team => {
            var refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
            refLink = refLink.replace(/\s/g, "-").toLowerCase();

            str += '<td class="team-item"><div>';
            str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos[0] + '" alt="' + team.mascot + '">'
            str += team.mascot;
            str += '</div></td></a>';
        })

        str += '<th class="sticky-header-score">' + (user.cumulativeScore ? user.cumulativeScore : 0) + '</th>';
        str += '</tr>';
    });

    userTableBody.innerHTML = str;
}

function getScores(data) {

    data.forEach( async (user, index) => {
        var score = 0;

        if (!user.isUpdated) {
            
            const promises = user.teams.map(async (team) => {
                await fetch('/games-api', {
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
                    score += calculateScore(team.school, data);
                    console.log("updating score", score);
                });

                return score;
              });

            const scores = await Promise.all(promises);
            console.log("scores promises", scores);

            // user.teams.forEach( (team) => {
            //     console.log("team foreach ", team.school);
                
            //     fetch('/games', {
            //         method: 'POST',
            //         headers: {
            //         'Accept': 'application/json',
            //         'Content-Type': 'application/json'
            //         },
            //         body: `{
            //             "team": "${team.school}"
            //             }`,
            //     }).then(res => res.json()).then(data => {
            //         console.log("games data", data);
            //         score += calculateScore(team.school, data);
            //         console.log("updating score", score);
            //     });
            // });
            console.log("sending score to updateUser", score);
            updateUser(user._id, score);
        }
    });
    
}

function calculateScore(team, data) {
    var score = 0;
    console.log("data[0].homeTeam == team", data[0].homeTeam == team);
    if (data[0].homeTeam == team) {
        console.log("data[0].homePoints > data[0].awayPoints", data[0].homePoints > data[0].awayPoints);
        if (data[0].homePoints > data[0].awayPoints) {
            score += 2;
        }
    } else if (data[0].awayTeam == team) {
        console.log("data[0].awayTeam == team", data[0].awayTeam == team);
        console.log("data[0].awayPoints > data[0].homePoints", data[0].awayPoints > data[0].homePoints);
        if (data[0].awayPoints > data[0].homePoints) {
            score += 2;
        }
    }

    return score;
}

async function updateUser(userId, score) {
    console.log("score", score);

    const response = await fetch("/users/" + userId, {
            method: 'PATCH',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "cumulativeScore": ${score},
            "isUpdated": true
            }`,
        });
    
        response.json().then(data => {
            if (response.status == 200) {
                console.log(data);
            } else {
                console.log(data.message);
            }
        });
}

async function setBiggestWinner(users) {
    var sortedUsers = await users.sort(function(a, b) {
        return parseFloat(a.weeklyScore[a.weeklyScore.length -1].score) - parseFloat(b.weeklyScore[b.weeklyScore.length -1].score);
    });

    var userName = sortedUsers[0].firstName;
    var userScore = sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].score;
    var week = sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].week;

    if ((week == 1) && (sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].season == "postseason")) {
        week = "Postseason";
    }

    document.querySelector("[winner-week]").textContent += " in Week " + week;
    document.querySelector("[biggest-winner]").textContent = userName;
    document.querySelector("[biggest-winner-score]").textContent = "+" + userScore;

    setBiggestLoser(sortedUsers);
}

async function setBiggestLoser(users) {
    var sortedUsers = users.reverse();
    var userName = sortedUsers[0].firstName;
    var userScore = sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].score;
    var week = sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].week;

    if ((week == 1) && (sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].season == "postseason")) {
        week = "Postseason";
    }

    document.querySelector("[loser-week]").textContent += " in Week " + week;
    document.querySelector("[biggest-loser]").textContent = userName;
    document.querySelector("[biggest-loser-score]").textContent = "+" + userScore;
}

async function setBestTeam(users) {
    var teamScores = [];

    users.forEach((user, index) => {
        user.teams.forEach( (team, index) => {
            var totalScore = 0;
            
            user.weeklyScore.forEach(week => {
                var result = week.scoreByTeam.filter(obj => {
                    return obj.team == team.school
                  });
    
                var tableWeeklyScore = 0;
                if (result.length > 0) {
                    for (const repeatedScore of result) {
                        tableWeeklyScore += repeatedScore.score;
                    }
                }

                if (result[0]) {
                    totalScore += tableWeeklyScore;
                }
            });

            var teamInfo = {
                team: team.school,
                score: totalScore
            }

            teamScores.push(teamInfo);
        });
    });

    var sortedTeamScores = await teamScores.sort(function(a, b) {
        return parseFloat(b.score) - parseFloat(a.score);
    });

    document.querySelector("[best-team]").textContent = sortedTeamScores[0].team;
    document.querySelector("[best-team-score]").textContent = sortedTeamScores[0].score + " points";
}