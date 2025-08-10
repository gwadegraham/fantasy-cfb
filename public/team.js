const toggleButton = document.getElementsByClassName('toggle-button')[0];
const navbarLinks = document.getElementsByClassName('navbar-links')[0];
var leagueCode;

toggleButton.addEventListener('click', () => {
    navbarLinks.classList.toggle('active');
});

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
    });
}

window.onload = function() {
    getUserProfile();
    getTeam();
    getSchedule();
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

    renderConferenceStandings(conferenceRecords, teamData, allTeamLogos);
    renderTeamInfo(teamData, teamRecordInfo);
}

async function getRecord(teamData) {
    var currentYear = new Date().getFullYear();
    currentYear = 2024;

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
    currentYear = 2024;

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
    seasonYear = 2024;

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
        renderTeamScheduleInfo(scheduleData, allTeamLogos, seasonYear);
    });
}

async function getTeamLogos (games) {

    var allTeamIds = [];
    games.forEach(game => {
        if (game.homeId) {
            if (allTeamIds.indexOf(game.homeId) < 0) {
                allTeamIds.push(game.homeId);
            }

            if (allTeamIds.indexOf(game.awayId) < 0) {
                allTeamIds.push(game.awayId);
            }
        } else {
            if (allTeamIds.indexOf(game.teamId) < 0) {
                allTeamIds.push(game.teamId);
            }
        }
    });

    const teamsJson = {
        teams: allTeamIds
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
        return response;
    } else {
        console.log(response.message);
    }
}

// Render team info
function renderTeamInfo(team, record) {
  const container = document.getElementById("team-container");
  var scoreCode = (leagueCode == 'gg') ? 'cumulativeScoreV1' : 'cumulativeScoreV2';
  var formatConference = team.seasons.at(-2).conference;
  var confLogo = getConferenceLogo(team.seasons.at(-2).conference);

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
            <h4>${team.seasons.at(-2).season} Record</h4>
            <p class="score">${record.total.wins}-${record.total.losses}    Overall</p>
            <p class="score">${record.conferenceGames.wins}-${record.conferenceGames.losses}    Conference</p>
        </div>
        <div>
            <h4>📈 ${team.seasons.at(-2).season} Season Score</h4>
            <p class="score">${team.seasons.at(-2)[scoreCode] || 0} Points</p>
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
function renderTeamScheduleInfo(schedule, logos, year) {
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

            var homeLogo = logos.find((team) => team.id == game.homeId)?.logos.at(-1);
            homeLogo = homeLogo ? `<img src="${homeLogo}" alt="${game.homeTeam}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            var awayLogo = logos.find((team) => team.id == game.awayId)?.logos.at(-1);
            awayLogo = awayLogo ? `<img src="${awayLogo}" alt="${game.awayTeam}">` : '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';

            if (game.completed) {
                homePoints = game.homePoints || '0';
                awayPoints = game.awayPoints || '0';
            }

            html += `
                <div class="game-row">
                    <div class="game-info">
                        <div class="team-row">
                            <span class="team-vs"><a href="/team?team=${game.awayId}">${awayLogo}
                            ${game.awayTeam}</a></span>
                            <span class="team-score">${awayPoints ? awayPoints : ''}</span>
                        </div>
                        <div class="team-row">
                            <span class="team-vs"><a href="/team?team=${game.homeId}">${homeLogo}
                            ${game.neutralSite ? game.homeTeam : '@ ' + game.homeTeam}</a></span>
                            <span class="team-score">${homePoints ? homePoints : ''}</span>
                        </div>
                        <span class="game-date">${formatDate(game.startDate)}</span>
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

function renderConferenceStandings(data, teamData, logos) {
    // Filter for specified conference
    const standings = data
        .sort((a, b) => {
            // Sort by conference wins DESC, then losses ASC, then total wins DESC
            if (b.conferenceGames.wins !== a.conferenceGames.wins) {
                return b.conferenceGames.wins - a.conferenceGames.wins;
            }
            if (a.conferenceGames.losses !== b.conferenceGames.losses) {
                return a.conferenceGames.losses - b.conferenceGames.losses;
            }
            return b.total.wins - a.total.wins;
        });

    if (standings.length > 0 && teamData.conference != 'FBS Independents') {
        // Build table HTML
        let html = `
            <div class="standing-head">
                <h2><i class="fa-solid fa-ranking-star fa-rank-stand"></i>${data[0].conference} Standings</h2>
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

// Helper: Format the date to readable format
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    day: 'numeric',         // "30"
    hour: 'numeric',        // "1"
    minute: '2-digit',      // "00"
    hour12: true            // AM/PM
  });
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