const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;
var weekCode;
var userData;
var isMobile;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

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

window.onload = function() {
    detectMobile();

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

    document.querySelector('.loading-container').style.display = "block";
    document.querySelector('.schedule-table').style.display = "none";
    displaySchedule(userData);
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
        userData = data[0];
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

async function getRankings (week, seasonType) {
    var pollName = "Playoff Committee Rankings";

    if (week < 10) {
        pollName = "AP Top 25";
    }
    var response = await fetch(`/rankings/${week}/${seasonType}/${pollName}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var rankings = await response.json();
    var rankingsArray = rankings[0].polls[0].ranks;
    return rankingsArray;
}

async function getTeamLogos (game) {

    const teams = [game.awayTeam, game.homeTeam];

    const teamsJson = {
        teams: teams
    };

    var teamsPromise = await fetch('/teams/teamLogos', {
        method: 'POST',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        },
        body: JSON.stringify(teamsJson),
    });

    var teamLogos = await teamsPromise;
    var response = await teamLogos.json();

    if (teamLogos.status == 200) {
        var awayTeamLogo = response.find((element) => element.school == game.awayTeam);
        var homeTeamLogo = response.find((element) => element.school == game.homeTeam);

        if (awayTeamLogo == null) {
            awayTeamLogo = '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';
        } else {
            awayTeamLogo = '<img src="' + awayTeamLogo.logos[0] + '" style="padding-right: 5px;">';
        }

        if (homeTeamLogo == null) {
            homeTeamLogo = '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';
        } else {
            homeTeamLogo = '<img src="' + homeTeamLogo.logos[0] + '" style="padding-right: 5px;">';
        }

        const logoResponse = {awayTeamLogo, homeTeamLogo};
        return logoResponse;
    } else {
        console.log(response.message);
    }
}

async function displaySchedule(data) {
    const scheduleContainer = document.querySelector('[schedule-body]');
    var str = '<tr>';
    var gameIds = [];
    var gameTables = [];

    var week = window.localStorage.getItem("weekCode").substring(5);
    var gameWeek;
    var seasonType = "regular";

    if (week == "16") {
        seasonType = "postseason";
        week = 1;
        gameWeek = "16"
    } else {
        gameWeek = week;
    }

    var rankingsInfo = await getRankings(week, seasonType);

    for (var iterNum = 0; iterNum < data.teams.length; iterNum++) {

        var gamesInfo = await getGame(seasonType, week, data.teams[iterNum]);

        for (const game of gamesInfo) {

            var awayRank = '';
            var homeRank = '';

            var awayIndex = rankingsInfo.findIndex(e => e.school === game.awayTeam);
            if (awayIndex > -1) {
                awayRank = rankingsInfo[awayIndex].rank;
            }

            var homeIndex = rankingsInfo.findIndex(e => e.school === game.homeTeam);
            if (homeIndex > -1) {
                homeRank = rankingsInfo[homeIndex].rank;
            }

            awayRank = `<p style="display: inline; padding-right: 5px; color: #787878;">${awayRank}</p>`;
            homeRank = `<p style="display: inline; padding-right: 5px; color: #787878;">${homeRank}</p>`;

            if (gameIds.indexOf(game.id) == -1) {
                gameIds.push(game.id);

                var topData = '';
                var bottomData = '';
                var scoreAdded = '<strong style="color: white;">+0<strong>';
                var awayTeam = '';
                var homeTeam = '';
                var isAway = false;
                var teamLogos = await getTeamLogos(game);
                var awayImg = teamLogos.awayTeamLogo;
                var homeImg = teamLogos.homeTeamLogo;
    
                if (!game.startTimeTbd) {
    
                    if (game.awayTeam == data.teams[iterNum].school) {
                        awayTeam= '<strong>' + game.awayTeam + '</strong>';
                        homeTeam = game.homeTeam;
    
                        isAway = true;
                    } else {
                        awayTeam = game.awayTeam;
                        homeTeam = '<strong>' + game.homeTeam + '</strong>';
                    }
    
    
                    if( game.awayPoints > game.homePoints ) {
                        if(game.awayTeam == data.teams[iterNum].school) {
                            var weeklyScore = userData.weeklyScore[(parseInt(gameWeek) - 1)];
                            var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.team == game.awayTeam;
                            });
    
                            scoreAdded = '<strong style="color: green;">+' + teamScoreObject[0].score + '<strong>';
                        }
                        topData = game.awayPoints + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added"><strong>' + scoreAdded + '<strong></td>';
                        bottomData = game.homePoints;
                    } else {
    
                        if(!isAway) {
                            var weeklyScore = userData.weeklyScore[(parseInt(gameWeek) - 1)];
                            var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.team == game.homeTeam;
                            });
    
                            scoreAdded = '<strong style="color: green;">+' + teamScoreObject[0].score + '<strong>';
                        }
    
                        topData = game.awayPoints;
                        bottomData = game.homePoints+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
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
    
                teamTable += awayImg + awayRank + awayTeam;
                teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid black;"></td><td style="width: 70px;">' + topData;
                teamTable += '</tr><tr><td style="width: 250px;">';
    
                teamTable += homeImg + homeRank + homeTeam;
                teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid black;"></td><td style="width: 100px;">' + bottomData;
                teamTable += '</tr><tr></tr><tbody></table></td>';
    
                var gameInfo = {
                    id: game.id,
                    table: teamTable,
                    homeTeam: game.homeTeam,
                    awayTeam: game.awayTeam
                };

                gameTables.push(gameInfo);
            } else {
                if (!game.startTimeTbd) {

                    var shouldReplace = false;
    
                    if (game.awayTeam == data.teams[iterNum].school) {
                        awayTeam= '<strong>' + game.awayTeam + '</strong>';
                        homeTeam = game.homeTeam;
    
                        isAway = true;
                    } else {
                        awayTeam = game.awayTeam;
                        homeTeam = '<strong>' + game.homeTeam + '</strong>';
                    }
    
    
                    if( game.awayPoints > game.homePoints ) {
                        if(game.awayTeam == data.teams[iterNum].school) {
                            shouldReplace = true;
                            var weeklyScore = userData.weeklyScore[(parseInt(gameWeek) - 1)];
                            var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.team == game.awayTeam;
                            });
    
                            scoreAdded = '<strong style="color: green;">+' + teamScoreObject[0].score + '<strong>';
                        }
                        topData = game.awayPoints + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added"><strong>' + scoreAdded + '<strong></td>';
                        bottomData = game.homePoints;
                    } else {
    
                        if(game.homeTeam == data.teams[iterNum].school) {
                            shouldReplace = true;
                            var weeklyScore = userData.weeklyScore[(parseInt(gameWeek) - 1)];
                            var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.team == game.homeTeam;
                            });
    
                            scoreAdded = '<strong style="color: green;">+' + teamScoreObject[0].score + '<strong>';
                        }
    
                        topData = game.awayPoints;
                        bottomData = game.homePoints+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                    }

                    var teamLogos = await getTeamLogos(game);
                    var awayImg = teamLogos.awayTeamLogo;
                    var homeImg = teamLogos.homeTeamLogo;

                    var teamTable = '<td><table class="schedule-table game-table"><tbody><tr></tr><tr><td style="width: 250px;">';
    
                    teamTable += awayImg + awayRank + awayTeam;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid black;"></td><td style="width: 70px;">' + topData;
                    teamTable += '</tr><tr><td style="width: 250px;">';
        
                    teamTable += homeImg + homeRank + homeTeam;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid black;"></td><td style="width: 100px;">' + bottomData;
                    teamTable += '</tr><tr></tr><tbody></table></td>';
        
                    var gameInfo = {
                        id: game.id,
                        table: teamTable,
                        homeTeam: game.homeTeam,
                        awayTeam: game.awayTeam
                    };

                    if (shouldReplace) {
                        var indexToReplace = gameTables.findIndex(x => x.id == game.id);
                        gameTables.splice(indexToReplace, 1);
                        gameTables.push(gameInfo);
                    }
                }
            }
        } 
    }
    for(var k = 0; k < gameTables.length; k++) {
        if (isMobile) {
            str += '</tr><tr>';
        }
        
        if ((k + 1) > gameTables.length) {
            str += '</td></tr>'
        }
        else if (((k) % 3 == 0) && (k > 0)) {
            str += '</tr><tr>';
        }

        str += gameTables[k].table;

        if (isMobile) {
            str += '</tr><tr>';
        }
    }
    scheduleContainer.innerHTML = str;
    document.querySelector('.loading-container').style.display = "none";
    document.querySelector('.schedule-table').style.display = "flex";
}