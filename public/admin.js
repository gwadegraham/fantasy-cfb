const userList = document.querySelector('[user-list-container]');
const teamOptionList = document.querySelectorAll('[team-options]');
const calculateTeamOption = document.querySelector('[calculate-team-options]');
const userOptionList = document.querySelectorAll('[user-options]');
const seasonOptionList = document.querySelectorAll('[season-options]');
const seasonTypeOptionList = document.querySelectorAll('[season-type-options]');
const weekOptionList = document.querySelectorAll('[week-options]');

var leagueCode;
var isMobile;
var userMetadata;
var teamList = [];
var userListSelect = [];

function detectMobile() {
    if(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent)){
        // true for mobile device
        isMobile = true;
    } else{
        // false for not mobile device
        isMobile = false;
    }
}

var successToast = Toastify({
    text: "",
    duration: 4000,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "left", // `left`, `center` or `right`
    stopOnFocus: true, // Prevents dismissing of toast on hover
    style: {
      background: "#71d28d",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});

var failToast = Toastify({
    text: "",
    duration: 3000,
    close: true,
    gravity: "top", // `top` or `bottom`
    position: "left", // `left`, `center` or `right`
    stopOnFocus: true, // Prevents dismissing of toast on hover
    style: {
      background: "#d27171",
      color: "#222"
    },
    offset: {
        y: '40px' // vertical axis - can be a number or a string indicating unity. eg: '2em'
    },
});

async function getTeams() {
    fetch("/teams", {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    }).then(res => res.json()).then(data => {
        setTeamOptions(data);
    });
}

function multiplyNode(node, count, deep) {
    for (var i = 0, copy; i < count - 1; i++) {
        copy = node.cloneNode(deep);
        node.parentNode.insertBefore(copy, node);
    }
}

function setTeamOptions(data) {
    teamList = data;
    var str = '<option value="" disabled selected>Select A Team</option>';

    data.sort((a, b) => {
        return a.school.localeCompare(b.school)
    });

    data.forEach( team => {
        str += '<option value="';
        str += team.id;
        str += '">' + team.school;
        str += '</option>';
    });

    teamOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
    calculateTeamOption.innerHTML = str;

    multiplyNode(document.querySelector('.team-container'), 10, true);
}

function setSeasonOptions() {
    var currentYear = new Date().getFullYear();
    var years = [];

    for (let year = currentYear; year >= 2000; year--) {
        years.push(year);
    }

    var str = '<option value="" disabled selected>Season</option>';

    years.forEach( year => {
        str += '<option value="';
        str += year;
        str += '">' + year;
        str += '</option>';
    });

    seasonOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

function setSeasonTypeOptions() {
    var seasonTypes = ["Regular", "Postseason"];

    var str = '<option value="" disabled selected>Season Type</option>';

    seasonTypes.forEach( type => {
        str += '<option value="';
        str += type;
        str += '">' + type;
        str += '</option>';
    });

    seasonTypeOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

function setWeekOptions() {
    var weeks = [];

    for (let week = 1; week <=15; week++) {
        weeks.push(week);
    }

    var str = '<option value="" disabled selected>Week</option>';

    weeks.forEach( week => {
        str += '<option value="';
        str += week;
        str += '">' + week;
        str += '</option>';
    });

    weekOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

function setUserOptions(data) {
    userListSelect = data;
    var str = '<option value="" disabled selected>Select A Player</option>';

    data.forEach( user => {
        str += '<option value="';
        str += user._id;
        str += '">' + user.firstName + ' ' + user.lastName;
        str += '</option>';
    });

    userOptionList.forEach(selector => {
        selector.innerHTML = str;
    });
}

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

    response.json().then(data => {
        displayUsers(data);
        setUserOptions(data);
    });
}

function displayUsers(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    var str = '';

    data.forEach( user => {
        var userSeason = user.seasons[0];
        str += '<tr>';
        str += `<th class="sticky-header"><a href="/userHome?user=${user._id}">` + user.firstName + ' ' + user.lastName.substring(0,1) + '.</a></th>';
        str += '<td class="team-item">';
        
        for (var i = 0; i < user.seasons[0].teams.length; i++) {
            var team = userSeason.teams[i];
            var refLink = `/team?team=${team.id}`;

            str += '<div>';
            str += '<a href="' + refLink + '"><img src="' + team.logos.at(-1) + '" alt="' + team.mascot + '">'
            str += '</div></a>';
        }
        str += '</td></tr>';
    });

    userTableBody.innerHTML = str;
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
        userMetadata = data;

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
}

// Read-only "current state" strip: shows how far scoring/games have progressed
// and, when completed results are still unscored, flags it and points at the
// Update Scores tool. All derived server-side from existing data.
async function loadAdminStatus() {
    var el = document.querySelector('[admin-status]');
    if (!el) return;
    var year = window.APP_YEAR || new Date().getFullYear();
    try {
        var res = await fetch(`/scores/status/${year}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        var s = await res.json();
        var api = null;
        try {
            var apiRes = await fetch('/games/info', { headers: { 'Accept': 'application/json' } });
            if (apiRes.ok) { var a = await apiRes.json(); api = a && a.remainingCalls; }
        } catch (e) { /* API count is optional */ }
        var jobs = [];
        try {
            var jobsRes = await fetch('/job-runs', { headers: { 'Accept': 'application/json' } });
            if (jobsRes.ok) { jobs = await jobsRes.json(); }
        } catch (e) { /* job history is optional */ }
        renderAdminStatus(el, s, api, year, jobs);
    } catch (e) { /* leave the strip hidden on error */ }
}

// Human-friendly "how long ago" for a timestamp.
function timeAgo(iso) {
    if (!iso) return '';
    var diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return '';
    var mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
}

var JOB_LABELS = {
    'daily-scores': 'Daily', 'saturday-scores': 'Saturday', 'sunday-scores': 'Sunday'
};

function renderAdminStatus(el, s, api, year, jobs) {
    var behind = !s.upToDate;
    var items = [
        ['Scored through', (s.scoredThroughWeek ? 'Week ' + s.scoredThroughWeek : '—'), behind ? 'a' : 'g'],
        ['Games loaded', (s.gamesLoadedThroughWeek ? 'Week ' + s.gamesLoadedThroughWeek : '—'), 'g']
    ];
    if (api != null) items.push(['CFBD calls left', Number(api).toLocaleString(), null]);

    var rows = items.map(function (it) {
        var dot = it[2] ? '<span class="dot ' + it[2] + '"></span>' : '';
        return '<div class="ss-item"><small>' + it[0] + '</small><b>' + dot + it[1] + '</b></div>';
    }).join('');

    var note = behind
        ? '<i class="fa-solid fa-bolt"></i><span>' + s.unscoredResults + ' completed result' + (s.unscoredResults === 1 ? '' : 's') +
          ' not scored yet. <a data-fix-scores>Force update scores</a></span>'
        : '<i class="fa-solid fa-bolt"></i><span>Everything’s current through Week ' + (s.scoredThroughWeek || 0) +
          '. Automation is keeping scores up to date — nothing to do here.</span>';

    // Automated-job last-run summary (green success, red error, amber running).
    var jobsBlock = '';
    if (jobs && jobs.length) {
        var order = ['daily-scores', 'saturday-scores', 'sunday-scores'];
        var sorted = jobs.slice().sort(function (a, b) { return order.indexOf(a.jobName) - order.indexOf(b.jobName); });
        var jobItems = sorted.map(function (j) {
            var dot = j.status === 'success' ? 'g' : (j.status === 'error' ? 'r' : 'a');
            var label = JOB_LABELS[j.jobName] || j.jobName;
            var when = timeAgo(j.finishedAt || j.startedAt);
            var outcome = j.status === 'error' ? 'failed' : (j.status === 'running' ? 'running' : 'ran');
            return '<div class="ss-job"><span class="dot ' + dot + '"></span><b>' + label + '</b>' +
                '<span class="ss-job-meta">' + outcome + (when ? ' · ' + when : '') + '</span></div>';
        }).join('');
        jobsBlock = '<div class="ss-jobs"><small>Automated jobs</small><div class="ss-jobs-row">' + jobItems + '</div></div>';
    }

    el.className = 'admin-status ' + (behind ? 'warn' : 'ok');
    el.innerHTML = '<div class="ss-head"><i class="fa-solid fa-circle-info"></i> Current state · ' + year + ' season</div>' +
        '<div class="ss-row">' + rows + '</div>' +
        '<div class="ss-note">' + note + '</div>' +
        jobsBlock;
    el.hidden = false;

    var tool = document.querySelector('[scores-tool]');
    if (tool) tool.classList.toggle('attn', behind);

    var fix = el.querySelector('[data-fix-scores]');
    if (fix) fix.addEventListener('click', function () {
        var c = document.querySelector('[scores-container]');
        if (c && c.style.display === 'none') displayScoresContainer();
        if (tool) tool.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}

window.onload = async function() {
    // Hamburger toggle is owned by the navbar partial (views/partials/navbar.ejs).
    detectMobile();
    getUserProfile();
    getTeams();
    setSeasonOptions();
    setSeasonTypeOptions();
    setWeekOptions();
    loadAdminStatus();
};

const createForm = document.getElementById('create-form')

if (createForm) {
    createForm.addEventListener('submit', async function(event) {
        event.preventDefault();
    
        const firstName = document.querySelector('[first-name]').value;
        const lastName = document.querySelector('[last-name]').value;
        const displayColor = document.querySelector('[display-color]').value;
        const teams = [];
        const teamDocuments = [];
        document.querySelectorAll('[team-options]').forEach(
            team => {
                teams.push(team.value);
                var temp = teamList.find((element) => element.id == team.value);
                teamDocuments.push(temp);
            }
        );

        var userBody = {
            firstName: firstName,
            lastName: lastName,
            color: displayColor,
            seasons: [
                {
                    season: new Date().getFullYear()
                }
            ],
            league: leagueCode
        };

        if (teamDocuments[0] != null) {
            userBody.seasons[0].teams = JSON.stringify(teamDocuments);
        }
    
        const response = await fetch("/users", {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: JSON.stringify(userBody),
        });
    
       

        response.json().then(data => {
            if (response.status == 201) {
                createForm.reset();
                getUsers();
                displayCreateUserContainer();

                successToast.options.text = "User created successfully";
                successToast.showToast();
            } else {
                failToast.options.text = response.status + " User could not be created";
                failToast.showToast();
            }
        });
    });
}

const removeForm = document.getElementById('remove-form');

if (removeForm) {
    removeForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const userId = document.querySelector('[user-options]').value;
    
        const response = await fetch("/users/" + userId, {
            method: 'DELETE',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        response.json().then(data => {
            if (data.message == 'Deleted User') {
                removeForm.reset();
                getUsers();
                displayRemoveUserContainer();

                successToast.options.text = "User successfully deleted"
                successToast.showToast();
            } else {
                failToast.options.text = response.status + " User could not be deleted";
                failToast.showToast();
            }

        });
    });
}

const calculateForm = document.getElementById('score-form')

if (calculateForm) {
    calculateForm.addEventListener('submit', async function(event) {
        event.preventDefault();
    
        const teamId = document.querySelector('[calculate-team-options]').value;
        const season = document.querySelector('[team-score-season]').value;
        var teamName = "";

        var teamPromise = await fetch(`/teams/${teamId}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });

        var teamResponse = await teamPromise;
        var response = await teamResponse.json();

        if (teamResponse.status == 200) {
            teamName = response[0].school;
        } else {
            console.log(response.message);
        }        

        var response = await fetch(`/calculate-team-score/${season}/${teamId}/${teamName}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });

        response.json().then(data => {
            if (response.status == 200) {
                console.log(data);
                successToast.options.text = "Score successfully calculated for " + data.school;
                successToast.showToast();
            } else {
                failToast.options.text = response.status + " Team score could not be calculated";
                failToast.showToast();
            }
        });
    });
}

const calculateAllForm = document.getElementById('all-score-form')
if (calculateAllForm) {
    calculateAllForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const season = document.querySelector('[team-score-season]').value;

        await fetch('/teams', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        }).then(res => res.json()).then(data => {
            console.log("Number of teams: " + data.length)
            data.forEach(async (team) => {
                var response = await fetch(`/calculate-team-score/${season}/${team.id}/${team.school}`, {
                    method: 'GET',
                    headers: {
                    'Accept': 'application/json'
                    }
                });

                response.json().then(data => {
                    if (response.status == 200) {
                        console.log(data);
                        successToast.options.text = "Score successfully calculated for " + data.school;
                        successToast.showToast();
                    } else {
                        failToast.options.text = response.status + " Team score could not be calculated";
                        failToast.showToast();
                    }
                });
            })
        });
    });
}

const rankingsForm = document.getElementById('rankings-form');

if (rankingsForm) {
    rankingsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const season = document.querySelector('[rankings-season]').value;
        const seasonType = document.querySelector('[season-type-options]').value.toLowerCase();
        const week = document.querySelector('[week-options]').value;

        var response = await fetch(`/rankings/${season}/${week}/${seasonType}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        var rankings = await response;

        if (rankings.status == 200) {
            successToast.options.text = `Rankings already in system for Season: ${season}, Season Type: ${seasonType}, Week: ${week}`;
            successToast.showToast();
        } else {
            const response = await fetch("/rankings/retrieveRankings", {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: `{
                "season": "${season}",
                "seasonType": "${seasonType}",
                "week": "${week}"
                }`,
            });

            response.json().then(data => {
                if (response.status == 201) {
                    console.log("New Rankings", data);
                    successToast.options.text = `New rankings retrieved for Season: ${season}, Season Type: ${seasonType}, Week: ${week}`;
                    successToast.showToast();
                } else {
                    failToast.options.text = response.status + " Rankings could not be retrieved";
                    failToast.showToast();
                }
            });
        }
    });
}

const recruitRankingsForm = document.getElementById('recruit-rankings-form');

if (recruitRankingsForm) {
    recruitRankingsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[recruiting-season]').value;

        var response = await fetch(`/recruiting/${season}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
    
        var recruitingRankings = await response;

        if (recruitingRankings.status == 200) {
            successToast.options.text = `Recruiting Rankings already in system for Season: ${season}`;
            successToast.showToast();
        } else {
            const response = await fetch(`/recruiting/new/${season}`, {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: `{
                "season": "${season}"
                }`,
            });

            response.json().then(data => {
                if (response.status == 201) {
                    console.log("New Recruiting Rankings", data);
                    successToast.options.text = `New recruiting rankings retrieved for Season: ${season}`;
                    successToast.showToast();
                    unblock_screen();
                } else {
                    failToast.options.text = response.status + " Recruiting Rankings could not be retrieved";
                    failToast.showToast();
                }
            });
        }
    });
}

const teamRecordsForm = document.getElementById('team-records-form');

if (teamRecordsForm) {
    teamRecordsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[record-season]').value;

        const response = await fetch(`/records/new/${season}`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Team Records", data);
                successToast.options.text = `New team records retrieved for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Team Records could not be retrieved";
                failToast.showToast();
            }
        });
    });
}

const refreshTeamsForm = document.getElementById('refresh-teams-form');

if (refreshTeamsForm) {
    refreshTeamsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[refresh-season]').value;

        const response = await fetch(`/teams/refresh`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "year": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("Refreshed Teams", data);
                successToast.options.text = `Teams refreshed for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Teams could not be refreshed";
                failToast.showToast();
            }
        });
    });
}

const enrichmentForm = document.getElementById('enrichment-form');

if (enrichmentForm) {
    enrichmentForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[enrichment-season]').value;
        const opts = { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' } };

        try {
            // Team ratings/talent/returning/coaches, then game broadcasts.
            const teamsRes = await fetch(`/teams/${season}/enrich`, opts);
            const teamsData = await teamsRes.json();
            const mediaRes = await fetch(`/games/${season}/media`, opts);
            const mediaData = await mediaRes.json();

            unblock_screen();

            if (teamsRes.status == 200) {
                successToast.options.text = `Enriched ${teamsData.updated} teams + ${mediaData.updated || 0} games for ${season}`;
                successToast.showToast();
            } else {
                failToast.options.text = (teamsData && teamsData.message) || `${teamsRes.status} Enrichment failed`;
                failToast.showToast();
            }
        } catch (err) {
            unblock_screen();
            failToast.options.text = 'Enrichment failed: ' + err.message;
            failToast.showToast();
        }
    });
}

const gamesForm = document.getElementById('games-form');

if (gamesForm) {
    gamesForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        
        block_screen();

        const week = document.querySelector('[game-week]').value;
        const seasonType = document.querySelector('[game-season-type]').value.toLowerCase();

        const response = await fetch(`/games/week/mass-create`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "week": "${week}",
            "seasonType": "${seasonType}"
            }`
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Games Successfully Saved");
                successToast.options.text = `Games retrieved for  Week: ${week}, Season Type: ${seasonType}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + "| Games could not be retrieved";
                failToast.showToast();            }
        });
    });
}

const scoresForm = document.getElementById('scores-form');

if (scoresForm) {
    scoresForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        
        block_screen();

        const week = document.querySelector('[score-week]').value;
        const seasonType = document.querySelector('[score-season-type]').value.toLowerCase();

        const response = await fetch(`/scores/update`, {
            method: 'POST',
            signal: AbortSignal.timeout(100000),
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "seasonType": "${seasonType}",
            "week": "${week}"
            }`
        });

        response.json().then(data => {
            if (response.status == 200) {
                console.log("Scores Successfully Updated");
                successToast.options.text = `Scores updated for Season Type: ${seasonType}, Week: ${week}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + "| Scores could not be updated";
                failToast.showToast();            }
        });
    });
}

const bettingLinesForm = document.getElementById('betting-lines-form');

if (bettingLinesForm) {
    bettingLinesForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[betting-season]').value;

        const response = await fetch(`/betting/new/${season}`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Betting Records", data);
                successToast.options.text = `New betting records retrieved for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Betting Records could not be retrieved";
                failToast.showToast();
            }
        });
    });
}

const expectedWinsForm = document.getElementById('expected-wins-form');

if (expectedWinsForm) {
    expectedWinsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const season = document.querySelector('[expected-wins-season]').value;

        const response = await fetch(`/teams/${season}/expectedWins`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}"
            }`,
        });

        response.json().then(data => {
            if (response.status == 200) {
                console.log("Updated team records", data);
                successToast.options.text = `Team expected wins updated for Season: ${season}`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " Team expected wins could not be updated";
                failToast.showToast();
            }
        });
    });
}

const apiCallsForm = document.getElementById('api-calls-form');

if (apiCallsForm) {
    apiCallsForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        block_screen();

        const response = await fetch(`/games/info`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        response.json().then(data => {
            if (response.status == 200) {
                var remainingCalls = data.remainingCalls;
                document.querySelector('[api-calls-remaining]').innerHTML = remainingCalls;
                successToast.options.text = `api calls`;
                successToast.showToast();
                unblock_screen();
            } else {
                failToast.options.text = response.status + " API calls remaining could not be retrieved";
                failToast.showToast();
            }
        });
    });
}

function displayCreateUserContainer() {
    var createUserContainer = document.querySelector('[create-user-container]');

    if (createUserContainer.style.display == 'flex' || createUserContainer.style.display=='') {
        createUserContainer.style.display = 'none';
    } else {
        createUserContainer.style.display = 'flex';
    }
}

function displayRemoveUserContainer() {
    var removeUserContainer = document.querySelector('[remove-user-container]');

    if (removeUserContainer.style.display == 'flex' || removeUserContainer.style.display=='') {
        removeUserContainer.style.display = 'none';
    } else {
        removeUserContainer.style.display = 'flex';
    }
}

function displayTeamContainer() {
    var teamScoreContainer = document.querySelector('[calculate-team-score-container]');

    if (teamScoreContainer.style.display == 'flex' || teamScoreContainer.style.display=='') {
        teamScoreContainer.style.display = 'none';
    } else {
        teamScoreContainer.style.display = 'flex';
    }
}

function displayRankingsContainer() {
    var rankingsContainer = document.querySelector('[rankings-container]');

    if (rankingsContainer.style.display == 'flex' || rankingsContainer.style.display=='') {
        rankingsContainer.style.display = 'none';
    } else {
        rankingsContainer.style.display = 'flex';
    }
}

function displayRecruitRankingsContainer() {
    var recruitRankingsContainer = document.querySelector('[recruit-rankings-container]');

    if (recruitRankingsContainer.style.display == 'flex' || recruitRankingsContainer.style.display=='') {
        recruitRankingsContainer.style.display = 'none';
    } else {
        recruitRankingsContainer.style.display = 'flex';
    }
}

function displayTeamRecordsContainer() {
    var teamRecordsContainer = document.querySelector('[team-records-container]');

    if (teamRecordsContainer.style.display == 'flex' || teamRecordsContainer.style.display=='') {
        teamRecordsContainer.style.display = 'none';
    } else {
        teamRecordsContainer.style.display = 'flex';
    }
}

function displayRefreshTeamsContainer() {
    var refreshTeamsContainer = document.querySelector('[refresh-teams-container]');

    if (refreshTeamsContainer.style.display == 'flex' || refreshTeamsContainer.style.display=='') {
        refreshTeamsContainer.style.display = 'none';
    } else {
        refreshTeamsContainer.style.display = 'flex';
    }
}

function displayGamesContainer() {
    var gamesContainer = document.querySelector('[games-container]');

    if (gamesContainer.style.display == 'flex' || gamesContainer.style.display=='') {
        gamesContainer.style.display = 'none';
    } else {
        gamesContainer.style.display = 'flex';
    }
}

function displayScoresContainer() {
    var scoresContainer = document.querySelector('[scores-container]');

    if (scoresContainer.style.display == 'flex' || scoresContainer.style.display=='') {
        scoresContainer.style.display = 'none';
    } else {
        scoresContainer.style.display = 'flex';
    }
}

function displayBettingLinesContainer() {
    var bettingContainer = document.querySelector('[betting-lines-container]');

    if (bettingContainer.style.display == 'flex' || bettingContainer.style.display=='') {
        bettingContainer.style.display = 'none';
    } else {
        bettingContainer.style.display = 'flex';
    }
}

function displayExpectedWinsContainer() {
    var expectedWinsContainer = document.querySelector('[expected-wins-container]');

    if (expectedWinsContainer.style.display == 'flex' || expectedWinsContainer.style.display=='') {
        expectedWinsContainer.style.display = 'none';
    } else {
        expectedWinsContainer.style.display = 'flex';
    }
}

function displayEnrichmentContainer() {
    var enrichmentContainer = document.querySelector('[enrichment-container]');

    if (enrichmentContainer.style.display == 'flex' || enrichmentContainer.style.display=='') {
        enrichmentContainer.style.display = 'none';
    } else {
        enrichmentContainer.style.display = 'flex';
    }
}

function displayApiCallsContainer() {
    var apiCallsContainer = document.querySelector('[api-calls-container]');

    if (apiCallsContainer.style.display == 'flex' || apiCallsContainer.style.display=='') {
        apiCallsContainer.style.display = 'none';
    } else {
        apiCallsContainer.style.display = 'flex';
    }
}

function block_screen() {
    $('<div id="screenBlock"></div>').appendTo('body');
    $('#screenBlock').css( { opacity: 0, width: $(document).width(), height: $(document).height() } );
    $('#screenBlock').addClass('blockDiv');
    $('#screenBlock').animate({opacity: 0.7}, 200);
}

function unblock_screen() {
$('#screenBlock').animate({opacity: 0}, 200, function() {
    $('#screenBlock').remove();
});
}

if ($("[league-selector]")) {
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
}

// The navbar owns the "My team" link + userId caching (views/partials/navbar.ejs).

/////////////////////////////////////////////////////
//////////////////// Draft Config ///////////////////
/////////////////////////////////////////////////////

var draftMembers = [];    // member objects in current display order
var currentDraft = null;  // loaded Draft doc for the selected league+season

function getDraftLeagueCode() {
    var code = (userState.user_metadata.metadata.league == 'gg' ? 'graham-league' : 'claunts-league');
    if (userState.user_metadata.roles?.at(-1) == 'Admin') {
        var stored = window.localStorage.getItem("leagueCode");
        if (stored && stored != "undefined") code = stored;
    }
    return code;
}

function getSelectedDraftSeason() {
    return parseInt(document.querySelector('[draft-season]').value, 10);
}

function populateDraftSeasonOptions() {
    var sel = document.querySelector('[draft-season]');
    if (!sel) return;
    var currentYear = new Date().getFullYear();
    var str = '';
    for (var y = currentYear + 1; y >= currentYear - 3; y--) {
        str += `<option value="${y}">${y}</option>`;
    }
    sel.innerHTML = str;
    sel.value = currentYear;
}

async function displayDraftConfigContainer() {
    var container = document.querySelector('[draft-config-container]');
    if (container.style.display == 'flex' || container.style.display == '') {
        container.style.display = 'none';
    } else {
        container.style.display = 'flex';
        await loadDraftConfig();
    }
}

async function loadDraftConfig() {
    var leagueCode = getDraftLeagueCode();
    var season = getSelectedDraftSeason();

    // All league members (full seasons, so we can order by prior standings).
    var membersResp = await fetch(`/users/league/${leagueCode}/all`, { headers: { 'Accept': 'application/json' } });
    var members = await membersResp.json();

    // Existing draft config for this league+season (null if none yet).
    var draftResp = await fetch(`/draft/${leagueCode}/${season}`, { headers: { 'Accept': 'application/json' } });
    currentDraft = await draftResp.json();

    var byId = {};
    members.forEach(m => { byId[String(m._id)] = m; });

    var orderedIds = [];
    var participantIds = new Set();

    if (currentDraft && Array.isArray(currentDraft.draftOrder) && currentDraft.draftOrder.length) {
        orderedIds = currentDraft.draftOrder.map(String);
        orderedIds.forEach(id => participantIds.add(id));
    } else {
        // Default: everyone, ordered by reverse standings.
        members = sortByStandings(members, season);
        orderedIds = members.map(m => String(m._id));
        orderedIds.forEach(id => participantIds.add(id));
    }

    draftMembers = [];
    orderedIds.forEach(id => { if (byId[id]) draftMembers.push(byId[id]); });
    // Include any members not already in the saved order (e.g. newly added).
    members.forEach(m => {
        if (!orderedIds.includes(String(m._id))) {
            draftMembers.push(m);
            participantIds.add(String(m._id));
        }
    });

    renderDraftOrderList(participantIds);
    populateDraftFormFields();
}

function sortByStandings(members, season) {
    return members.slice().sort((a, b) => {
        var aScore = (a.seasons.find(s => s.season == (season - 1))?.cumulativeScore) ?? 100000;
        var bScore = (b.seasons.find(s => s.season == (season - 1))?.cumulativeScore) ?? 100000;
        return aScore - bScore; // worst record picks first
    });
}

function getCurrentParticipantIds() {
    var set = new Set();
    document.querySelectorAll('[draft-order-list] .draft-order-item').forEach(li => {
        var cb = li.querySelector('.draft-participant');
        if (cb && cb.checked) set.add(li.getAttribute('data-user-id'));
    });
    return set;
}

function renderDraftOrderList(participantIds) {
    var list = document.querySelector('[draft-order-list]');
    if (!list) return;
    var str = '';
    draftMembers.forEach(m => {
        var id = String(m._id);
        var checked = participantIds.has(id) ? 'checked' : '';
        str += `<li class="draft-order-item" data-user-id="${id}">
            <input type="checkbox" class="draft-participant" ${checked}>
            <span class="draft-order-name">${m.firstName} ${m.lastName}</span>
            <span class="draft-order-move">
              <button type="button" title="Move up" onclick="moveDraftMember('${id}', -1)">&#9650;</button>
              <button type="button" title="Move down" onclick="moveDraftMember('${id}', 1)">&#9660;</button>
            </span>
        </li>`;
    });
    list.innerHTML = str;
}

function moveDraftMember(id, dir) {
    var participants = getCurrentParticipantIds();
    var idx = draftMembers.findIndex(m => String(m._id) === id);
    var swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= draftMembers.length) return;
    var tmp = draftMembers[idx];
    draftMembers[idx] = draftMembers[swap];
    draftMembers[swap] = tmp;
    renderDraftOrderList(participants);
}

function autoOrderStandings() {
    var participants = getCurrentParticipantIds();
    draftMembers = sortByStandings(draftMembers, getSelectedDraftSeason());
    renderDraftOrderList(participants);
}

function randomizeOrder() {
    var participants = getCurrentParticipantIds();
    for (var i = draftMembers.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = draftMembers[i];
        draftMembers[i] = draftMembers[j];
        draftMembers[j] = t;
    }
    renderDraftOrderList(participants);
}

function isoToLocalInput(iso) {
    var d = new Date(iso);
    var pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(val) {
    if (!val) return null;
    return new Date(val).toISOString();
}

function populateDraftFormFields() {
    var status = currentDraft ? currentDraft.status : 'not configured';
    var statusEl = document.querySelector('[draft-status]');
    statusEl.textContent = status;
    statusEl.className = 'draft-status-badge status-' + status.replace(/\s/g, '-');

    document.querySelector('[draft-rounds]').value = (currentDraft && currentDraft.totalRounds) || 10;
    document.querySelector('[draft-type]').value = (currentDraft && currentDraft.snake === false) ? 'linear' : 'snake';
    document.querySelector('[draft-autoopen]').checked = (currentDraft && currentDraft.autoOpen) || false;
    document.querySelector('[draft-datetime]').value =
        (currentDraft && currentDraft.scheduledAt) ? isoToLocalInput(currentDraft.scheduledAt) : '';

    var resetBtn = document.querySelector('[draft-reset-btn]');
    resetBtn.style.display = (currentDraft && currentDraft._id) ? 'inline-block' : 'none';

    // Lock settings once the draft is live/finished (but keep season + reset usable).
    var locked = currentDraft && (currentDraft.status === 'active' || currentDraft.status === 'complete');
    document.querySelectorAll('#draft-config-form input, #draft-config-form select, #draft-config-form button')
        .forEach(el => { el.disabled = !!locked; });
    document.querySelector('[draft-season]').disabled = false;
    if (resetBtn) resetBtn.disabled = false;
}

async function resetDraft() {
    if (!currentDraft || !currentDraft._id) return;
    const response = await fetch(`/draft/${currentDraft._id}/reset`, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    });
    response.json().then(data => {
        if (response.status == 200) {
            currentDraft = data;
            populateDraftFormFields();
            successToast.options.text = "Draft reset";
            successToast.showToast();
        } else {
            failToast.options.text = "Draft could not be reset";
            failToast.showToast();
        }
    });
}

const draftConfigForm = document.getElementById('draft-config-form');
if (draftConfigForm) {
    draftConfigForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        var participants = getCurrentParticipantIds();
        var draftOrder = draftMembers.map(m => String(m._id)).filter(id => participants.has(id));

        if (draftOrder.length < 2) {
            failToast.options.text = "Select at least 2 participants for the draft";
            failToast.showToast();
            return;
        }

        var body = {
            league: getDraftLeagueCode(),
            season: getSelectedDraftSeason(),
            scheduledAt: localInputToIso(document.querySelector('[draft-datetime]').value),
            autoOpen: document.querySelector('[draft-autoopen]').checked,
            snake: document.querySelector('[draft-type]').value === 'snake',
            totalRounds: parseInt(document.querySelector('[draft-rounds]').value, 10) || 10,
            orderMethod: 'manual',
            draftOrder: draftOrder
        };

        const response = await fetch('/draft', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        response.json().then(data => {
            if (response.status == 200) {
                currentDraft = data;
                populateDraftFormFields();
                successToast.options.text = "Draft settings saved";
                successToast.showToast();
            } else {
                failToast.options.text = (data.message || "Draft settings could not be saved");
                failToast.showToast();
            }
        });
    });
}

if (document.querySelector('[draft-season]')) {
    populateDraftSeasonOptions();
    document.querySelector('[draft-season]').addEventListener('change', loadDraftConfig);
}
/////////////////////////////////////////////////////
/////////////////// Scoring Config ////////////////////
/////////////////////////////////////////////////////

var scoringConfigData = null;

async function displayScoringConfigContainer() {
    var c = document.querySelector('[scoring-config-container]');
    if (c.style.display == 'flex' || c.style.display == '') {
        c.style.display = 'none';
    } else {
        c.style.display = 'flex';
        await loadScoringConfig();
    }
}

async function loadScoringConfig() {
    var leagueCode = getDraftLeagueCode();
    var res = await fetch(`/scoring-config/${leagueCode}`, { headers: { 'Accept': 'application/json' } });
    scoringConfigData = await res.json();   // { league, model, combineMode, values, disabled, fields }
    document.querySelector('[scoring-config-model]').textContent =
        (leagueCode === 'graham-league' ? 'Graham' : 'Claunts') + ' — ' + scoringConfigData.model + ' model';
    var mode = document.querySelector('[scoring-config-combine-mode]');
    if (mode) mode.value = scoringConfigData.combineMode || 'first';
    document.querySelector('[scoring-config-note]').style.display = 'none';
    renderScoringFields();
}

// Renders the value inputs grouped by regular vs postseason. Postseason events
// get an enable/disable checkbox (Option A: commissioners tune points + toggle
// events + flip combine mode; they do not add/reorder rules or pick conditions).
function renderScoringFields() {
    var wrap = document.querySelector('[scoring-config-fields]');
    var vals = scoringConfigData.values || {};
    var fields = scoringConfigData.fields || [];

    function fieldRow(f) {
        var toggle = f.toggleable
            ? `<input type="checkbox" class="scoring-toggle" data-condition="${f.condition}" ${f.enabled ? 'checked' : ''} title="Enable this event">`
            : '';
        return `<div class="draft-field scoring-field${f.enabled ? '' : ' scoring-disabled'}" data-condition="${f.condition}">
            <label>${toggle}${f.additive ? '+ ' : ''}${f.label}</label>
            <div class="num-stepper">
                <button type="button" class="step-dn" tabindex="-1" aria-label="Decrease points">&#8722;</button>
                <input type="number" step="1" min="0" data-key="${f.key}" value="${vals[f.key]}">
                <button type="button" class="step-up" tabindex="-1" aria-label="Increase points">+</button>
            </div>
        </div>`;
    }

    var regular = fields.filter(function (f) { return f.group === 'regular'; });
    var post = fields.filter(function (f) { return f.group === 'postseason'; });
    wrap.innerHTML =
        '<div class="draft-status-row">Regular season</div>' + regular.map(fieldRow).join('') +
        '<div class="draft-status-row">Postseason</div>' + post.map(fieldRow).join('');

    // Grey out a postseason row when its event is disabled.
    wrap.querySelectorAll('.scoring-toggle').forEach(function (cb) {
        cb.addEventListener('change', function () {
            var row = wrap.querySelector('.scoring-field[data-condition="' + cb.getAttribute('data-condition') + '"]');
            if (row) row.classList.toggle('scoring-disabled', !cb.checked);
        });
    });

    // Custom +/- steppers (native number spinners are hidden via CSS).
    wrap.querySelectorAll('.num-stepper').forEach(function (st) {
        var inp = st.querySelector('input[type="number"]');
        function step(delta) {
            var v = parseInt(inp.value, 10);
            if (isNaN(v)) v = 0;
            inp.value = Math.max(0, v + delta);
        }
        st.querySelector('.step-up').addEventListener('click', function () { step(1); });
        st.querySelector('.step-dn').addEventListener('click', function () { step(-1); });
    });
}

async function saveScoringConfig() {
    var leagueCode = getDraftLeagueCode();
    var values = {};
    document.querySelectorAll('[scoring-config-fields] input[data-key]').forEach(function (inp) {
        values[inp.getAttribute('data-key')] = parseFloat(inp.value);
    });
    var disabled = [];
    document.querySelectorAll('[scoring-config-fields] .scoring-toggle').forEach(function (cb) {
        if (!cb.checked) disabled.push(cb.getAttribute('data-condition'));
    });
    var modeEl = document.querySelector('[scoring-config-combine-mode]');
    var combineMode = modeEl ? modeEl.value : undefined;

    var res = await fetch('/scoring-config', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            league: leagueCode, model: scoringConfigData.model,
            values: values, combineMode: combineMode, disabled: disabled
        })
    });
    var data = await res.json();
    if (res.status === 200) {
        scoringConfigData = data;
        var modeReload = document.querySelector('[scoring-config-combine-mode]');
        if (modeReload) modeReload.value = scoringConfigData.combineMode || 'first';
        renderScoringFields();
        document.querySelector('[scoring-config-note]').style.display = 'block';
        successToast.options.text = 'Scoring config saved';
        successToast.showToast();
    } else {
        failToast.options.text = (data.message || 'Could not save scoring config');
        failToast.showToast();
    }
}

const scoringConfigForm = document.getElementById('scoring-config-form');
if (scoringConfigForm) {
    scoringConfigForm.addEventListener('submit', function (e) { e.preventDefault(); saveScoringConfig(); });
}
