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

// successToast / failToast are shared globals defined in public/toast.js
// (loaded by the navbar partial). Set .options.text then call .showToast().

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
    // The calculate-team picker lives in the Admin-only Scoring group, so it's
    // absent for a League Manager — guard it (and the team-container clone).
    if (calculateTeamOption) calculateTeamOption.innerHTML = str;

    var teamContainer = document.querySelector('.team-container');
    if (teamContainer) multiplyNode(teamContainer, 10, true);
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
    'daily-scores': 'Daily', 'saturday-scores': 'Saturday', 'sunday-scores': 'Sunday',
    'live-scores': 'Live'
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
        var order = ['daily-scores', 'saturday-scores', 'sunday-scores', 'live-scores'];
        // Collapse to the latest run per job — the live poller writes a run every
        // few minutes on game days, so showing raw history would bury the others.
        var latest = {};
        jobs.forEach(function (j) {
            var prev = latest[j.jobName];
            if (!prev || new Date(j.startedAt) > new Date(prev.startedAt)) latest[j.jobName] = j;
        });
        var sorted = Object.keys(latest).map(function (k) { return latest[k]; })
            .sort(function (a, b) { return order.indexOf(a.jobName) - order.indexOf(b.jobName); });
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
        if (c && !c.classList.contains('open')) displayScoresContainer();
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

// League name: rename the active league (own-league enforced server-side).
const leagueNameForm = document.getElementById('league-name-form');
if (leagueNameForm) {
    leagueNameForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        const code = getDraftLeagueCode();
        const name = (document.querySelector('[league-name-input]').value || '').trim();
        if (!name) {
            failToast.options.text = 'Enter a league name';
            failToast.showToast();
            return;
        }
        try {
            const res = await fetch('/leagues/' + code, {
                method: 'PATCH',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 200) {
                successToast.options.text = `League renamed to "${data.name}"`;
                successToast.showToast();
            } else {
                failToast.options.text = (data && data.message) || ('League name could not be saved | ' + res.status);
                failToast.showToast();
            }
        } catch (err) {
            failToast.options.text = 'League name save failed: ' + err.message;
            failToast.showToast();
        }
    });
}

const createForm = document.getElementById('create-form')

if (createForm) {
    createForm.addEventListener('submit', async function(event) {
        event.preventDefault();
    
        const firstName = document.querySelector('[first-name]').value;
        const lastName = document.querySelector('[last-name]').value;

        // Color and the active-season roster entry are assigned server-side —
        // the manager just provides a name; the draft fills the roster.
        var userBody = {
            firstName: firstName,
            lastName: lastName,
            league: leagueCode
        };

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

// Season roster: an include/exclude checklist for the active season. Replaces
// the old destructive "Remove a Player" (which hard-deleted the whole record).
// Toggling only adds/drops the player's current-season entry — history is kept.
function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}

async function loadSeasonRoster() {
    var leagueCode = getDraftLeagueCode();
    var list = document.querySelector('[season-roster-list]');
    if (list) list.textContent = 'Loading…';
    try {
        var res = await fetch('/users/league/' + encodeURIComponent(leagueCode) + '/roster', { headers: { 'Accept': 'application/json' } });
        var data = await res.json();
        var yearEl = document.querySelector('[season-roster-year]');
        if (yearEl) yearEl.textContent = data.season || 'current';
        if (!res.ok || !Array.isArray(data.players)) { if (list) list.textContent = 'Could not load the roster.'; return; }
        // Once the season is underway the roster is locked for League Managers
        // (removing a scored player would drop that year's data). Show a banner
        // and disable the toggles; the server enforces it regardless.
        var banner = data.locked
            ? '<div class="scoring-locked"><span data-icon="lock" data-icon-size="16"></span>The roster is locked once the season is underway. Contact an admin to change it.</div>'
            : '';
        list.innerHTML = banner + data.players.map(function (p) {
            var color = /^#[0-9a-fA-F]{3,8}$/.test(p.color || '') ? p.color : '#5B6690';
            var name = escHtml(p.firstName + ' ' + p.lastName);
            return '<label class="roster-row">' +
                '<input type="checkbox" class="scoring-toggle roster-toggle" data-id="' + escHtml(p._id) + '" data-name="' + name + '" data-scored="' + !!p.scored + '"' + (p.inSeason ? ' checked' : '') + (data.locked ? ' disabled' : '') + '>' +
                '<span class="roster-dot" style="background:' + color + '"></span>' +
                '<span class="roster-name">' + name + '</span>' +
            '</label>';
        }).join('');
        list.classList.toggle('is-locked', !!data.locked);
    } catch (err) {
        if (list) list.textContent = 'Could not load the roster.';
    }
}

// Toggle a player's active-season membership. Confirms before removing someone
// who already has points this season (that year's scores would be dropped).
document.addEventListener('change', async function (e) {
    var cb = e.target;
    if (!cb || !cb.classList || !cb.classList.contains('roster-toggle')) return;
    var included = cb.checked;
    var name = cb.getAttribute('data-name');
    if (!included && cb.getAttribute('data-scored') === 'true') {
        if (!window.confirm('Remove ' + name + ' from this season? Their scores for this year will be dropped — past seasons and records are kept.')) {
            cb.checked = true;
            return;
        }
    }
    cb.disabled = true;
    try {
        var res = await fetch('/users/' + encodeURIComponent(cb.getAttribute('data-id')) + '/season-membership', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ included: included })
        });
        var data = await res.json();
        if (!res.ok) {
            cb.checked = !included;
            failToast.options.text = data.message || 'Could not update the roster';
            failToast.showToast();
        } else {
            cb.checked = !!data.inSeason;
            successToast.options.text = name + (data.inSeason ? ' added to the season' : ' removed from this season');
            successToast.showToast();
        }
    } catch (err) {
        cb.checked = !included;
        failToast.options.text = 'Could not update the roster';
        failToast.showToast();
    } finally {
        cb.disabled = false;
    }
});

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

// Score every team's team-doc by looping the existing per-team endpoint in
// small concurrent batches (single summary toast) instead of firing ~136
// parallel requests + ~136 toasts. Each request is short — this is driven from
// the browser precisely so no single request trips Heroku's 30s router timeout.
const calculateAllForm = document.getElementById('all-score-form')
if (calculateAllForm) {
    calculateAllForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const season = document.querySelector('[team-score-season]').value;
        if (!season) {
            failToast.options.text = 'Pick a season first';
            failToast.showToast();
            return;
        }

        block_screen();
        try {
            const { total, failed } = await calcAllTeams(season);
            unblock_screen();
            successToast.options.text = `Calculated ${total - failed}/${total} teams for ${season}` + (failed ? ` (${failed} failed)` : '');
            successToast.showToast();
        } catch (err) {
            unblock_screen();
            failToast.options.text = 'Team scores failed: ' + err.message;
            failToast.showToast();
        }
    });
}

// Score the whole season in one click: user weekly scores for every week +
// postseason, then all team-doc scores — the finished-season backfill (replaces
// 17× Update Scores + Calculate Scores for all teams). Orchestrated from the
// browser as many short requests: a single server request doing the whole
// season would exceed Heroku's 30s router timeout (H12) and 503.
const scoresAllForm = document.getElementById('scores-all-form');
if (scoresAllForm) {
    scoresAllForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        if (!window.confirm('Recompute ALL user + team scores for the whole season? This can take several minutes.')) return;

        const season = window.APP_YEAR || String(new Date().getFullYear());
        const weeks = [];
        for (let w = 1; w <= 16; w++) weeks.push(['regular', w]);
        weeks.push(['postseason', 1]);

        block_screen();
        const failedWeeks = [];
        try {
            // 1. User weekly scores — one short request per week (each also
            //    recomputes cumulative totals, so the last call leaves them current).
            for (let i = 0; i < weeks.length; i++) {
                block_screen(); // re-arm the overlay watchdog between steps
                setBlockMessage(`Scoring week ${i + 1} of ${weeks.length}…`);
                try {
                    await updateWeek(weeks[i][0], weeks[i][1]);
                } catch (e) {
                    failedWeeks.push(weeks[i][0] === 'postseason' ? 'postseason' : `wk${weeks[i][1]}`);
                }
            }
            // 2. Team-doc scores.
            const { total, failed } = await calcAllTeams(season);
            unblock_screen();

            const notes = [];
            if (failedWeeks.length) notes.push(`${failedWeeks.length} week(s) failed`);
            if (failed) notes.push(`${failed} team(s) failed`);
            successToast.options.text = `Season scored: ${weeks.length} weeks + ${total} teams` + (notes.length ? ` (${notes.join(', ')})` : '');
            successToast.showToast();
        } catch (err) {
            unblock_screen();
            failToast.options.text = 'Season score failed: ' + err.message;
            failToast.showToast();
        }
    });
}

const rankingsForm = document.getElementById('rankings-form');

// Pull a whole season's rankings in one shot (all weeks, regular + postseason)
// and upsert them — non-destructive, safe to re-run.
if (rankingsForm) {
    rankingsForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        block_screen();

        const season = document.querySelector('[rankings-season]').value;
        const response = await fetch(`/rankings/${season}/refresh`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        unblock_screen();

        const results = document.getElementById('rankings-results');
        if (response.status == 201) {
            successToast.options.text = `Rankings synced for ${season}: ${data.weeks} weeks (${data.created} new, ${data.updated} updated)`;
            successToast.showToast();
            if (results) results.textContent = `${data.weeks} weeks — ${data.created} new, ${data.updated} updated.`;
        } else {
            failToast.options.text = (response.status) + ` | Rankings could not be retrieved`;
            failToast.showToast();
            if (results) results.textContent = (data && data.message) || 'Failed.';
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
                    unblock_screen();
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
                unblock_screen();
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
                unblock_screen();
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

// --- CFP odds ingestion (Market odds) ---------------------------------------
function displayCfpOddsContainer() { toggleSub('cfp-odds-container'); }

(function () {
    var form = document.getElementById('cfp-odds-form');
    if (!form) return;
    var commitBtn = document.getElementById('cfp-odds-commit');
    var previewed = false;

    async function run(commit) {
        var season = document.querySelector('[cfp-odds-season]').value;
        var market = document.querySelector('[cfp-odds-market]').value;
        var text = document.querySelector('[cfp-odds-text]').value;
        if (!text.trim()) {
            failToast.options.text = 'Paste an odds board first';
            failToast.showToast();
            return;
        }
        block_screen();
        try {
            var res = await fetch('/teams/' + encodeURIComponent(season) + '/cfp-odds', {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ market: market, text: text, commit: commit })
            });
            var data = await res.json();
            unblock_screen();
            if (res.status !== 200) {
                failToast.options.text = (data && data.message) || (res.status + ' failed');
                failToast.showToast();
                return;
            }
            renderCfpOdds(data);
            if (!commit) {
                previewed = true;
                commitBtn.disabled = false;
                infoToast.options.text = 'Matched ' + data.matchedCount + ' teams' + (data.unmatchedCount ? (', ' + data.unmatchedCount + ' unmatched') : '') + '. Review, then Commit.';
                infoToast.showToast();
            } else {
                successToast.options.text = 'Saved ' + data.matchedCount + ' ' + (market === 'champ' ? 'championship' : 'CFP') + ' odds for ' + season;
                successToast.showToast();
                commitBtn.disabled = true;
                previewed = false;
            }
        } catch (err) {
            unblock_screen();
            failToast.options.text = 'CFP odds failed: ' + err.message;
            failToast.showToast();
        }
    }

    form.addEventListener('submit', function (e) { e.preventDefault(); run(false); });
    commitBtn.addEventListener('click', function () {
        if (!previewed) return;
        if (!window.confirm('Save these odds to the ' + document.querySelector('[cfp-odds-season]').value + ' season?')) return;
        run(true);
    });
})();

function renderCfpOdds(data) {
    var out = document.getElementById('cfp-odds-results');
    if (!out) return;
    function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

    var rows = (data.matched || []).map(function (m) {
        return '<tr><td>' + esc(m.school) + '</td><td class="cfp-num">' + (m.odds > 0 ? '+' : '') + m.odds + '</td><td class="cfp-num">' + m.prob + '%</td></tr>';
    }).join('');
    var unmatched = (data.unmatched && data.unmatched.length)
        ? '<div class="cfp-unmatched"><strong>Unmatched (' + data.unmatched.length + '):</strong> ' + data.unmatched.map(esc).join(', ') + '</div>'
        : '';
    out.innerHTML = '<div class="cfp-odds-summary">' + (data.dryRun ? 'Preview — ' : 'Saved — ')
        + data.matchedCount + ' matched, ' + data.unmatchedCount + ' unmatched (' + esc(data.market) + ', ' + data.season + ')</div>'
        + unmatched
        + '<table class="cfp-odds-table"><thead><tr><th>Team</th><th>Odds</th><th>Implied</th></tr></thead><tbody>' + rows + '</tbody></table>';
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
                failToast.showToast();
                unblock_screen();
            }
        });
    });
}

function displayScheduleContainer() { toggleSub('schedule-container'); }

// Bulk-ingest a season's full FBS regular schedule — the preseason prerequisite
// for draft grades (the projection reads each team's schedule).
const scheduleForm = document.getElementById('schedule-form');

if (scheduleForm) {
    scheduleForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        block_screen();

        const season = document.querySelector('[schedule-season]').value;
        const response = await fetch(`/games/${season}/schedule`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        unblock_screen();

        const results = document.getElementById('schedule-results');
        if (response.status == 201) {
            successToast.options.text = `Schedule ingested for ${season}: ${data.created} new, ${data.updated} updated`;
            successToast.showToast();
            if (results) results.textContent = `${data.total} games (${data.created} new, ${data.updated} updated).`;
        } else {
            failToast.options.text = (response.status) + `| Schedule could not be ingested`;
            failToast.showToast();
            if (results) results.textContent = (data && data.message) || 'Failed.';
        }
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
                failToast.showToast();
                unblock_screen();
            }
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
                unblock_screen();
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
                unblock_screen();
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
                unblock_screen();
            }
        });
    });
}

// --- Accordion (admin function panels) -----------------------------------
// Panels collapse via a CSS max-height:0 state; on open we set max-height to the
// measured content height so it animates smoothly, then release the cap so
// lazy-loaded content (draft/scoring config) can still grow. The inline
// display:none is dropped once so the collapsed CSS state can take over.
function initAccordion() {
    document.querySelectorAll('.sub-container').forEach(function (sc) {
        sc.style.display = '';
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAccordion);
} else {
    initAccordion();
}

// Toggle a panel open/closed by its container attribute. Returns the new open
// state so callers that lazy-load on expand (draft/scoring config) can react.
function toggleSub(attr) {
    var el = document.querySelector('[' + attr + ']');
    if (!el) return false;
    var open = !el.classList.contains('open');

    clearTimeout(el._mhTimer);
    if (open) {
        el.classList.add('open');
        el.style.maxHeight = el.scrollHeight + 'px';
        // After the open animation, drop the cap so async-loaded content
        // (draft/scoring config) can still grow the panel. Guarded + timer-based
        // so it survives rapid re-toggles and reduced-motion (no transitionend).
        el._mhTimer = setTimeout(function () {
            if (el.classList.contains('open')) el.style.maxHeight = 'none';
        }, 340);
    } else {
        // Pin the current height, then collapse to 0 so it can transition.
        el.style.maxHeight = el.scrollHeight + 'px';
        void el.offsetHeight; // reflow
        el.classList.remove('open');
        el.style.maxHeight = '0';
    }

    var fc = el.closest('.function-container');
    if (fc) {
        fc.classList.toggle('is-open', open);
        var btn = fc.querySelector('.button-container button');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    return open;
}

function displayCreateUserContainer() { toggleSub('create-user-container'); }

function displaySeasonRosterContainer() { if (toggleSub('season-roster-container')) loadSeasonRoster(); }

function displayTeamContainer() { toggleSub('calculate-team-score-container'); }

function displayRankingsContainer() { toggleSub('rankings-container'); }

function displayRecruitRankingsContainer() { toggleSub('recruit-rankings-container'); }
function displayTeamRecordsContainer() { toggleSub('team-records-container'); }
function displayRefreshTeamsContainer() { toggleSub('refresh-teams-container'); }
function displayGamesContainer() { toggleSub('games-container'); }
function displayScoresContainer() { toggleSub('scores-container'); }
function displayBettingLinesContainer() { toggleSub('betting-lines-container'); }
function displayExpectedWinsContainer() { toggleSub('expected-wins-container'); }
function displayEnrichmentContainer() { toggleSub('enrichment-container'); }
function displayApiCallsContainer() { toggleSub('api-calls-container'); }
function displayLeagueNameContainer() { if (toggleSub('league-name-container')) loadLeagueName(); }

function displayEngagementContainer() { if (toggleSub('engagement-container')) { setEngagementSeasonOptions(); loadEngagement(); } }

// Populate the engagement season selector once (next season down a few years),
// defaulting to the current year. Reloads the toggles when the season changes,
// since each season has its own settings.
function setEngagementSeasonOptions() {
    var sel = document.querySelector('[eng-season]');
    if (!sel || sel.dataset.ready) return;
    var y = new Date().getFullYear();
    var str = '';
    for (var yr = y + 1; yr >= y - 3; yr--) str += '<option value="' + yr + '"' + (yr === y ? ' selected' : '') + '>' + yr + '</option>';
    sel.innerHTML = str;
    sel.dataset.ready = '1';
    sel.addEventListener('change', loadEngagement);
}

// Prefill the engagement toggles from the active league's saved config for the
// selected season.
async function loadEngagement() {
    try {
        var code = getDraftLeagueCode();
        var seasonSel = document.querySelector('[eng-season]');
        var season = (seasonSel && seasonSel.value) || new Date().getFullYear();
        var cfg = await fetch('/scoring-config/' + encodeURIComponent(code) + '?season=' + encodeURIComponent(season), { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); });
        var e = (cfg && cfg.engagement) || {};
        var h2h = document.querySelector('[eng-h2h-enabled]');
        var bonus = document.querySelector('[eng-h2h-bonus]');
        var cap = document.querySelector('[eng-captain-enabled]');
        var mult = document.querySelector('[eng-captain-mult]');
        if (h2h) h2h.checked = !!e.h2hEnabled;
        if (bonus) bonus.value = (e.h2hWinBonus != null ? e.h2hWinBonus : 3);
        if (cap) cap.checked = !!e.captainEnabled;
        if (mult) mult.value = (e.captainMultiplier != null ? e.captainMultiplier : 2);
    } catch (e) { /* leave defaults */ }
}

const engagementForm = document.getElementById('engagement-form');
if (engagementForm) {
    engagementForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        const code = getDraftLeagueCode();
        const seasonSel = document.querySelector('[eng-season]');
        const body = {
            season: (seasonSel && seasonSel.value) || String(new Date().getFullYear()),
            h2hEnabled: document.querySelector('[eng-h2h-enabled]').checked,
            h2hWinBonus: Number(document.querySelector('[eng-h2h-bonus]').value),
            captainEnabled: document.querySelector('[eng-captain-enabled]').checked,
            captainMultiplier: Number(document.querySelector('[eng-captain-mult]').value)
        };
        try {
            const res = await fetch('/scoring-config/' + encodeURIComponent(code) + '/engagement', {
                method: 'PATCH',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 200) {
                successToast.options.text = `Game modes saved · ${data.season || body.season}`
                    + (data.h2hEnabled ? ` · H2H +${data.h2hWinBonus}` : ' · H2H off')
                    + (data.captainEnabled ? ` · Captain ${data.captainMultiplier}×` : ' · Captain off');
                successToast.showToast();
            } else {
                failToast.options.text = (data && data.message) || ('Could not save engagement | ' + res.status);
                failToast.showToast();
            }
        } catch (err) {
            failToast.options.text = 'Engagement save failed: ' + err.message;
            failToast.showToast();
        }
    });
}

// Prefill the league-name field with the current name for the active league.
async function loadLeagueName() {
    try {
        var code = getDraftLeagueCode();
        var list = await fetch('/leagues', { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); });
        var lg = (list || []).find(function (l) { return l.code === code; });
        var input = document.querySelector('[league-name-input]');
        if (input && lg) input.value = lg.name;
    } catch (e) { /* leave the field as-is */ }
}

// Full-screen "working" overlay shown while an admin request runs. It carries a
// football loader (desktop + mobile friendly, respects reduced-motion) and, most
// importantly, is engineered so it can NEVER stay stuck:
//   1. block_screen is idempotent — repeated calls reuse one overlay.
//   2. A watchdog auto-clears it if a handler ever forgets to unblock.
//   3. A global unhandledrejection listener (registered below) clears it the
//      instant a request throws/rejects.
// Individual handlers also unblock in both their success and error branches.
function block_screen() {
    let el = document.getElementById('screenBlock');
    if (!el) {
        el = document.createElement('div');
        el.id = 'screenBlock';
        el.className = 'blockDiv';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-label', 'Working');
        var ball = (typeof window !== 'undefined' && window.ccIcon)
            ? window.ccIcon('football', { size: 46 })
            : '🏈';
        el.innerHTML =
            '<div class="admin-loader">' +
              '<span class="admin-loader-ball" aria-hidden="true">' + ball + '</span>' +
              '<div class="admin-loader-text">Working<span class="admin-loader-dots"><i>.</i><i>.</i><i>.</i></span></div>' +
            '</div>';
        document.body.appendChild(el);
    }
    // Fade in on the next frame so the CSS transition actually runs.
    requestAnimationFrame(function () { el.classList.add('is-visible'); });
    // Safety net: never leave the overlay up longer than the slowest admin op
    // (score updates cap out near 100s), even if a handler forgets to unblock.
    clearTimeout(block_screen._watchdog);
    block_screen._watchdog = setTimeout(unblock_screen, 150000);
}

function unblock_screen() {
    clearTimeout(block_screen._watchdog);
    var el = document.getElementById('screenBlock');
    if (!el) return;
    el.classList.remove('is-visible');
    // Remove after the fade, with a hard-removal fallback so a missed
    // transitionend (reduced-motion, backgrounded tab) can't orphan the node.
    var removed = false;
    var done = function () {
        if (removed) return;
        removed = true;
        if (el.parentNode) el.parentNode.removeChild(el);
    };
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 400);
}

// Update the loading overlay's caption (status for long-running admin ops).
function setBlockMessage(msg) {
    var t = document.querySelector('#screenBlock .admin-loader-text');
    if (t) t.textContent = msg;
}

// Score one week's user scores (existing per-week endpoint; stays well under
// Heroku's 30s request limit). Throws on a non-OK response.
async function updateWeek(seasonType, week) {
    var res = await fetch('/scores/update', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonType: seasonType, week: String(week) })
    });
    if (!res.ok) throw new Error(seasonType + ' week ' + week + ': ' + res.status);
}

// Score every team's team-doc by looping the per-team endpoint in small
// concurrent batches, updating the overlay caption. Each request is short, so
// no single request can trip Heroku's 30s router timeout. Returns
// { total, failed }; a failed team is counted and skipped, never fatal.
async function calcAllTeams(season) {
    var teams = await fetch('/teams', { headers: { 'Accept': 'application/json' } }).then(function (r) { return r.json(); });
    var list = Array.isArray(teams) ? teams : [];
    var done = 0, failed = 0;
    var CONCURRENCY = 5;
    for (var i = 0; i < list.length; i += CONCURRENCY) {
        var chunk = list.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async function (t) {
            try {
                var res = await fetch('/calculate-team-score/' + season + '/' + t.id + '/' + encodeURIComponent(t.school), { headers: { 'Accept': 'application/json' } });
                if (!res.ok) failed++;
            } catch (e) {
                failed++;
            }
            done++;
        }));
        block_screen(); // re-arm the overlay watchdog between batches
        setBlockMessage('Calculating team scores ' + done + ' of ' + list.length + '…');
    }
    return { total: list.length, failed: failed };
}

// Belt-and-suspenders: if any admin request rejects (network error, aborted
// fetch, JSON parse failure) the overlay clears immediately instead of hanging.
if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', function () { unblock_screen(); });
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
    var currentYear = Number(window.APP_YEAR) || new Date().getFullYear();   // active season, not wall clock
    var str = '';
    for (var y = currentYear + 1; y >= currentYear - 3; y--) {
        str += `<option value="${y}">${y}</option>`;
    }
    sel.innerHTML = str;
    sel.value = currentYear;
}

async function displayDraftConfigContainer() {
    if (toggleSub('draft-config-container')) await loadDraftConfig();
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
    if (toggleSub('scoring-config-container')) await loadScoringConfig();
}

// Loads the resolved scoring config for the current league. Pass a `model` to
// preview a different rule shape (Fixed = claunts, Stacking = graham); the
// server returns that shape's rules and its own default values.
async function loadScoringConfig(model) {
    var leagueCode = getDraftLeagueCode();
    var url = `/scoring-config/${leagueCode}` + (model ? `?model=${encodeURIComponent(model)}` : '');
    var res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    scoringConfigData = await res.json();   // { league, model, combineMode, values, disabled, fields, example }
    document.querySelector('[scoring-config-note]').style.display = 'none';
    applyScoringConfig();
}

// Plain-language name for each rule shape (the league's `model`).
var SHAPE_LABEL = { claunts: 'Fixed win values', graham: 'Stacking win values' };

// Reflects the loaded config into the UI: header, selected shape, rule rows,
// and the worked example. Shared by load and save.
function applyScoringConfig() {
    var leagueCode = getDraftLeagueCode();
    var leagueName = (leagueCode === 'graham-league' ? 'Graham' : 'Claunts') + ' League';
    document.querySelector('[scoring-config-model]').textContent =
        leagueName + ' — ' + (SHAPE_LABEL[scoringConfigData.model] || scoringConfigData.model);
    setShape(scoringConfigData.model);
    renderScoringFields();
    renderShapeExample();
    applyScoringLock();
}

// League Managers can't change scoring once the season is underway (server
// enforces this too). When locked, disable every control, hide Save, and show
// the "contact an admin" banner so it's clear before they try.
function applyScoringLock() {
    var locked = !!(scoringConfigData && scoringConfigData.locked);
    var form = document.getElementById('scoring-config-form');
    if (!form) return;
    form.querySelectorAll('input, button').forEach(function (el) { el.disabled = locked; });
    // Dim the editable areas so the disabled state is obvious (the disabled
    // attribute alone doesn't visibly change the custom-styled controls).
    var fields = form.querySelector('[scoring-config-fields]');
    if (fields) fields.classList.toggle('is-locked', locked);
    var shape = form.querySelector('[scoring-config-shape]');
    if (shape) shape.classList.toggle('is-locked', locked);
    var banner = form.querySelector('[scoring-config-locked]');
    if (banner) banner.style.display = locked ? 'flex' : 'none';
    var actions = form.querySelector('.draft-config-actions');
    if (actions) actions.style.display = locked ? 'none' : '';
}

// Rule shape is a two-card radio bound to the league's model (claunts/graham).
function getShape() {
    var checked = document.querySelector('[scoring-config-shape] input[name="rule-shape"]:checked');
    return checked ? checked.value : ((scoringConfigData && scoringConfigData.model) || 'claunts');
}

function setShape(model) {
    document.querySelectorAll('[scoring-config-shape] input[name="rule-shape"]').forEach(function (r) {
        r.checked = (r.value === model);
    });
    document.querySelectorAll('[scoring-config-shape] .mode-card').forEach(function (c) {
        c.classList.toggle('is-active', c.getAttribute('data-model') === model);
    });
}

// Current points for a matched example rule: the live input value if present
// (so the example tracks unsaved edits), else the saved-value fallback.
function exPoints(m) {
    var inp = document.querySelector('[scoring-config-fields] input[data-key="' + m.key + '"]');
    if (inp) {
        var v = parseFloat(inp.value);
        if (!isNaN(v)) return v;
    }
    return m.points;
}

// A one-line worked example for the SELECTED shape, recomputed from the live
// point inputs. Fixed: the single category the win lands in. Stacking: the base
// plus every qualifying bonus, added up.
function renderShapeExample() {
    var box = document.querySelector('[scoring-config-example]');
    if (!box) return;
    var ex = scoringConfigData && scoringConfigData.example;
    if (!ex || !ex.matched || !ex.matched.length) {
        box.innerHTML = '';
        box.style.display = 'none';
        return;
    }
    box.style.display = '';
    var stacking = scoringConfigData.combineMode === 'sum';
    var pts = ex.matched.map(exPoints);
    var plural = function (n) { return n + ' pt' + (n === 1 ? '' : 's'); };
    var body;
    if (stacking) {
        var sum = pts.reduce(function (a, b) { return a + b; }, 0);
        body = '<div class="combine-example-row is-active">' +
            '<span class="cx-val">' + plural(sum) + '</span>' +
            '<span class="cx-note">' + pts.join(' + ') + ' = ' + sum + '</span>' +
        '</div>';
    } else {
        body = '<div class="combine-example-row is-active">' +
            '<span class="cx-val">' + plural(pts[0]) + '</span>' +
            '<span class="cx-note">counts as &ldquo;' + ex.matched[0].label + '&rdquo;</span>' +
        '</div>';
    }
    box.innerHTML =
        '<div class="combine-example-head">Example &mdash; <b>' + ex.scenario + '</b> scores&hellip;</div>' + body;
}

// Renders the value inputs grouped by regular vs postseason. Postseason events
// get an enable/disable checkbox. A "+" marks a bonus that adds on top of the
// others; whether a rule stacks is a property of the shape's rules, so it's
// read straight from each field's `additive` flag.
function renderScoringFields() {
    var wrap = document.querySelector('[scoring-config-fields]');
    var vals = scoringConfigData.values || {};
    var fields = scoringConfigData.fields || [];

    function fieldRow(f) {
        var rankAttrs = f.rankGroup ? ` data-rank-group="${f.rankGroup}" data-rank-flat="${!!f.rankFlat}"` : '';
        var toggle = f.toggleable
            ? `<input type="checkbox" class="scoring-toggle" data-condition="${f.condition}" data-default-off="${!!f.defaultOff}"${rankAttrs} ${f.enabled ? 'checked' : ''} title="Enable this rule">`
            : '';
        // "+" marks a regular-season bonus that stacks (only meaningful in the
        // Stacking shape). Postseason events combine on their own rules
        // regardless of the win shape, so a "+" there just reads as a
        // contradiction — omit it and let the postseason list stand plainly.
        var showPlus = f.additive && f.group === 'regular';
        // A stacking note sits directly under the row it describes, so "this" /
        // "these points" clearly refers to that rule.
        var note = f.stacksNote ? `<div class="scoring-note">${f.stacksNote}</div>` : '';
        return `<div class="draft-field scoring-field${f.enabled ? '' : ' scoring-disabled'}" data-condition="${f.condition}">
            <label>${toggle}${showPlus ? '+ ' : ''}${f.label}</label>
            <div class="num-stepper">
                <button type="button" class="step-dn" tabindex="-1" aria-label="Decrease points">&#8722;</button>
                <input type="number" step="1" min="0" data-key="${f.key}" value="${vals[f.key]}">
                <button type="button" class="step-up" tabindex="-1" aria-label="Increase points">+</button>
            </div>
        </div>${note}`;
    }

    var regular = fields.filter(function (f) { return f.group === 'regular'; });
    var post = fields.filter(function (f) { return f.group === 'postseason'; });
    wrap.innerHTML =
        '<div class="draft-status-row">Regular season</div>' + regular.map(fieldRow).join('') +
        '<div class="draft-status-row">Postseason</div>' + post.map(fieldRow).join('');

    // Grey out a row when its rule is off.
    function syncToggleRow(cb) {
        var row = wrap.querySelector('.scoring-field[data-condition="' + cb.getAttribute('data-condition') + '"]');
        if (row) row.classList.toggle('scoring-disabled', !cb.checked);
    }
    wrap.querySelectorAll('.scoring-toggle').forEach(function (cb) {
        cb.addEventListener('change', function () {
            // Within a rank group, the flat "vs ranked" rule and the tiered
            // "#1-10 / #11-25" rules are mutually exclusive: turning one kind on
            // turns the other kind off. (Two tiers can still coexist.)
            var group = cb.getAttribute('data-rank-group');
            if (cb.checked && group) {
                var isFlat = cb.getAttribute('data-rank-flat') === 'true';
                wrap.querySelectorAll('.scoring-toggle[data-rank-group="' + group + '"]').forEach(function (other) {
                    if (other === cb) return;
                    var otherFlat = other.getAttribute('data-rank-flat') === 'true';
                    if (isFlat !== otherFlat && other.checked) {
                        other.checked = false;
                        syncToggleRow(other);
                    }
                });
            }
            syncToggleRow(cb);
        });
    });

    // Custom +/- steppers (native number spinners are hidden via CSS).
    wrap.querySelectorAll('.num-stepper').forEach(function (st) {
        var inp = st.querySelector('input[type="number"]');
        function step(delta) {
            var v = parseInt(inp.value, 10);
            if (isNaN(v)) v = 0;
            inp.value = Math.max(0, v + delta);
            renderShapeExample();
        }
        st.querySelector('.step-up').addEventListener('click', function () { step(1); });
        st.querySelector('.step-dn').addEventListener('click', function () { step(-1); });
    });

    // Keep the worked example in sync as point values are typed. Assigned (not
    // added) so repeated renders don't stack duplicate listeners.
    wrap.oninput = function (e) {
        if (e.target && e.target.matches && e.target.matches('input[data-key]')) renderShapeExample();
    };
}

async function saveScoringConfig() {
    var leagueCode = getDraftLeagueCode();
    var values = {};
    document.querySelectorAll('[scoring-config-fields] input[data-key]').forEach(function (inp) {
        values[inp.getAttribute('data-key')] = parseFloat(inp.value);
    });
    // Default-on rules that are unchecked go in `disabled`; default-off rules
    // (the finer opt-in categories) that are checked go in `enabled`.
    var disabled = [], enabled = [];
    document.querySelectorAll('[scoring-config-fields] .scoring-toggle').forEach(function (cb) {
        var cond = cb.getAttribute('data-condition');
        if (cb.getAttribute('data-default-off') === 'true') {
            if (cb.checked) enabled.push(cond);
        } else if (!cb.checked) {
            disabled.push(cond);
        }
    });

    var res = await fetch('/scoring-config', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
            league: leagueCode, model: getShape(),
            values: values, disabled: disabled, enabled: enabled
        })
    });
    var data = await res.json();
    if (res.status === 200) {
        scoringConfigData = data;
        applyScoringConfig();
        // Admins can re-score; League Managers can't (and only reach save
        // pre-season anyway), so don't tell them to run a rescore.
        var note = document.querySelector('[scoring-config-note]');
        note.textContent = data.isAdmin
            ? 'Saved. Run a full-season rescore to apply this to existing scores.'
            : 'Saved. Your changes take effect when scores are next calculated.';
        note.style.display = 'block';
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

// Switching the rule shape reloads that shape's rules + values from the server
// (Fixed and Stacking have entirely different rule sets), then re-renders.
document.querySelectorAll('[scoring-config-shape] input[name="rule-shape"]').forEach(function (r) {
    r.addEventListener('change', function () {
        setShape(r.value);
        loadScoringConfig(r.value);
    });
});
