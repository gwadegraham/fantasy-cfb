import { setChartData } from './weekByWeek.js';

var isMobile;
var weekCode;
var usersData;

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
        } else if (userRole == "Admin") {
            document.querySelector('.maintenance-container').style.display = 'none';
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
        displayLastUpdated(data);
        displayHighlights(data);
        displaySchedule(data);
        usersData = data;

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
        str += `<th class="sticky-header"><a href="/userHome?user=${user._id}">` + user.firstName + ' ' + user.lastName.substring(0,1) + '.</a></th>';
        str += '<td class="team-item">';

        for (var i = 0; i < userSeason.teams.length; i++) {
            var team = userSeason.teams[i];
            var refLink = "https://www.sports-reference.com/cfb/schools/" + team.school;
            refLink = refLink.replace(/\s/g, "-").toLowerCase();

            str += '<div>';
            str += '<a target="_blank" href="' + refLink + '"><img src="' + team.logos.at(-1) + '" alt="' + team.mascot + '">'
            str += '</div></a>';
        }

        str += '</td>';
        str += '<th class="sticky-header-score">' + (userSeason.cumulativeScore ? userSeason.cumulativeScore : 0) + '</th>';
        str += '</tr>';
    });

    userTableBody.innerHTML = str;
}

function displayLastUpdated(data) {
    var lastUpdatedTime = new Date(data[0].lastUpdated);

    if (lastUpdatedTime != "Invalid Date") {
        var hours = lastUpdatedTime.getHours() % 12;
        hours = hours ? hours : 12;

        var minutes = lastUpdatedTime.getMinutes();
        minutes = minutes < 10 ? ("0" + minutes) : minutes;

        var amPm = lastUpdatedTime.getHours() >= 12 ? 'PM' : 'AM';
        var formatTime = `${lastUpdatedTime.getMonth()+1}/${lastUpdatedTime.getDate()} at ${hours}:${minutes} ${amPm}`;

        const lastUpdated = document.querySelector('[last-updated]');
        lastUpdated.innerHTML = `Last Updated ${formatTime}`;
    }
}

async function displayHighlights(users) {
    await biggestWinner(users);
    await biggestLoser(users);
    await bestTeam(users);
    await hotTeam(users);
}

async function biggestWinner(users) {
    var weekIndex = (users[0].seasons[0].weeklyScore.length -1);
    var sortedUsers = users.toSorted(function(b, a) {
        var aScore = a.seasons[0].weeklyScore[weekIndex] ?? {score: 0};
        var bScore = b.seasons[0].weeklyScore[weekIndex] ?? {score: 0};

        return parseFloat(aScore.score) - parseFloat(bScore.score);
    });

    var userName = sortedUsers[0].firstName + " " + sortedUsers[0].lastName.substring(-1,1) + ".";

    var userScore = sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].score;
    var week = "Week " + sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].week;

    if ((week == "Week 1") && (sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].season == "postseason")) {
        week = "Postseason";
    }

    const winnerWeek = document.querySelector('[winner-week]');
    const winner = document.querySelector('[biggest-winner]');
    const winnerScore = document.querySelector('[biggest-winner-score]');

    winnerWeek.innerHTML = ` in ${week}`;
    winner.innerHTML = userName;
    winnerScore.innerHTML = `+${userScore}`;
}

function biggestLoser(users) {
    var loserUsers = [];
    var weekIndex = (users[0].seasons[0].weeklyScore.length -1);
    var sortedUsers = users.toSorted(function(a, b) {
        var aScore = a.seasons[0].weeklyScore[weekIndex] ?? {score: 0};
        var bScore = b.seasons[0].weeklyScore[weekIndex] ?? {score: 0};

        return parseFloat(aScore.score) - parseFloat(bScore.score);
    });

    loserUsers.push({
        firstName: sortedUsers[0].firstName,
        lastName: sortedUsers[0].lastName,
        score: sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].score
    });

    for (var x = 1; x < sortedUsers.length; x++) {
        if (sortedUsers[x].seasons[0].weeklyScore[sortedUsers[x].seasons[0].weeklyScore.length - 1].score == sortedUsers[(x-1)].seasons[0].weeklyScore[sortedUsers[(x-1)].seasons[0].weeklyScore.length - 1].score) {
            loserUsers.push({
                firstName: sortedUsers[x].firstName,
                lastName: sortedUsers[x].lastName,
                score: sortedUsers[x].seasons[0].weeklyScore[sortedUsers[x].seasons[0].weeklyScore.length - 1].score
            });
        }
    }

    var userName = '';
    var week = "Week " + sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].week;

    if ((week == "Week 1") && (sortedUsers[0].seasons[0].weeklyScore[sortedUsers[0].seasons[0].weeklyScore.length - 1].season == "postseason")) {
        week = "Postseason";
    }

    const loserWeek = document.querySelector('[loser-week]');
    const loser = document.querySelector('[biggest-loser]');
    const loserScore = document.querySelector('[biggest-loser-score]');

    if (loserUsers.length > 1) {
        loserWeek.innerHTML = `in ${week}`;
        var htmlString = '';

        loserUsers.forEach((user) => {
            userName = user.firstName + " " + user.lastName.substring(-1,1) + ".";            
            htmlString += `<span biggest-loser>${userName}</span><br>`;
            loserScore.innerHTML = `+${user.score}`;
        });

        loser.outerHTML = htmlString;
    } else {
        userName = loserUsers[0].firstName + " " + loserUsers[0].lastName.substring(-1,1) + ".";
        loserWeek.innerHTML = `in ${week}`;
        loser.outerHTML = `<span biggest-loser>${userName}</span><br>`;
        loserScore.innerHTML = `+${loserUsers[0].score}`;
    }
}

async function bestTeam(users) {
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
                team: team.mascot,
                score: totalScore,
                logo: team.logos.at(-1)
            }

            teamScores.push(teamInfo);
        });
    });

    var sortedTeamScores = await teamScores.sort(function(a, b) {
        return parseFloat(b.score) - parseFloat(a.score);
    });

    var resultScores = [sortedTeamScores[0]];


    for (var y = 1; y < sortedTeamScores.length; y++) {
        if (sortedTeamScores[y].score == sortedTeamScores[(y - 1)].score) {
            resultScores.push(sortedTeamScores[y]);
        } else {
            break;
        }
    }


    const bestWeek = document.querySelector('[best-week]');
    const best = document.querySelector('[best-team]');
    const bestScore = document.querySelector('[best-team-score]');
    var htmlString = '';
    
    resultScores.forEach( teamName => {        
        htmlString += `<span best-team><img src="${teamName.logo}">${teamName.team}</span><br>`;
        bestScore.innerHTML = `+${teamName.score}`;
    })

    best.outerHTML = htmlString;
    bestWeek.innerHTML = ' this season';
}

async function hotTeam(users) {
    var weekIndex = (users[0].seasons[0].weeklyScore.length -1);

    const scoredUsers = await Promise.all(users.map(async (user) => {
        const hotStreakScore = await getPreviousThreeSum(user.seasons[0].weeklyScore, weekIndex);
        return {
            ...user,
            hotStreakScore: parseFloat(hotStreakScore) || 0
        };
    }));

    const sortedUsers = scoredUsers.toSorted((a, b) => { 
        return b.hotStreakScore - a.hotStreakScore;
    });

    const topScore = sortedUsers[0]?.hotStreakScore ?? 0;
    const topUsers = sortedUsers.filter(user => user.hotStreakScore === topScore);

    const hotTeam = document.querySelector('[hot-team]');
    const hotTeamScore = document.querySelector('[hot-team-score]');
    var htmlString = '';

    topUsers.forEach( user => {
        htmlString += `<span hot-team>${user.firstName} ${user.lastName.substring(-1,1)}.</span><br>`;
    });

    hotTeam.outerHTML = htmlString;
    hotTeamScore.innerHTML = `+${topScore} over 2 weeks`;
}

async function getPreviousThreeSum(arr, currentIndex) {
    const startIndex = Math.max(0, currentIndex - 2);
    var elements = arr.slice(startIndex+1, currentIndex+1);
    elements = elements.map(week => week.score);
    return elements.reduce((a, b) => a + b, 0);
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
        console.log(`${response.message} | ${team.school}`);
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

    var usersAndTeams = [];

    for(var i = 0; i < data.length; i++) {

        var user = data[i];
        var userTeams = user.seasons[0].teams;
        var userTeamObject = {
            userName: user.firstName, 
            teams: userTeams
        };

        usersAndTeams.push(userTeamObject);
    }

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

    for (var iterUsers = 0; iterUsers < data.length; iterUsers++) {

        var userData = data[iterUsers];

        for (var iterNum = 0; iterNum < userData.seasons.at(-1).teams.length; iterNum++) {

            var otherUsers = usersAndTeams.toSpliced(iterUsers, 1);

            var gamesInfo = await getGame(seasonType, week, userData.seasons.at(-1).teams[iterNum]);

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

                function exists(arr, search) {
                    var doesExist = false;
                    var name = '';

                    arr.some(row => {
                        row.teams.some(team => {
                            if (team.id == search) {
                                doesExist = true;
                                name = row.userName;
                            }
                        })
                    });

                    return {
                        doesExist: doesExist,
                        name: name
                    };
                }

                var awayUser = '';
                var homeUser = '';

                if (gameIds.indexOf(game.id) == -1) {
                    var isHeadToHead = false;
                    var oppName = '';
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

                    if (game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                        var existObject = exists(otherUsers, game.homeId);
                        var doesExist = existObject.doesExist;
                        oppName = existObject.name;

                        awayUser = userData.firstName;
                        awayTeam= game.awayTeam;

                        homeUser = oppName;
                        homeTeam = game.homeTeam;
                        isAway = true;

                        if (doesExist) {
                            isHeadToHead = true;
                        }

                    } else {
                        var existObject = exists(otherUsers, game.awayId);
                        var doesExist = existObject.doesExist;
                        oppName = existObject.name;

                        awayUser = oppName;
                        awayTeam = game.awayTeam;

                        homeUser = userData.firstName;
                        homeTeam = game.homeTeam;

                        if (doesExist) {
                            isHeadToHead = true;
                        }
                    }
        
                    if (game.completed) {   

                        if (game.seasonType == "postseason" && game.notes.toLowerCase().includes("playoff")) {
                            shouldReplace = true;
                            var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];

                            var homeTeamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.teamId == game.homeId;
                            });

                            var awayTeamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                return obj.teamId == game.awayId;
                            });

                            var scoreDisplay = 0;
                            if ((homeTeamScoreObject.length > 0) || (awayTeamScoreObject.length > 0)) {
                                var scoreObject = ( homeTeamScoreObject.length > 0 ) ? homeTeamScoreObject : awayTeamScoreObject;
                                scoreDisplay = scoreObject[0].score;
                            }
    
                            var awayScoreAdded = '<strong style="color: #F2A93B;">+' + scoreDisplay + '<strong>';
                            var homeScoreAdded = '<strong style="color: #F2A93B;">+' + scoreDisplay + '<strong>';

                            if (game.awayPoints > game.homePoints) {
                                topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints || '-') + '<td class="score-added">' + homeScoreAdded + '</td>';
                            } else {
                                topData = (game.awayPoints || '-') + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + homeScoreAdded + '</td>';
                            }

                        } else if ( game.awayPoints > game.homePoints ) {
                            if(game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                                var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                                var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                    return obj.teamId == game.awayId;
                                });
        
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamScoreObject[i].score + '<strong>';
                            }
                            topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                            bottomData = (game.homePoints || '-');
                        } else if (game.homePoints > game.awayPoints) {
        
                            if(!isAway) {
                                var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                                var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                    return obj.teamId == game.homeId;
                                });
        
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamScoreObject[i].score + '<strong>';
                            }
        
                            topData = (game.awayPoints || '-');
                            bottomData = (game.homePoints || '-')+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                        } else {
                            if(game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                                var weeklyScore = userData.seasons.at(-1).weeklyScore[(parseInt(gameWeek) - 1)];
                                var teamScoreObject = weeklyScore.scoreByTeam.filter(obj => {
                                    return obj.teamId == game.awayId;
                                });
        
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamScoreObject[i].score + '<strong>';
                            }
                            topData = (game.awayPoints || '-');
                            bottomData = (game.homePoints || '-');
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
        
                    var teamTable = '<td><table class="schedule-table game-table"><tbody><tr firstRow></tr>';
                    teamTable += `<tr id="awayUserRow"><td><strong>${awayUser}</strong></td></tr>`;

                    teamTable += '<tr><td style="width: 250px;">';
        
                    teamTable += awayImg + awayRank + awayTeam;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 70px;">' + topData;
                    teamTable += '</tr>';
        
                    teamTable += '<tr><td style="width: 250px;">';
                    teamTable += homeImg + homeRank + homeTeam;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 100px;">' + bottomData;
                    teamTable += '</tr>';
                    teamTable += `<tr><td><strong>${homeUser}</strong></td></tr>`;
                    teamTable += '<tr></tr><tbody></table></td>';

                    var gameInfo = {
                        id: game.id,
                        table: teamTable,
                        homeTeam: game.homeTeam,
                        awayTeam: game.awayTeam
                    };

                    if (isHeadToHead) {
                        gameTables.push(gameInfo);
                    }
                } else {
                    if (!game.startTimeTbd) {

                        var shouldReplace = false;
        
                        if (game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                            var existObject = exists(otherUsers, game.homeId);
                            var doesExist = existObject.doesExist;
                            oppName = existObject.name;

                            awayUser = userData.firstName;
                            awayTeam= game.awayTeam;

                            homeUser = oppName;
                            homeTeam = game.homeTeam;
                            isAway = true;

                            if (doesExist) {
                                isHeadToHead = true;
                            }
                        } else {
                            var existObject = exists(otherUsers, game.awayId);
                            var doesExist = existObject.doesExist;
                            oppName = existObject.name;

                            awayUser = oppName;
                            awayTeam = game.awayTeam;

                            homeUser = userData.firstName;
                            homeTeam = game.homeTeam;

                            if (doesExist) {
                                isHeadToHead = true;
                            }
                        }
        
                        if (game.completed) {
                            if( game.awayPoints > game.homePoints ) {
                                if(game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
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
            
                                if(game.homeId == userData.seasons.at(-1).teams[iterNum].id) {
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
                        }
                        
                        var teamLogos = await getTeamLogos(game);
                        var awayImg = teamLogos.awayTeamLogo;
                        var homeImg = teamLogos.homeTeamLogo;

                        var teamTable = '<td><table class="schedule-table game-table"><tbody><tr></tr>';
                        teamTable += `<tr id="awayUserRow"><td><strong>${awayUser}</strong></td></tr>`;

                        teamTable += '<tr><td style="width: 250px;">';
                        teamTable += awayImg + awayRank + awayTeam;
                        teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 70px;">' + topData;
                        teamTable += '</tr>';
            
                        teamTable += '<tr><td style="width: 250px;">';
                        teamTable += homeImg + homeRank + homeTeam;
                        teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 100px;">' + bottomData;
                        teamTable += `<tr><td><strong>${homeUser}</strong></td></tr>`;
                        teamTable += '</tr><tr></tr><tbody></table></td>';
            
                        var gameInfo = {
                            id: game.id,
                            table: teamTable,
                            homeTeam: game.homeTeam,
                            awayTeam: game.awayTeam
                        };

                        if (shouldReplace && isHeadToHead) {
                            var indexToReplace = gameTables.findIndex(x => x.id == game.id);
                            gameTables.splice(indexToReplace, 1);
                            gameTables.push(gameInfo);
                        }
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
        str += '<i class="fa-solid fa-sad-cry" style="padding-right: 10px;"></i>no college football games?!<i class="fa-solid fa-sad-cry" style="padding-left: 5px;"></i>'
    }

    scheduleContainer.innerHTML = str;
    document.querySelector('.football-loader').style.display = "none";
    document.querySelector('.schedule-table').style.display = "flex";
}

$(".dropdown-menu-week a").click(function(){
    $(this).parents(".dropdownWeek").find('.btn').html($(this).text());
    $(this).parents(".dropdownWeek").find('.btn').val($(this).attr('value'));
    var selectedWeek = $("#dropdownMenuButtonWeek").text();
    var selectedWeekCode = $("#dropdownMenuButtonWeek").val();
    window.localStorage.setItem("week", selectedWeek);
    window.localStorage.setItem("weekCode", selectedWeekCode);
    document.querySelector('.football-loader').style.display = "block";
    document.querySelector('.schedule-table').style.display = "none";
    displaySchedule(usersData);
});

$(".dropdown-menu a").click(function(){
    $(this).parents(".dropdown").find('.btn').html($(this).text());
    $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
    var selectedLeague = $("#dropdownMenuButton").text();
    var selectedLeagueCode = $("#dropdownMenuButton").val();
    window.sessionStorage.setItem("league", selectedLeague);
    window.sessionStorage.setItem("leagueCode", selectedLeagueCode);
    window.location.reload();
});