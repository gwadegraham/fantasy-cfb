import { setChartData } from './weekByWeek.js';

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = function() {
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
        setChartData(data);
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

