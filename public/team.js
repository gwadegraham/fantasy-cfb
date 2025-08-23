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

        // Only set leagueCode from metaData if it's not already stored
        if (!window.localStorage.getItem("leagueCode") && data?.user_metadata?.metadata?.league) {
            var newLeagueCode = (data.user_metadata.metadata.league == 'gg' ? 'graham-league' : 'claunts-league');
            window.localStorage.setItem("leagueCode", newLeagueCode);
        }

        const leagueCode = window.localStorage.getItem("leagueCode");

        if (leagueCode && (leagueCode != "undefined")) {
            const currentSelectedLeague = window.sessionStorage.getItem("league");
            if (currentSelectedLeague) {
                $("#dropdownMenuButton").text(currentSelectedLeague);
            }
        }
        
        var userRole = data.user_metadata.roles[0];
        if (userRole != "Admin") {
            document.querySelector('[admin-page]').remove();
            document.querySelector('[league-selector]').remove();
        }        
    });
}

window.onload = function() {
    function initNavbarToggle() {
        const toggleButton = document.querySelector('.toggle-button');
        const navbarLinks = document.querySelector('.navbar-links');

        if (toggleButton && navbarLinks) {
            toggleButton.addEventListener('click', () => {
                navbarLinks.classList.toggle('active');
            });
            console.log("✅ Navbar toggle initialized");
        } else {
            // Retry after 500ms if elements aren't in the DOM yet
            console.log("⏳ Navbar elements not found, retrying...");
            setTimeout(initNavbarToggle, 500);
        }
    }

    initNavbarToggle();

    getUserProfile();
    getTeam();
    getSchedule();
    setNavbarUserId();
};

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

async function getTeam() {
    const urlParams = new URLSearchParams(window.location.search);

    const response = await fetch(`/teams/info/${urlParams.get('team')}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    const teamData = data[0];
    const teamRecordInfo = await getRecord(teamData);
    const conferenceRecords = await getConferenceRecords(teamData);
    const allTeamLogos = await getTeamLogos(conferenceRecords);
    const recruiting = await getRecruitingRankings(teamData.school);

    renderConferenceStandings(conferenceRecords, teamData, allTeamLogos);
    renderTeamInfo(teamData, teamRecordInfo, recruiting);
}

async function getRecord(teamData) {
    var currentYear = new Date().getFullYear();
    // currentYear = 2024;

    const response = await fetch(`/records/${currentYear}/${teamData.school}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    return data[0];
}

async function getConferenceRecords(teamData) {
    var currentYear = new Date().getFullYear();
    // currentYear = 2024;

    const response = await fetch(`/records/${currentYear}/conference/${teamData.seasons.at(-1).conference}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    return data;
}

async function getSchedule() {
    const urlParams = new URLSearchParams(window.location.search);
    var seasonYear = new Date().getFullYear();
    // seasonYear = 2024;

    const response = await fetch(`/games/season/${seasonYear}/teamId/${urlParams.get('team')}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    response.json().then(async data => {
        var scheduleData = data;
        const allTeamLogos = await getTeamLogos(data);
        const allRankings = await getRankings(seasonYear);
        const allBettingLines = await getAllBettingLines();

        renderTeamScheduleInfo(scheduleData, allTeamLogos, allRankings, allBettingLines, seasonYear);
    });
}

async function getTeamLogos () {
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

async function getAllBettingLines () {
    var seasonYear = new Date().getFullYear();
    // seasonYear = 2024;

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
    }
}

// Render team info
function renderTeamInfo(team, record, recruiting) {
    const leagueCode = window.localStorage.getItem("leagueCode");
    const container = document.getElementById("team-container");
    var scoreCode = (leagueCode == 'gg') ? 'cumulativeScoreV1' : 'cumulativeScoreV2';
    var formatConference = team.seasons.at(-1).conference;
    var confLogo = getConferenceLogo(team.seasons.at(-1).conference);

    const html = `
        
        <div class="team-header">
            <img class="team-logo" src="${team.logos.at(-1)}" alt="${team.school}" />
            <div class="team-meta">
            <h2 class="team-name">${team.school} ${team.mascot}</h2>
            <p class="team-conf"><img class="conf-logo" src="${confLogo}" alt="${formatConference}" /> ${formatConference}</p>
            <a class="team-twitter" href="https://twitter.com/${team.twitter}" target="_blank">${team.twitter}</a>
            </div>
        </div>

        <hr class="divider" />

        <div class="team-details">
            <div>
                <h4>${team.seasons.at(-1).season} Record</h4>
                <p class="score">${record?.total.wins || 0}-${record?.total.losses || 0}    Overall</p>
                <p class="score">${record?.conferenceGames.wins || 0}-${record?.conferenceGames.losses || 0}    Conference</p>
            </div>
            <div>
                <h4>📈 Season Score</h4>
                <p class="score">${team.seasons.at(-1)[scoreCode] || 0} Points</p>
                <h4>Recruiting Rank</h4>
                <p class="score">#${recruiting.rank || 0}</p>
            </div>
            <div>
                <h4>🏟 Stadium</h4>
                <p>${team.location.name}</p>
                <p><small>${team.location.city}, ${team.location.state} — Capacity: ${team.location.capacity.toLocaleString()}</small></p>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

// Render schedule info
function renderTeamScheduleInfo(schedule, logos, rankings, bettingLines, year) {
    const container = document.getElementById("schedule-container");

    var html = `
        <div class="schedule-head">
            <h2><i class="fa-solid fa-calendar-days fa-rank-stand"></i>${year} Schedule</h2>
            <i class="fa-solid fa-caret-down drop"></i>
        </div>
        <div class="games-container">
    `;

    if (schedule != null && schedule.length > 0) {
        schedule.sort((a, b) => {
            return new Date(a.startDate) - new Date(b.startDate);
        });

        schedule.forEach(game => {
            var homePoints = '';
            var awayPoints = '';

            var bettingLineObj = bettingLines.find(bettingObj => bettingObj.homeTeam == game.homeTeam && bettingObj.awayTeam == game.awayTeam)?.lines;

            var awayLine = '';
            var homeLine = '';

            if(bettingLineObj?.length > 0 && bettingLineObj != null) {
                var bettingLine = (bettingLineObj?.find(line => line.provider == "DraftKings") ? bettingLineObj?.find(line => line.provider == "DraftKings") : bettingLineObj[0])?.formattedSpread.split("-");
                awayLine = (bettingLine[0]?.trim() == game.awayTeam) ? bettingLine.at(-1) :  '';
                homeLine = (bettingLine[0]?.trim() == game.homeTeam) ? bettingLine.at(-1) :  '';
            }

            var homeLogo = logos.find((team) => team.id == game.homeId)?.logos.at(-1);
            homeLogo = homeLogo ? `<img src="${homeLogo}" alt="${game.homeTeam}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            var awayLogo = logos.find((team) => team.id == game.awayId)?.logos.at(-1);
            awayLogo = awayLogo ? `<img src="${awayLogo}" alt="${game.awayTeam}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            var pollName = 'Playoff Committee Rankings';
            if (!rankings.find(r => r.week == game.week)?.polls?.find(p => p.poll == "Playoff Committee Rankings") && game.seasonType != "postseason" ) {
                pollName = "AP Top 25";
            }

            rankings.sort((a, b) => {
                return b.week - a.week;
            });
            
            var weekRankings;
            if (game.seasonType == 'regular') {
                weekRankings = rankings.find(r => r.week == game.week && r.season == year) ? rankings.find(r => r.week == game.week && r.season == year)?.polls?.find(p => p.poll == pollName)?.ranks : rankings[0]?.polls?.find(p => p.poll == pollName)?.ranks;
            } else {
                weekRankings = rankings.find(r => r.week == '16' && r.season == year)?.polls?.find(p => p.poll == pollName)?.ranks || {};
            }

            var homeRank = '';
            var awayRank = '';
            if (weekRankings.length > 0) {
                homeRank = weekRankings.find(w => w.school == game.homeTeam) ? `<span class="rank">${weekRankings.find(w => w.school == game.homeTeam)?.rank}</span>` : '';
                awayRank = weekRankings.find(w => w.school == game.awayTeam) ? `<span class="rank">${weekRankings.find(w => w.school == game.awayTeam)?.rank}</span>` : '';
            }
            

            if (game.completed) {
                homePoints = game.homePoints || '0';
                awayPoints = game.awayPoints || '0';
            }

            // Winner logic
            const homeIsWinner = game.completed && homePoints > awayPoints;
            const awayIsWinner = game.completed && awayPoints > homePoints;

            const awayTeamHTML = `
                ${awayIsWinner ? '<strong class="game-winner">' : ''}
               <a href="/team?team=${game.awayId}">${awayLogo}${awayRank}${game.awayTeam}</a>
                ${awayIsWinner ? '</strong>' : ''}
                </span><span class="betting-line">${awayLine ? '-' + awayLine : ''}</span><span class="team-score">
                ${awayIsWinner ? '<strong class="game-winner">' : ''}
                ${awayPoints ? awayPoints : ''}
                ${awayIsWinner ? '</strong>' : ''}
                </span>
            `;

            const homeTeamHTML = `
                ${homeIsWinner ? '<strong class="game-winner">' : ''}
               <a href="/team?team=${game.homeId}">${homeLogo}${homeRank}${game.homeTeam}</a>
                ${homeIsWinner ? '</strong>' : ''}
                </span><span class="betting-line">${homeLine ? '-' + homeLine : ''}</span><span class="team-score">
                ${homeIsWinner ? '<strong class="game-winner">' : ''}
                ${homePoints ? homePoints : ''}
                ${homeIsWinner ? '</strong>' : ''}
                </span>
            `;

            html += `
                <div class="game-row">
                    <div class="game-info">
                        <div class="team-row">
                            <span class="team-vs">${awayTeamHTML}
                        </div>
                        <div class="team-row">
                            <span class="team-vs">${homeTeamHTML}
                        </div>
                        <span class="game-date">${formatDate(game.startTimeTbd, game.startDate)}</span>
                        <span class="game-date">${game.neutralSite ? game.venue : ''}</span>
                        <span class="game-date">${game.notes ? game.notes : ''}</span>
                    </div>
                </div>
            `;
        });
    }
    
    html += '</div>';
    container.innerHTML = html;

    const scheduleButton = document.querySelector('#schedule-container .schedule-head');

    if (scheduleButton && document.querySelector('.drop').checkVisibility()) {
        //Listener to open/close schedule
        const toggle = document.querySelector('#schedule-container .schedule-head');
        const content = document.querySelector('.games-container');

        toggle.addEventListener('click', () => {
            content.classList.toggle('active');

            if (content.classList.contains('active')) {
                document.querySelector('#schedule-container .drop').classList.add('fa-caret-up');
                document.querySelector('#schedule-container .drop').classList.remove('fa-caret-down');
            } else {
                document.querySelector('#schedule-container .drop').classList.add('fa-caret-down');
                document.querySelector('#schedule-container .drop').classList.remove('fa-caret-up');
            }
        });
    }
}

async function renderConferenceStandings(data, teamData, logos) {
    // Filter for specified conference
    var standings = [];
    var conferenceTeams = await getConferenceTeams(teamData.seasons.at(-1).conference);
    conferenceTeams.sort((a,b) => {
        return a.school.toLowerCase().localeCompare(b.school.toLowerCase());
    });
    standings = conferenceTeams.map(team => ({
            ...team,
            team: team.school,
            teamId: team.id,
            conferenceGames: {
                games: 0,
                wins: 0,
                losses: 0,
                ties: 0,
            },
            total: {
                games: 0,
                wins: 0,
                losses: 0,
                ties: 0,
            }
        }));
    if (data.message?.startsWith("No conference records")){

    } else {

        // Create a map for quick lookup by teamId
        const dataMap = new Map(data.map(item => [item.teamId, item]));

        // Replace matching objects in standings
        const updatedStandings = standings.map(team => {
            return dataMap.get(team.teamId) || team; 
        });

        // Sort: conference wins → overall wins → overall losses
        updatedStandings.sort((a, b) => {
            if (b.conferenceGames.wins !== a.conferenceGames.wins) {
            return b.conferenceGames.wins - a.conferenceGames.wins;
            }
            if (b.total.wins !== a.total.wins) {
            return b.total.wins - a.total.wins;
            }
            return a.total.losses - b.total.losses;
        });
        console.log("updatedStandings", updatedStandings)

        standings = updatedStandings;
        // standings = data
        //     .sort((a, b) => {
        //         // Sort by conference wins DESC, then losses ASC, then total wins DESC
        //         if (b.conferenceGames.wins !== a.conferenceGames.wins) {
        //             return b.conferenceGames.wins - a.conferenceGames.wins;
        //         }
        //         if (a.conferenceGames.losses !== b.conferenceGames.losses) {
        //             return a.conferenceGames.losses - b.conferenceGames.losses;
        //         }
        //         return b.total.wins - a.total.wins;
        //     });
    }

    if (standings.length > 0 && teamData.conference != 'FBS Independents') {
        // Build table HTML
        let html = `
            <div class="standing-head">
                <h2><i class="fa-solid fa-ranking-star fa-rank-stand"></i>${data[0]?.conference || standings[0].seasons.at(-1).conference} Standings</h2>
                <i class="fa-solid fa-caret-down drop"></i>
            </div>
            <table class="standings-table">
                <thead>
                    <tr>
                        <th class="standingColumn">Rank</th>
                        <th class="standingColumn">Team</th>
                        <th class="standingColumn">Conf</th>
                        <th class="standingColumn">Overall</th>
                    </tr>
                </thead>
                <tbody>
        `;

        standings.forEach((team, index) => {
            var teamLogo = logos.find((logo) => logo.id == team.teamId)?.logos.at(-1);
            teamLogo = teamLogo ? `<img src="${teamLogo}" alt="${team.mascot}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            var rankHtml = index + 1;
            var teamHtml = teamLogo + ' ' + team.team;
            var confHtml = team.conferenceGames.wins + '-' + team.conferenceGames.losses;
            var ovrHtml = team.total.wins + '-' + team.total.losses;


            if (team.team == teamData.school) {
                rankHtml = `<strong class="boldTeam">${index + 1}</strong>`;
                teamHtml = `<strong class="boldTeam">${teamLogo} ${team.team}</strong>`;
                confHtml = `<strong class="boldTeam">${team.conferenceGames.wins} - ${team.conferenceGames.losses}</strong>`;
                ovrHtml = `<strong class="boldTeam">${team.total.wins} - ${team.total.losses}</strong>`;
            }

            html += `
                <tr>
                    <td class="standingColumn">${rankHtml}</td>
                    <td class="standingColumn"><a href="/team?team=${team.teamId}">${teamHtml}</a></td>
                    <td class="standingColumn">${confHtml}</td>
                    <td class="standingColumn">${ovrHtml}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        // Render to DOM
        const container = document.getElementById('conference-standings');
        if (container) {
            container.innerHTML = html;

            const standingsButton = document.querySelector('#conference-standings .standing-head');

            if (standingsButton) {
                //Listener to open/close standings
                const toggle = document.querySelector('#conference-standings .standing-head');
                const content = document.querySelector('.standings-table');

                toggle.addEventListener('click', () => {
                    content.classList.toggle('active');

                    if (content.classList.contains('active')) {
                        document.querySelector('#conference-standings .drop').classList.add('fa-caret-up');
                        document.querySelector('#conference-standings .drop').classList.remove('fa-caret-down');
                    } else {
                        document.querySelector('#conference-standings .drop').classList.add('fa-caret-down');
                        document.querySelector('#conference-standings .drop').classList.remove('fa-caret-up');
                    }
                });
            }
        } else {
            console.warn("Missing container with id 'conference-standings'");
        }
    } else {
        const container = document.getElementById('conference-standings');
        container.style.display = 'none';

        const scheduleContainer = document.getElementById('schedule-container');
        scheduleContainer.style.width = '100%';
    } 
}

function getConferenceLogo(conference) {
    var allLogos = [
        {
            confName: "ACC",
            url: "https://dbukjj6eu5tsf.cloudfront.net/sidearm.sites/acc.sidearmsports.com/images/responsive_2024/footer_logo_acc-white.svg"
        },
        {
            confName: "American Athletic",
            url: "https://content.sportslogos.net/logos/153/5032/full/american_athletic_conference_logo_primary_20178032.png"
        },
        {
            confName: "Big 12",
            url: "https://content.sportslogos.net/logos/153/4662/full/big_12_conference_logo_alternate_20188833.png"
        },
        {
            confName: "Big Ten",
            url: "https://cdn.brandfetch.io/idzgo3Vrw2/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1712244113805"
        },
        {
            confName: "Conference USA",
            url: "../images/logo-cusa.png"
        },
        {
            confName: "FBS Independents",
            url: "https://content.sportslogos.net/logos/153/4756/full/589_division_i_fbs-independents-primary-.gif"
        },
        {
            confName: "Mid-American",
            url: "https://content.sportslogos.net/logos/153/4664/full/mid-american_conference_logo_primary_2008_sportslogosnet-6826.png"
        },
        {
            confName: "Mountain West",
            url: "https://content.sportslogos.net/logos/153/4665/full/mountain_west_conference_logo_primary_20111652.png"
        },
        {
            confName: "Pac-12",
            url: "https://content.sportslogos.net/logos/153/4666/full/pacific-12_conference_logo_primary_20117066.png"
        },
        {
            confName: "Sun Belt",
            url: "https://content.sportslogos.net/logos/153/4668/full/sun_belt_conference_logo_primary_20207257.png"
        },
        {
            confName: "SEC",
            url: "https://content.sportslogos.net/logos/153/4667/full/southeastern_conference_logo_primary_2018_sportslogosnet-5123.png"
        }
    ]

    const logoObj = allLogos.find(logo => logo.confName == conference);
    return logoObj.url;
}

async function getRankings (season) {
    var response = await fetch(`/rankings/${season}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var rankings = await response.json();

    if (rankings.length < 0) {
        console.log(rankings.message);
    }

    return rankings;
}

async function getConferenceTeams (conference) {
    var response = await fetch(`/teams/conference/${conference}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var conferences = await response.json();

    if (conferences.length < 0) {
        console.log(conferences.message);
    }

    return conferences;
}

async function getRecruitingRankings(team) {
    var seasonYear = new Date().getFullYear();
    // seasonYear = 2024;

    var response = await fetch(`/recruiting/${seasonYear}/${team}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var recruitingRankings = await response.json();

    return recruitingRankings[0];
}

// Helper: Format the date to readable format
function formatDate(isTbd, dateStr) {
  const date = new Date(dateStr);

  if (isTbd) {
    var formatDate = date.toLocaleString(undefined, {
        month: 'numeric',
        day: 'numeric',         // "30"
    });

    return formatDate + " TBD";
  } else {
    return date.toLocaleString(undefined, {
        month: 'numeric',
        day: 'numeric',         // "30"
        hour: 'numeric',        // "1"
        minute: '2-digit',      // "00"
        hour12: true            // AM/PM
    });
  }
}

function setNavbarUserId() {
    const userId = window.localStorage.getItem("userId");

    const myLink = document.querySelector('[user-home]');
    myLink.href = `/userHome?user=${userId}`;
}