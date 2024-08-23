import { setChartData } from './weekByWeek.js';

var isMobile;

function detectMobile() {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent)){
        // true for mobile device
        isMobile = true;
    } else{
        // false for not mobile device
        isMobile = false;
    }
}

const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

window.onload = async function() {
    detectMobile();

    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("user metadata", data)

        leagueCode = window.sessionStorage.getItem("leagueCode");

        if (leagueCode && (leagueCode != "undefined")) {
            const currentSelectedLeague = window.sessionStorage.getItem("league");
            if (currentSelectedLeague) {
                $("#dropdownMenuButton").text(currentSelectedLeague);
            }
        } else {
            var userLeague = data.user_metadata.metadata.league;
            if (userLeague == "gg") {
                leagueCode = "graham-league";
            } else {
                leagueCode = "claunts-league";
            }
        }
        
        var userRole = data.user_metadata.roles[0];
        if (userRole != "Admin") {
            document.querySelector('[admin-page]').remove();
            document.querySelector('[league-selector]').remove();
        }

        getUsers();
    });
  };

async function getUsers() {
    const response = await fetch(`/users/league/${leagueCode}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        displayUsers(data);
        displayHighlights(data);

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
        return b.seasons[0].cumulativeScore - a.seasons[0].cumulativeScore;
    });

    data.forEach( (user, index) => {
        var userSeason = user.seasons[0];
        str += '<tr>';
        str += '<th class="sticky-header">' + (index + 1) + '</th>';
        str += `<th class="sticky-header"><a href="/userHome?user=${user._id}">` + user.firstName + ' ' + user.lastName + '</a></th>';
        
        userSeason.teams.forEach(team => {
            var refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
            refLink = refLink.replace(/\s/g, "-").toLowerCase();

            str += '<td class="team-item"><div>';
            str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos[0] + '" alt="' + team.mascot + '">'
            str += team.mascot;
            str += '</div></td></a>';
        })

        str += '<th class="sticky-header-score">' + (userSeason.cumulativeScore ? userSeason.cumulativeScore : 0) + '</th>';
        str += '</tr>';
    });

    userTableBody.innerHTML = str;
}

async function displayHighlights(users) {
    const highlightTableBody = document.querySelector('[highlight-body]');
    var str = '';

    if (isMobile) {
        str += '<tr>' + await biggestWinner(users) + '</tr>';
        str += '<tr>' + await biggestLoser(users) + '</tr>';
        str += '<tr>' + await bestTeam(users) + '</tr>';
    } else {
        str += '<tr>';
        str += await biggestWinner(users);
        str += await biggestLoser(users);
        str += await bestTeam(users);
        str += '</tr>';
    }

    highlightTableBody.innerHTML = str;
}

async function biggestWinner(users) {
    var tableContent = '';
    var weekIndex = (users[0].seasons[0].weeklyScore.length -1);
    var sortedUsers = users.toSorted(function(b, a) {
        var aScore = a.seasons[0].weeklyScore[weekIndex] ?? {score: 0};
        var bScore = b.seasons[0].weeklyScore[weekIndex] ?? {score: 0};

        return parseFloat(aScore.score) - parseFloat(bScore.score);
    });

    var userName = sortedUsers[0].firstName;
    var userScore = sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].score;
    var week = "Week " + sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].week;

    if ((week == "Week 1") && (sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].season == "postseason")) {
        week = "Postseason";
    }

    tableContent = `
    <td>
        <table class="schedule-table game-table">
            <tbody>
                <tr>
                    <td style="width: 300px;"><strong>Biggest Winner in ${week}</strong></td>
                </tr>
                <tr>
                    <td style="width: 250px; display: flex;"><p>${userName}</p><p style="padding-left: 10px;color: green;">+${userScore}</p></td>
                </tr>
            </tbody>
        </table>
    </td>`;

    return tableContent;
}

function biggestLoser(users) {
    var tableContent = '';
    var weekIndex = (users[0].seasons[0].weeklyScore.length -1);
    var sortedUsers = users.toSorted(function(a, b) {
        var aScore = a.seasons[0].weeklyScore[weekIndex] ?? {score: 0};
        var bScore = b.seasons[0].weeklyScore[weekIndex] ?? {score: 0};

        return parseFloat(aScore.score) - parseFloat(bScore.score);

        return parseFloat(a.seasons[0].weeklyScore[weekIndex].score) - parseFloat(b.seasons[0].weeklyScore[weekIndex].score);
    });

    var userName = sortedUsers[0].firstName;
    var userScore;
    if(sortedUsers[0].seasons[0].weeklyScore.length == 0) {
        userScore = 0;
    } else {
        userScore = sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].score;
    }

    var week = "Week " + sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].week;

    if ((week == "Week 1") && (sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].season == "postseason")) {
        week = "Postseason";
    }

    tableContent = `
    <td>
        <table class="schedule-table game-table">
            <tbody>
                <tr>
                    <td style="width: 300px;"><strong>Biggest Loser in ${week}</strong></td>
                </tr>
                <tr>
                    <td style="width: 250px; display: flex;"><p>${userName}</p><p style="padding-left: 10px;color: red;">+${userScore}</p></td>
                </tr>
            </tbody>
        </table>
    </td>`;

    return tableContent;
}

async function bestTeam(users) {
    var tableContent;
    var teamScores = [];

    users.forEach((user, index) => {
        user.seasons[0].teams.forEach( (team, index) => {
            var totalScore = 0;
            
            user.seasons[0].weeklyScore.forEach(week => {
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

    tableContent = `
    <td>
        <table class="schedule-table game-table">
            <tbody>
                <tr>
                    <td style="width: 300px;"><strong>Highest Performing Team</strong></td>
                </tr>
                <tr>
                    <td style="width: 250px; display: flex;"><p>${sortedTeamScores[0].team}</p><p style="padding-left: 10px;">+${sortedTeamScores[0].score} points</p></td>
                </tr>
            </tbody>
        </table>
    </td>`;

    return tableContent;
}

$(".dropdown-menu a").click(function(){
    $(this).parents(".dropdown").find('.btn').html($(this).text());
    $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
    var selectedLeague = $("#dropdownMenuButton").text();
    var selectedLeagueCode = $("#dropdownMenuButton").val();
    window.sessionStorage.setItem("league", selectedLeague);
    window.sessionStorage.setItem("leagueCode", selectedLeagueCode);
    window.location.reload();
});