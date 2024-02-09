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
    var weekIndex = (users[0].weeklyScore.length -1);
    var sortedUsers = users.toSorted(function(b, a) {
        return parseFloat(a.weeklyScore[weekIndex].score) - parseFloat(b.weeklyScore[weekIndex].score);
    });

    var userName = sortedUsers[0].firstName;
    var userScore = sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].score;
    var week = "Week " + sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].week;

    if ((week == "Week 1") && (sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].season == "postseason")) {
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
    var weekIndex = (users[0].weeklyScore.length -1);
    var sortedUsers = users.toSorted(function(a, b) {
        return parseFloat(a.weeklyScore[weekIndex].score) - parseFloat(b.weeklyScore[weekIndex].score);
    });

    var userName = sortedUsers[0].firstName;
    var userScore = sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].score;
    var week = "Week " + sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].week;

    if ((week == "Week 1") && (sortedUsers[0].weeklyScore[sortedUsers[0].weeklyScore.length - 1].season == "postseason")) {
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