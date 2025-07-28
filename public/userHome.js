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

async function getUserProfile() {
    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        console.log("user metadata", data)

        weekCode = window.localStorage.getItem("weekCode");
        const currentSelectedWeek = window.localStorage.getItem("week");
        if (currentSelectedWeek) {
            $("#dropdownMenuButtonWeek").text(currentSelectedWeek);
        }

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

        getUser();
    });
}

window.onload = function() {
    detectMobile();
    getUserProfile();
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

    document.querySelector('.football-loader').style.display = "block";
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

    var currentWeeksLength = data.seasons.at(-1).weeklyScore.length;

    data.seasons.at(-1).teams.forEach( (team, index) => {
        var totalScore = 0;

        str += '<tr>';
        refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
        refLink = refLink.replace(/\s/g, "-").toLowerCase();

        str += '<th class="team-item sticky-header">';
        str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos.at(-1) + '" alt="' + team.mascot + '">'
        str += team.school;
        str += '</th></a>';
        
        data.seasons.at(-1).weeklyScore.forEach(week => {
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
    str += '<th class="team-item sticky-header">';
    str += 'Cumulative Score';
    str += '</th>';

    data.seasons.at(-1).weeklyScore.forEach(week => {
        str += '<td>' + week.score + '</td>'
    });

    for(var i = 0; i < (16 - currentWeeksLength); i++) {
        str += '<td>0</td>';
    }

    str += '<th class="sticky-header-score">' + (data.seasons.at(-1).cumulativeScore || 0) + '</th>';
    str += '</tr>';

    userTableBody.innerHTML = str;
}

async function getGame(season, week, team) {

    var gamePromise = await fetch(`/games/seasonType/${season}/week/${week}/team/${team.id}`, {
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

    var response = await fetch(`/rankings/${week}/${seasonType}/poll/${pollName}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var rankings = await response.json();
    var rankingsArray = [];

    if (rankings.length > 0) {
        rankingsArray = rankings[0].polls[0].ranks;
    } else {
        console.log(rankings.message);
    }

    return rankingsArray;
}

async function getTeamLogos (game) {

    const teams = [game.awayId, game.homeId];

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
        var awayTeamLogo = response.find((element) => element.id == game.awayId);
        var homeTeamLogo = response.find((element) => element.id == game.homeId);

        if (awayTeamLogo == null) {
            awayTeamLogo = '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';
        } else {
            awayTeamLogo = '<img src="' + awayTeamLogo.logos.at(-1) + '" style="padding-right: 5px;">';
        }

        if (homeTeamLogo == null) {
            homeTeamLogo = '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';
        } else {
            homeTeamLogo = '<img src="' + homeTeamLogo.logos.at(-1) + '" style="padding-right: 5px;">';
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
    var rankingsInfo;

    if (week == "17") {
        rankingsInfo = await getRankings((week - 1), seasonType);

        seasonType = "postseason";
        week = 1;
        gameWeek = "17"
    } else {
        gameWeek = week;
        rankingsInfo = await getRankings(week, seasonType);
    }

    for (var iterNum = 0; iterNum < data.seasons.at(-1).teams.length; iterNum++) {

        var gamesInfo = await getGame(seasonType, week, data.seasons.at(-1).teams[iterNum]);

        for (const [i, game] of gamesInfo.entries()) {

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

            awayRank = `<p style="display: inline; padding-right: 5px; color: #A4A9C2;">${awayRank}</p>`;
            homeRank = `<p style="display: inline; padding-right: 5px; color: #A4A9C2;">${homeRank}</p>`;

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

                if (game.awayId == data.seasons.at(-1).teams[iterNum].id) {

                    if (await data.seasons.at(-1).teams.some(e => e.id === game.homeId)) {
                        awayTeam= '<strong>' + game.awayTeam + '</strong>';
                        homeTeam = '<strong>' + game.homeTeam + '</strong>';
                    } else {
                        awayTeam= '<strong>' + game.awayTeam + '</strong>';
                        homeTeam = game.homeTeam;
                    }

                    isAway = true;
                } else {
                    awayTeam = game.awayTeam;
                    homeTeam = '<strong>' + game.homeTeam + '</strong>';
                }
    
                if (game.completed) {
    
                    if( game.awayPoints > game.homePoints ) {
                        if(game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                            var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                            var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.teamId == game.awayId;
                            });
    
                            scoreAdded = '<strong style="color: #22C37A;">+' + teamScoreObject[i].score + '<strong>';
                        }

                        if (isBowlParticipant(game) && (leagueCode == "claunts-league")) {
                            scoreAdded = '<strong style="color: #22C37A;">+4<strong>';
                            topData = (game.awayPoints || '0') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>';
                            bottomData = (game.homePoints || '0') + '<td class="score-added">' + scoreAdded + '</td>';
                        } else {
                            topData = (game.awayPoints || '0') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                            bottomData = (game.homePoints || '0');
                        }
                    } else if (game.homePoints > game.awayPoints) {
    
                        if(!isAway) {
                            var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                            var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.teamId == game.homeId;
                            });
    
                            var teamObjectScore = (teamScoreObject[i].score || 0);
                            scoreAdded = '<strong style="color: #22C37A;">+' + teamObjectScore + '<strong>';
                        }
    
                        topData = (game.awayPoints || '0');
                        bottomData = (game.homePoints || '0')+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                    } else {
                        if(game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                            var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                            var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.teamId == game.awayId;
                            });
    
                            scoreAdded = '<strong style="color: #22C37A;">+' + teamScoreObject[i].score + '<strong>';
                        }
                        topData = (game.awayPoints || '0');
                        bottomData = (game.homePoints || '0');
                    }
                } else {
    
                    var centralDate = new Date(game.startDate);
                    var militaryTime = centralDate.toString().substring(16,21);
                    var time = militaryTime.split(':');
                    var hours = parseInt(time[0]);
                    var minutes = time[1];
                    var standardTime = '';
    
                    if (hours < 12) {
                        standardTime = hours.toString() + ":" + minutes +  "AM";
                    }
                    else if (hours == 12) {
                        standardTime = hours.toString() + ":" + minutes + "PM";
                    }
                    else {
                        standardTime =( hours - 12).toString() + ":" + minutes + "PM";
                    }
    
                    topData = centralDate.toString().substring(4,10);
                    bottomData = standardTime;
                }
    
                var teamTable = '<td><table class="schedule-table game-table"><tbody><tr></tr><tr><td style="width: 250px;">';
    
                teamTable += awayImg + awayRank + awayTeam;
                teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 70px;">' + topData;
                teamTable += '</tr><tr><td style="width: 250px;">';
    
                teamTable += homeImg + homeRank + homeTeam;
                teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 100px;">' + bottomData;
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

                    if (game.completed) {
                        var shouldReplace = false;
    
                        if (game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                            if (await data.seasons.at(-1).teams.some(e => e.id === game.homeId)) {
                                awayTeam= '<strong>' + game.awayTeam + '</strong>';
                                homeTeam = '<strong>' + game.homeTeam + '</strong>';
                            } else {
                                awayTeam= '<strong>' + game.awayTeam + '</strong>';
                                homeTeam = game.homeTeam;
                            }
        
                            isAway = true;
                        } else {
                            awayTeam = game.awayTeam;
                            homeTeam = '<strong>' + game.homeTeam + '</strong>';
                        }
        
        
                        if (game.seasonType == "postseason" && game.notes.toLowerCase().includes("playoff")) {
                            shouldReplace = true;
                            var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];

                            var awayTeamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.teamId == game.awayId;
                            });
                            var homeTeamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.teamId == game.homeId;
                            });
    
                            awayScoreAdded = '<strong style="color: #22C37A;">+' + awayTeamScoreObject[0].score + '<strong>';
                            homeScoreAdded = '<strong style="color: #22C37A;">+' + homeTeamScoreObject[0].score + '<strong>';

                            if (game.awayPoints > game.homePoints) {
                                topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints || '-') + '<td class="score-added">' + homeScoreAdded + '</td>';
                            } else {
                                topData = (game.awayPoints || '-') + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + homeScoreAdded + '</td>';
                            }

                        } else if ( game.awayPoints > game.homePoints ) {
                            if(game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                                shouldReplace = true;
                                var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                                var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                    return obj.teamId == game.awayId;
                                });
        
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamScoreObject[0].score + '<strong>';
                            }
                            topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                            bottomData = (game.homePoints || '-');
                        } else {
        
                            if(game.homeId == data.seasons.at(-1).teams[iterNum].id) {
                                shouldReplace = true;
                                var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                                var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                    return obj.teamId == game.homeId;
                                });
        
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamScoreObject[0].score + '<strong>';
                            }
        
                            topData = (game.awayPoints || '-');
                            bottomData = (game.homePoints || '-')+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                        }
                    } else {
                        var centralDate = new Date(game.startDate);
                        var militaryTime = centralDate.toString().substring(16,21);
                        var time = militaryTime.split(':');
                        var hours = parseInt(time[0]);
                        var minutes = time[1];
                        var standardTime = '';
        
                        if (hours < 12) {
                            standardTime = hours.toString() + ":" + minutes +  "AM";
                        }
                        else if (hours == 12) {
                            standardTime = hours.toString() + ":" + minutes + "PM";
                        }
                        else {
                            standardTime =( hours - 12).toString() + ":" + minutes + "PM";
                        }
        
                        topData = centralDate.toString().substring(4,10);
                        bottomData = standardTime;
                    }
                    

                    var teamLogos = await getTeamLogos(game);
                    var awayImg = teamLogos.awayTeamLogo;
                    var homeImg = teamLogos.homeTeamLogo;

                    var teamTable = '<td><table class="schedule-table game-table"><tbody><tr></tr><tr><td style="width: 250px;">';
    
                    teamTable += awayImg + awayRank + awayTeam;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 70px;">' + topData;
                    teamTable += '</tr><tr><td style="width: 250px;">';
        
                    teamTable += homeImg + homeRank + homeTeam;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 100px;">' + bottomData;
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

    if (gameTables.length == 0) {
        showRandomNoGamesMessage();
    }

    scheduleContainer.innerHTML = str;
    document.querySelector('.football-loader').style.display = "none";
    document.querySelector('.schedule-table').style.display = "flex";
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

function isBowlParticipant(game) {
    if (game.notes) {
        if (game.notes.toLowerCase().includes("bowl") && !game.notes.toLowerCase().includes("cfp") && (game.seasonType == "postseason")) {
            return true;
        }
    } else {
        return false;
    }
}

const noGamesMessages = [
  `
  <div class="no-games-message lights-out">
    <div class="stadium-icon">🏟️</div>
    <h3>Field's Closed</h3>
    <p>Looks like the stadium lights are off. No games today.</p>
    <p class="suggestion">Try screaming at a referee in your backyard to stay in shape.</p>
  </div>
  `,
  `
  <div class="no-games-message mascot-strike">
    <div class="tiger-icon">🐯</div>
    <h3>Mascots on Strike</h3>
    <p>No games this week. Demanding more glitter cannons and fewer kickoffs.</p>
    <p class="suggestion">Solidarity forever. But fantasy points never.</p>
  </div>
  `,
  `
  <div class="no-games-message smoke-time">
    <div class="football-icon">🏈</div>
    <h3>Fantasy Engine Cooling Down</h3>
    <p>No games today. Even algorithms need a water break.</p>
    <p class="suggestion">Maybe check your lineup. Or don't. We’re not your coach.</p>
  </div>
  `
];

function showRandomNoGamesMessage() {
  const container = document.getElementById("no-games-container");
  const randomIndex = Math.floor(Math.random() * noGamesMessages.length);
  container.innerHTML = noGamesMessages[randomIndex];
}