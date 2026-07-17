import { setChartData } from './weekByWeek.js';
import { rankedRows, buildStandingsRowsHtml, buildHighlights, buildHighlightsHtml } from './standings-insights.js';

// Escapes HTML special chars before interpolating user-controlled values
// (player/team names) into innerHTML, preventing stored/second-order XSS.
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

var isMobile;
var weekCode;
var usersData;
var userMetadata;

// Latest regular-season week that has scored data (for defaulting the schedule).
function latestWeek(users) {
    let max = 0;
    users.forEach(u => ((u.seasons && u.seasons[0] && u.seasons[0].weeklyScore) || []).forEach(w => {
        if (w.season !== 'postseason' && typeof w.week === 'number' && w.week > max) max = w.week;
    }));
    return max;
}

function detectMobile() {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent)){
        // true for mobile device
        isMobile = true;
    } else{
        // false for not mobile device
        isMobile = false;
    }
}

window.onload = async function() {
    detectMobile();

    function initNavbarToggle() {
        const toggleButton = document.querySelector('.toggle-button');
        const navbarLinks = document.querySelector('.navbar-links');

        if (toggleButton && navbarLinks) {
            toggleButton.addEventListener('click', () => {
                navbarLinks.classList.toggle('active');
            });
        } else {
            // Retry after 500ms if elements aren't in the DOM yet
            setTimeout(initNavbarToggle, 500);
        }
    }

    initNavbarToggle();
    

    const response = await fetch(`/profile`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        userMetadata = data;

        weekCode = window.localStorage.getItem("weekCode");
        const currentSelectedWeek = window.localStorage.getItem("week");
        if (currentSelectedWeek) {
            $("#dropdownMenuButtonWeek").text(currentSelectedWeek);
        } else {
            $("#dropdownMenuButtonWeek").text("Week 1");
            weekCode = window.localStorage.setItem("weekCode", "week-1");
        }

        // Only set leagueCode from metaData if it's not already stored
        if (!window.localStorage.getItem("leagueCode") && data?.user_metadata?.metadata?.league) {
            var newLeagueCode = (data.user_metadata.metadata.league == 'gg' ? 'graham-league' : 'claunts-league');
            window.localStorage.setItem("leagueCode", newLeagueCode);
        }

        if (userState.user_metadata.roles?.at(-1) == 'Admin') {
            const leagueCode = window.localStorage.getItem("leagueCode");

            if (leagueCode && (leagueCode != "undefined")) {
                const currentSelectedLeague = window.sessionStorage.getItem("league");
                if (currentSelectedLeague) {
                    $("#dropdownMenuButton").text(currentSelectedLeague);
                }
            }
        }

        getUsers();
    });
  };

async function getUsers() {
    var leagueCode = (userState.user_metadata.metadata.league == 'gg' ? 'graham-league' : 'claunts-league');

    if (userState.user_metadata.roles?.at(-1) == 'Admin') {
        leagueCode = window.localStorage.getItem("leagueCode");
    }

    const response = await fetch(`/users/league/${leagueCode}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        
        usersData = data;

        if (data.length == 0) {
            document.querySelector('.no-data-message').removeAttribute('style');
            document.querySelector('.get-users-container').setAttribute('style', 'display: none;');
            document.querySelector('.highlights-header').setAttribute('style', 'display: none;');
            document.querySelector('.highlights-container').setAttribute('style', 'display: none;');
            document.querySelector('[poll-name]').setAttribute('style', 'display: none;');
            document.querySelector('.dropdownWeek').setAttribute('style', 'display: none;');
            document.querySelectorAll('.hr-subtle').forEach(x => x.setAttribute('style', 'display: none;'));
            document.querySelector('.game-content').setAttribute('style', 'display: none;');
        } else {
            // Default the schedule to the current week unless the user has
            // manually picked one (stored as "week").
            if (!window.localStorage.getItem('week')) {
                const cw = latestWeek(data);
                if (cw) {
                    window.localStorage.setItem('weekCode', 'week-' + cw);
                    weekCode = 'week-' + cw;
                    $("#dropdownMenuButtonWeek").text('Week ' + cw);
                }
            }
            displayUsers(data);
            displayLastUpdated(data);
            displayHighlights(data);
            displaySchedule(data);
            setNavbarUserId(userMetadata, usersData);
            // Chart is responsive now, so show it on mobile too.
            setChartData(data);
            document.querySelector('[chart-container]').removeAttribute("style");
        }
    });
}

function displayUsers(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    userTableBody.innerHTML = buildStandingsRowsHtml(rankedRows(data));
    animateScores(userTableBody);
}

// Brief count-up on each score for a little life on load. Respects reduced-motion.
function animateScores(root) {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelectorAll('.score-num[data-count]').forEach(el => {
        const target = parseInt(el.getAttribute('data-count'), 10) || 0;
        if (target <= 0) return;
        const start = performance.now(), dur = 600;
        function tick(now) {
            const p = Math.min(1, (now - start) / dur);
            el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
            if (p < 1) requestAnimationFrame(tick);
            else el.textContent = target;
        }
        el.textContent = '0';
        requestAnimationFrame(tick);
    });
}

function displayLastUpdated(data) {
    var lastUpdatedTime = new Date(data[0]?.lastUpdated);

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

function displayHighlights(users) {
    const container = document.querySelector('.highlights-container');
    if (container) container.innerHTML = buildHighlightsHtml(buildHighlights(users));
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

async function getRankings (week, seasonType, seasonYear) {
    // Use the league's active season (passed in), not the wall-clock year, so
    // rankings are fetched for the season actually being displayed.
    if (seasonYear == null) seasonYear = new Date().getFullYear();

    var response = await fetch(`/rankings/${seasonYear}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var rankings = await response.json();

    var pollName = 'Playoff Committee Rankings';
    if (!rankings.find(r => r.week == week)?.polls?.find(p => p.poll == "Playoff Committee Rankings") && seasonType != "postseason" ) {
        pollName = "AP Top 25";
    }

    rankings.sort((a, b) => {
        return b.week - a.week;
    });
    
    var weekRankings;
    if (seasonType == 'regular') {
        weekRankings = rankings.find(r => r.week == week && r.season == seasonYear) ? rankings.find(r => r.week == week && r.season == seasonYear)?.polls?.find(p => p.poll == pollName)?.ranks : rankings[0]?.polls?.find(p => p.poll == pollName)?.ranks;
    } else {
        weekRankings = rankings.find(r => r.week == '16' && r.season == seasonYear)?.polls?.find(p => p.poll == pollName)?.ranks;
    }

    // Always return an array so callers can safely call .findIndex even when the
    // week/season has no loaded rankings.
    return Array.isArray(weekRankings) ? weekRankings : [];
}

async function parseTeamLogos (game, allTeamLogos) {

        var awayTeamLogo = allTeamLogos.find((element) => element.id == game.awayId);
        var homeTeamLogo = allTeamLogos.find((element) => element.id == game.homeId);

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
}

async function getAllTeamLogos () {
    var teamsPromise = await fetch('/teams/teamLogos/all', {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var teamLogos = await teamsPromise;
    var response = await teamLogos.json();

    if (teamLogos.status == 200) {
        return response;
    } else {
        console.log(response.message);
    }
}

async function getAllBettingLines (seasonYear) {
    if (seasonYear == null) seasonYear = new Date().getFullYear();

    var bettingPromise = await fetch(`/betting/${seasonYear}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var bettingLines = await bettingPromise;
    var response = await bettingLines.json();

    if (bettingLines.status == 200) {
        return response;
    } else {
        console.log(response.message);
        return [];   // degrade gracefully: no lines rather than undefined
    }
}

// Returns the points a given team earned in a specific game, found by
// (teamId, gameId) anywhere in the season's weeklyScore — avoiding the fragile
// weeklyScore[gameWeek - 1] index (which mislocates the postseason bucket) and
// returning 0 instead of throwing when the game hasn't been scored yet.
function teamGameScoreById(weeklyScore, teamId, gameId) {
    if (!Array.isArray(weeklyScore)) return 0;
    for (var i = 0; i < weeklyScore.length; i++) {
        var sbt = weeklyScore[i] && weeklyScore[i].scoreByTeam;
        if (!Array.isArray(sbt)) continue;
        var match = sbt.find(o => o.teamId == teamId && o.gameId == gameId);
        if (match && typeof match.score === 'number') return match.score;
    }
    return 0;
}

async function displaySchedule(data) {
    const scheduleStart = new Date();
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

    // Resolve the year from the season being viewed (the users' latest season),
    // never the wall-clock year.
    var seasonYear = data[0]?.seasons?.at(-1)?.season;

    if (week == "17") {
        rankingsInfo = await getRankings((week - 1), seasonType, seasonYear);

        seasonType = "postseason";
        week = 1;
        gameWeek = "17"
    } else {
        gameWeek = week;
        rankingsInfo = await getRankings(week, seasonType, seasonYear);
    }

    var allTeamLogos = await getAllTeamLogos();
    var allBettingLines = await getAllBettingLines(seasonYear) || [];

    for (var iterUsers = 0; iterUsers < data.length; iterUsers++) {

        var userData = data[iterUsers];

        for (var iterNum = 0; iterNum < userData.seasons.at(-1).teams.length; iterNum++) {

            var otherUsers = usersAndTeams.toSpliced(iterUsers, 1);

            var gamesInfo = await getGame(seasonType, week, userData.seasons.at(-1).teams[iterNum]);

            for (const [i, game] of gamesInfo.entries()) {

                var awayRank = '';
                var homeRank = '';
                
                var bettingLineObj = allBettingLines.find(bettingObj => bettingObj.homeTeam == game.homeTeam && bettingObj.awayTeam == game.awayTeam)?.lines;
                var bettingLine;

                if (bettingLineObj) {
                    bettingLine = (bettingLineObj.find(line => line.provider == "DraftKings") ? bettingLineObj.find(line => line.provider == "DraftKings") : bettingLineObj[0])?.formattedSpread?.split("-");
                }
                var awayLine = '';
                var homeLine = '';

                if (bettingLine) {
                    awayLine = (bettingLine[0]?.trim() == game.awayTeam) ? bettingLine.at(-1) :  '';
                    homeLine = (bettingLine[0]?.trim() == game.homeTeam) ? bettingLine.at(-1) :  '';
                }

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
                    var teamLogos = await parseTeamLogos(game, allTeamLogos);
                    var awayImg = teamLogos.awayTeamLogo;
                    var homeImg = teamLogos.homeTeamLogo;

                    if (game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                        var existObject = exists(otherUsers, game.homeId);
                        var doesExist = existObject.doesExist;
                        oppName = existObject.name;

                        awayUser = userData.firstName;
                        awayTeam = `<a href="/team?team=${game.awayId}">${game.awayTeam}<span class="betting-line">${awayLine ? '-' + awayLine : ''}</span></a>`;

                        homeUser = oppName;
                        homeTeam = `<a href="/team?team=${game.homeId}">${game.homeTeam}<span class="betting-line">${homeLine ? '-' + homeLine : ''}</span></a>`;
                        isAway = true;

                        if (doesExist) {
                            isHeadToHead = true;
                        }

                    } else {
                        var existObject = exists(otherUsers, game.awayId);
                        var doesExist = existObject.doesExist;
                        oppName = existObject.name;

                        awayUser = oppName;
                        awayTeam = `<a href="/team?team=${game.awayId}">${game.awayTeam}<span class="betting-line">${awayLine ? '-' + awayLine : ''}</span></a>`;

                        homeUser = userData.firstName;
                        homeTeam = `<a href="/team?team=${game.homeId}">${game.homeTeam}<span class="betting-line">${homeLine ? '-' + homeLine : ''}</span></a>`;

                        if (doesExist) {
                            isHeadToHead = true;
                        }
                    }
        
                    if (game.completed) {   

                        if (game.seasonType == "postseason" && game.notes && game.notes.toLowerCase().includes("playoff")) {
                            shouldReplace = true;
                            // Each team's own points (the old code showed one team's
                            // score for both), found safely by (teamId, gameId).
                            var awayScoreAdded = '<strong style="color: #F2A93B;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
                            var homeScoreAdded = '<strong style="color: #F2A93B;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.homeId, game.id) + '<strong>';

                            if (game.awayPoints > game.homePoints) {
                                topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints || '-') + '<td class="score-added">' + homeScoreAdded + '</td>';
                            } else {
                                topData = (game.awayPoints || '-') + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + homeScoreAdded + '</td>';
                            }

                        } else if ( game.awayPoints > game.homePoints ) {
                            if(game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
                            }
                            topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                            bottomData = (game.homePoints || '-');
                        } else if (game.homePoints > game.awayPoints) {

                            if(!isAway) {
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.homeId, game.id) + '<strong>';
                            }

                            topData = (game.awayPoints || '-');
                            bottomData = (game.homePoints || '-')+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                        } else {
                            if(game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
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
                    teamTable += `</tr><tr><td class="game-notes">`;
                    teamTable += game.notes || '';
                    teamTable += '</td></tr><tbody></table></td>';

                    var gameInfo = {
                        id: game.id,
                        table: teamTable,
                        homeTeam: game.homeTeam,
                        awayTeam: game.awayTeam,
                        startDate: game.startDate || ''
                    };

                    if (isHeadToHead) {
                        gameTables.push(gameInfo);
                    }
                } else {
                    var isHeadToHead = false;
                    if (!game.startTimeTbd) {

                        var shouldReplace = false;
        
                        if (game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                            var existObject = exists(otherUsers, game.homeId);
                            var doesExist = existObject.doesExist;
                            oppName = existObject.name;

                            awayUser = userData.firstName;
                            awayTeam = `<a href="/team?team=${game.awayId}">${game.awayTeam}<span class="betting-line">${awayLine ? '-' + awayLine : ''}</span></a>`;

                            homeUser = oppName;
                            homeTeam = `<a href="/team?team=${game.homeId}">${game.homeTeam}<span class="betting-line">${homeLine ? '-' + homeLine : ''}</span></a>`;
                            isAway = true;

                            if (doesExist) {
                                isHeadToHead = true;
                            }
                        } else {
                            var existObject = exists(otherUsers, game.awayId);
                            var doesExist = existObject.doesExist;
                            oppName = existObject.name;

                            awayUser = oppName;
                            awayTeam = `<a href="/team?team=${game.awayId}">${game.awayTeam}<span class="betting-line">${awayLine ? '-' + awayLine : ''}</span></a>`;

                            homeUser = userData.firstName;
                            homeTeam = `<a href="/team?team=${game.homeId}">${game.homeTeam}<span class="betting-line">${homeLine ? '-' + homeLine : ''}</span></a>`;

                            if (doesExist) {
                                isHeadToHead = true;
                            }
                        }
        
                        if (game.completed) {
                            if( game.awayPoints > game.homePoints ) {
                                if(game.awayId == userData.seasons.at(-1).teams[iterNum].id) {
                                    shouldReplace = true;
                                    scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
                                }
                                topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                                bottomData = (game.homePoints || '-');
                            } else {

                                if(game.homeId == userData.seasons.at(-1).teams[iterNum].id) {
                                    shouldReplace = true;
                                    scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.homeId, game.id) + '<strong>';
                                }

                                topData = (game.awayPoints || '-');
                                bottomData = (game.homePoints || '-')+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                            }
                        }
                        
                        var teamLogos = await parseTeamLogos(game, allTeamLogos);
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
                        teamTable += `</tr><tr><td class="game-notes">`;
                        teamTable += game.notes || '';
                        teamTable += '</td></tr><tbody></table></td>';
            
                        var gameInfo = {
                            id: game.id,
                            table: teamTable,
                            homeTeam: game.homeTeam,
                            awayTeam: game.awayTeam,
                            startDate: game.startDate || ''
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

    gameTables.sort((a, b) => {
        return new Date(a.startDate) - new Date(b.startDate);
    });

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
    const scheduleFinish = new Date();
    console.log("Time To Render", scheduleFinish - scheduleStart)
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
    document.querySelector('.football-loader').style.display = "flex";
    document.querySelector('.schedule-table').style.display = "none";
    displaySchedule(usersData);
});

setTimeout(() => {
    $("[league-selector] a").click(function(){
        $(this).parents(".dropdown").find('.btn').html($(this).text());
        $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
        var selectedLeague = $("#dropdownMenuButton").text();
        var selectedLeagueCode = $("#dropdownMenuButton").val();
        window.sessionStorage.setItem("league", selectedLeague);
        window.localStorage.setItem("leagueCode", selectedLeagueCode);
        window.location.reload();
    });
}, "200");


const noGamesMessages = [
  `
    <div class="no-matchups-message trash-talk">
        <div class="emoji wiggle">🧢</div>
        <h3>Trash Talk Saturday Canceled</h3>
        <p>No head-to-heads this week. The group chat is unusually calm.</p>
        <p class="suggestion">Use this time to cook up excuses for next week.</p>
    </div>
  `,
  `
    <div class="no-matchups-message no-smoke">
        <div class="emoji fade-pulse">🫥</div>
        <h3>Nobody Wanted the Smoke</h3>
        <p>No matchups on the board. Everyone’s ducking this week.</p>
        <p class="suggestion">Feel free to flex your record anyway.</p>
    </div>
  `,
  `
    <div class="no-matchups-message gods-away">
        <div class="emoji blink">👀</div>
        <h3>The Matchup Gods Looked Away</h3>
        <p>No battles this week. It’s just punts and vibes.</p>
        <p class="suggestion">Enjoy the peace. Chaos returns soon.</p>
    </div>
  `,
  `
    <div class="no-matchups-message grudge-week">
        <div class="emoji spin">🧼</div>
        <h3>No Grudge Games This Time</h3>
        <p>Clean week. No friends will become enemies just yet.</p>
        <p class="suggestion">Talk your talk anyway — it's fantasy.</p>
    </div>
`
];

function showRandomNoGamesMessage() {
  const container = document.getElementById("no-games-container");
  const randomIndex = Math.floor(Math.random() * noGamesMessages.length);
  container.innerHTML = noGamesMessages[randomIndex];
}

function setNavbarUserId(metaData, usersData) {
    var userId = userState.user_metadata.metadata.userId || null;

    if (userId == null) {
        if (!metaData || !metaData.email || !Array.isArray(usersData)) {
            return null;
        }

        const email = metaData.email.toLowerCase();
        const user = usersData.find(u => u.email && u.email.toLowerCase() == email);
        userId = user ? user._id : null;
    }

    window.localStorage.setItem("userId", userId);
    
    const toggleButton = document.querySelector('.toggle-button');
    const navbarLinks = document.querySelector('.navbar-links');
    const myLink = document.querySelector('[user-home]');

    if (toggleButton && navbarLinks && myLink) {
        myLink.href = `/userHome?user=${userId}`;
    } else {
        // Retry after 500ms if elements aren't in the DOM yet
        setTimeout(setNavbarUserId, 500);
    }
}