const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;
var weekCode;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = function() {
    leagueCode = window.localStorage.getItem("leagueCode");
    const currentSelectedLeague = window.localStorage.getItem("league");
    if (currentSelectedLeague) {
        $("#dropdownMenuButton").text(currentSelectedLeague);
    }

    weekCode = window.localStorage.getItem("weekCode");
    const currentSelectedWeek = window.localStorage.getItem("week");
    if (currentSelectedWeek) {
        $("#dropdownMenuButtonWeek").text(currentSelectedWeek);
    }

    getUser();
};

$(".dropdown-menu-right a").click(function(){
    $(this).parents(".dropdown-nav").find('.btn').html($(this).text());
    $(this).parents(".dropdown-nav").find('.btn').val($(this).attr('value'));
    var selectedLeague = $("#dropdownMenuButton").text();
    var selectedLeagueCode = $("#dropdownMenuButton").val();
    window.localStorage.setItem("league", selectedLeague);
    window.localStorage.setItem("leagueCode", selectedLeagueCode);
    window.location.reload();
});

$(".dropdown-menu-week a").click(function(){
    $(this).parents(".dropdownWeek").find('.btn').html($(this).text());
    $(this).parents(".dropdownWeek").find('.btn').val($(this).attr('value'));
    var selectedWeek = $("#dropdownMenuButtonWeek").text();
    var selectedWeekCode = $("#dropdownMenuButtonWeek").val();
    window.localStorage.setItem("week", selectedWeek);
    window.localStorage.setItem("weekCode", selectedWeekCode);
    window.location.reload();
});

async function getUser() {
    const urlParams = new URLSearchParams(window.location.search);

    const response = await fetch(`/users/${urlParams.get('user')}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("userData",data);
        changeHeader(data[0]);
        displayTeams(data[0]);
        displaySchedule(data[0]);
    });
}
function changeHeader(data) {
    var pageHeader = data.firstName + ' ' + data.lastName;
    document.getElementsByClassName('header-title')[0].innerText = pageHeader;

}

function displayTeams(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    var currentWeeksLength = data.weeklyScore.length;

    data.teams.forEach( (team, index) => {
        var totalScore = 0;

        str += '<tr>';
        refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
        refLink = refLink.replace(/\s/g, "-").toLowerCase();

        str += '<th class="team-item sticky-header"><div class="team-score-header">';
        str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos[0] + '" alt="' + team.mascot + '">'
        str += team.school;
        str += '</div></th></a>';
        
        data.weeklyScore.forEach(week => {
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
                str += '<td>' + tableWeeklyScore + '</td>';
                totalScore += tableWeeklyScore;
            } else {
                str += '<td>0</td>';
            }
        });


        for(var i = 0; i < (16 - currentWeeksLength); i++) {
            str += '<td>0</td>';
        }

        str += '<th class="sticky-header-score">' + totalScore + '</th>';
        str += '</tr>';
    });

    str += '<tr>';
    str += '<th class="team-item sticky-header"><div class="team-score-header">';
    str += 'Cumulative Score';
    str += '</div></th>';

    data.weeklyScore.forEach(week => {
        str += '<td>' + week.score + '</td>'
    });

    for(var i = 0; i < (16 - currentWeeksLength); i++) {
        str += '<td>0</td>';
    }

    str += '<th class="sticky-header-score">' + data.cumulativeScore + '</th>';
    str += '</tr>';

    userTableBody.innerHTML = str;
}

async function getGame(season, week, team) {

    var gamePromise = await fetch(`/games/seasonType/${season}/week/${week}/team/${team.school}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json'
        }
    });

    var game = await gamePromise;
    var response = await game.json();

    var games = new Array();


    if (game.status == 200) {
        for (const game of response) {
            games.push(game);
        }
    } else {
        console.log(response.message);
    }

    return games;
}

async function displaySchedule(data) {
    const scheduleContainer = document.querySelector('[schedule-body]');
    var str = '<tr>';

    for (var iterNum = 0; iterNum < data.teams.length; iterNum++) {
        var week = weekCode.substring(5);
        var gamesInfo = await getGame("regular", week, data.teams[iterNum]);

        if ((iterNum + 1) == data.teams.length) {
            str += '</td></tr>'
        }
        else if ((iterNum % 3 == 0) && (iterNum > 0)) {
            console.log("break point for team " + data.teams[iterNum].school + " iterNum: " + iterNum)
            str += '</tr><tr>';
        }

        for (const game of gamesInfo) {

            var topData = '';
            var bottomData = '';

            if (!game.startTimeTbd) {
                if( game.awayPoints > game.homePoints ) {
                    topData = game.awayPoints + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i>';
                    bottomData = game.homePoints;
                } else {
                    topData = game.awayPoints;
                    bottomData = game.homePoints+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i>';
                }
            } else {

                var militaryTime = parseInt(game.startDate.substring(11,14));
                var standardTime = '';

                if (militaryTime < 12) {
                    standardTime = militaryTime.toString() + "AM";
                }
                else if (militaryTime == 12) {
                    standardTime = militaryTime.toString() + "PM";
                }
                else {
                    standardTime =( militaryTime - 12).toString() + "PM";
                }

                topData = game.startDate.substring(5,10);
                bottomData = standardTime;
            }

            var teamTable = '<td><table class="schedule-table game-table"><tbody><tr></tr><tr><td style="width: 250px;">';

            if (data.teams.some(team => team.school === game.awayTeam)) {
                // teamTable += '<img src="' + data.teams[iterNum].logos[0] + '" alt="' + data.teams[iterNum].mascot + '">';
                teamTable += '<strong>' + game.awayTeam + '</strong>';
            } else {
                teamTable += game.awayTeam;
            }

            teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid black;"></td><td style="width: 70px;">' + topData;
            teamTable += '</td></tr><tr><td style="width: 250px;">';
            
            if (data.teams.some(team => team.school === game.homeTeam)) {
                // teamTable += '<img src="' + data.teams[iterNum].logos[0] + '" alt="' + data.teams[iterNum].mascot + '">';
                teamTable += '<strong>' + game.homeTeam + '</strong>';
            } else {
                teamTable += game.homeTeam;
            }
            
            teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid black;"></td><td style="width: 100px;">' + bottomData;
            teamTable += '</td></tr><tr></tr><tbody></table></td>';

            str += teamTable;
        }
        scheduleContainer.innerHTML = str;
    }
}