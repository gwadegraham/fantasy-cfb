// Live draft room. Connects to the Socket.IO draft engine, renders the board
// in real time, and lets whoever is on the clock draft a team.

var socket;
var draft = null;            // latest draft state from the server (or null)
var teamList = [];
var teamsById = {};
var membersById = {};        // userId -> { firstName, lastName }
var myUserId;
var isCommish = false;
var leagueCode;
var leagueVersion = 'V2';
var season = new Date().getFullYear();
var isMobile = false;
var countdownTimer;

window.onload = async function () {
    detectMobile();
    initNavbarToggle();

    setUserContext();
    await getMembers();
    await getTeams();
    setDynamicYearHeaders();
    setNavbarUserId();
    connectSocket();
};

function detectMobile() {
    isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent);
}

function initNavbarToggle() {
    const toggleButton = document.querySelector('.toggle-button');
    const navbarLinks = document.querySelector('.navbar-links');
    if (toggleButton && navbarLinks) {
        toggleButton.addEventListener('click', () => navbarLinks.classList.toggle('active'));
    } else {
        setTimeout(initNavbarToggle, 500);
    }
}

function setUserContext() {
    var meta = (userState && userState.user_metadata) || {};
    var roles = meta.roles || [];
    myUserId = meta.metadata && meta.metadata.userId;
    isCommish = roles.includes('Admin') || roles.includes('League Manager');

    leagueCode = (meta.metadata && meta.metadata.league == 'gg') ? 'graham-league' : 'claunts-league';
    if (roles.at(-1) == 'Admin') {
        var stored = window.localStorage.getItem('leagueCode');
        if (stored && stored != 'undefined') leagueCode = stored;
    }
    leagueVersion = (leagueCode == 'claunts-league') ? 'V1' : 'V2';
}

async function getMembers() {
    const res = await fetch(`/users/league/${leagueCode}/all`, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    data.forEach(m => { membersById[String(m._id)] = m; });
}

async function getTeams() {
    const res = await fetch('/teams', { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    teamList = data;
    data.forEach(t => { teamsById[String(t.id)] = t; });
    await displayTeams(data);
}

function setDynamicYearHeaders() {
    var rr = document.querySelector('[recruiting-ranking]');
    var ew = document.querySelector('[expected-wins]');
    if (rr) rr.innerHTML = `${new Date().getFullYear()} Recruiting`;
    if (ew) ew.innerHTML = `${new Date().getFullYear()} xWins`;
}

async function getRecruitingRankings() {
    const res = await fetch(`/recruiting/${new Date().getFullYear()}`, { headers: { 'Accept': 'application/json' } });
    return res.json();
}

async function displayTeams(data) {
    var recruitingRankings = await getRecruitingRankings();
    const body = document.querySelector('[user-table-body]');
    var str = '';

    data.sort((a, b) => scoreForTeam(b) - scoreForTeam(a));

    data.forEach(team => {
        var conference = '-';
        var cumulScore = '-';
        var expectedWins = 0;
        if (team.seasons.length > 0) {
            var season = team.seasons.find(s => s.season == (new Date().getFullYear() - 1));
            var currentSeason = team.seasons.find(s => s.season == (new Date().getFullYear()));
            conference = team.seasons.at(-1).conference;
            if (season != null) cumulScore = (leagueVersion == 'V1') ? season.cumulativeScoreV1 : season.cumulativeScoreV2;
            expectedWins = currentSeason != null ? currentSeason.expectedWins : 0;
        }

        var teamRecruiting = { rank: '-' };
        if (recruitingRankings.length > 0) {
            teamRecruiting = recruitingRankings.filter(o => (o.team == team.school || team.alternateNames.includes(o.team)))[0] || { rank: '-' };
        }

        str += `<tr data-team-id="${team.id}">`;
        str += `<td style="text-align: left;"><img src="${team.logos.at(-1)}" alt="${team.mascot}">${team.school}</td>`;
        str += `<td>${conference}</td>`;
        str += `<td>${teamRecruiting.rank}</td>`;
        str += `<td>${cumulScore}</td>`;
        str += `<td>O/U ${expectedWins}</td>`;
        str += `<td><button type="button" class="draft-pick-btn" id="draft-btn-${team.id}" onclick="makePick(${team.id})" disabled>Draft</button></td>`;
        str += '</tr>';
    });

    body.innerHTML = str;
}

function scoreForTeam(team) {
    if (!team.seasons || team.seasons.length === 0) return 0;
    var s = team.seasons.find(x => x.season == (new Date().getFullYear() - 1));
    if (s == null) return 0;
    return (leagueVersion == 'V1' ? s.cumulativeScoreV1 : s.cumulativeScoreV2) || 0;
}

/////////////////////////////////////////////////////
//////////////////// Live Socket /////////////////////
/////////////////////////////////////////////////////

async function connectSocket() {
    try {
        const res = await fetch('/draft-token', { headers: { 'Accept': 'application/json' } });
        const { token } = await res.json();
        socket = io({ auth: { token } });

        socket.on('connect', () => socket.emit('join-draft', { league: leagueCode, season }));
        socket.on('draft-state', onDraftState);
        socket.on('pick-made', onPickMade);
        socket.on('draft-complete', onDraftComplete);
        socket.on('draft-error', (e) => {
            if (e && /no draft/i.test(e.message || '')) {
                draft = null;
                renderAll();
            } else {
                failToast.options.text = (e && e.message) || 'Draft error';
                failToast.showToast();
            }
        });
    } catch (err) {
        failToast.options.text = 'Could not connect to the draft';
        failToast.showToast();
    }
}

function onDraftState(state) {
    draft = state;
    renderAll();
}

function onPickMade({ pick, state }) {
    draft = state;
    renderAll();
    var member = membersById[String(pick.userId)];
    var name = member ? `${member.firstName} ${member.lastName.substring(0, 1)}.` : 'Someone';
    successToast.options.text = `${name} drafted ${pick.team.school}`;
    successToast.showToast();
}

function onDraftComplete(state) {
    draft = state;
    renderAll();
    if (typeof startConfetti === 'function') startConfetti();
    successToast.options.text = 'Draft complete!';
    successToast.showToast();
}

function makePick(teamId) {
    var team = teamsById[String(teamId)];
    if (!team || !socket) return;
    document.querySelectorAll('.draft-pick-btn').forEach(b => b.disabled = true);
    socket.emit('make-pick', { league: leagueCode, season, team });
}

function startDraft() {
    if (socket) socket.emit('start-draft', { league: leagueCode, season });
}

/////////////////////////////////////////////////////
/////////////////////// Render ///////////////////////
/////////////////////////////////////////////////////

function renderAll() {
    renderStatus();
    renderBoard();
    renderOnTheClock();
    updateAvailability();
}

function renderStatus() {
    var el = document.getElementById('draft-status');
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }

    if (!draft) {
        el.innerHTML = `<p>No draft is scheduled for ${season} yet.</p>`;
        return;
    }

    var startBtn = isCommish ? `<button type="button" class="draft-start-btn" onclick="startDraft()">Start Draft</button>` : '';

    if (draft.status === 'pending') {
        el.innerHTML = `<p>Draft is set up but not scheduled.</p>${startBtn}`;
    } else if (draft.status === 'scheduled') {
        el.innerHTML = `<div class="draft-countdown" id="countdown"></div>${startBtn}`;
        updateCountdown();
        countdownTimer = setInterval(updateCountdown, 1000);
    } else if (draft.status === 'active') {
        el.innerHTML = `<p class="draft-live-label">🟢 Draft in progress</p>`;
    } else if (draft.status === 'complete') {
        el.innerHTML = `<p class="draft-live-label">🎉 Draft complete!</p>`;
    }
}

function updateCountdown() {
    var el = document.getElementById('countdown');
    if (!el || !draft || !draft.scheduledAt) { if (el) el.textContent = 'Draft scheduled'; return; }
    var diff = new Date(draft.scheduledAt).getTime() - Date.now();
    if (diff <= 0) { el.textContent = 'Draft starting soon…'; return; }
    var d = Math.floor(diff / 86400000);
    var h = Math.floor((diff % 86400000) / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);
    el.textContent = `Draft starts in ${d}d ${h}h ${m}m ${s}s`;
}

function renderBoard() {
    var wrap = document.getElementById('draft-board-wrap');
    if (!draft || (draft.status !== 'active' && draft.status !== 'complete')) {
        wrap.style.display = 'none';
        return;
    }
    wrap.style.display = 'block';

    var head = document.getElementById('draft-board-head');
    var body = document.getElementById('draft-board-body');

    var headStr = '<th>Player</th>';
    for (var r = 1; r <= draft.totalRounds; r++) headStr += `<th>${r}</th>`;
    head.innerHTML = headStr;

    var onClock = draft.onTheClock || {};
    var bodyStr = '';
    draft.draftOrder.forEach(userId => {
        var member = membersById[String(userId)];
        var name = member ? `${member.firstName} ${member.lastName.substring(0, 1)}.` : '—';
        bodyStr += '<tr>';
        bodyStr += `<td class="draft-board-name">${name}</td>`;
        for (var round = 1; round <= draft.totalRounds; round++) {
            var pick = draft.picks.find(p => String(p.userId) === String(userId) && p.round === round);
            var isClock = onClock.userId === String(userId) && onClock.round === round;
            var cls = isClock ? 'draft-board-cell on-clock-cell' : 'draft-board-cell';
            if (pick) {
                bodyStr += `<td class="${cls}"><img src="${pick.team.logos ? pick.team.logos.at(-1) : ''}" alt="${pick.team.school}" title="${pick.team.school}"></td>`;
            } else {
                bodyStr += `<td class="${cls}"></td>`;
            }
        }
        bodyStr += '</tr>';
    });
    body.innerHTML = bodyStr;
}

function renderOnTheClock() {
    var el = document.getElementById('on-the-clock');
    if (!draft || draft.status !== 'active' || !draft.onTheClock) { el.innerHTML = ''; return; }
    var oc = draft.onTheClock;
    var member = membersById[String(oc.userId)];
    var name = member ? `${member.firstName} ${member.lastName}` : 'Unknown';
    if (String(oc.userId) === String(myUserId)) {
        el.innerHTML = `<span class="you-are-up">🟢 You're on the clock! — Round ${oc.round}, Pick #${oc.overall}</span>`;
    } else {
        el.innerHTML = `<span>On the clock: <strong>${name}</strong> — Round ${oc.round}, Pick #${oc.overall}</span>`;
    }
}

function updateAvailability() {
    var draftedIds = new Set((draft && draft.picks ? draft.picks : []).map(p => String(p.team.id)));
    var oc = (draft && draft.onTheClock) || {};
    var myTurn = draft && draft.status === 'active' && String(oc.userId) === String(myUserId);
    var canAct = draft && draft.status === 'active' && (myTurn || isCommish);

    document.querySelectorAll('[user-table-body] tr').forEach(row => {
        var teamId = row.getAttribute('data-team-id');
        var btn = row.querySelector('.draft-pick-btn');
        var drafted = draftedIds.has(String(teamId));
        row.classList.toggle('drafted', drafted);
        if (!btn) return;
        if (drafted) {
            btn.disabled = true;
            btn.textContent = 'Drafted';
        } else {
            btn.textContent = 'Draft';
            btn.disabled = !canAct;
        }
    });
}

/////////////////////////////////////////////////////
//////////////////// Helpers /////////////////////////
/////////////////////////////////////////////////////

const _filterFunction = () => {
    const filterColumns = [0, 1];
    const trs = document.querySelectorAll(`.fl-table tr:not(.headerRow)`);
    const filter = document.querySelector('#myInput').value.replace(/\s/g, "");
    const regex = new RegExp(escape(filter), 'i');
    const isFoundInTds = td => regex.test(td.innerHTML.replace(/\s/g, ""));
    const isFound = arr => arr.some(isFoundInTds);
    trs.forEach(({ style, children }) => {
        style.display = isFound(filterColumns.map(c => children[c])) ? '' : 'none';
    });
};

function setNavbarUserId() {
    var userId = (userState.user_metadata.metadata && userState.user_metadata.metadata.userId) || window.localStorage.getItem('userId');
    const myLink = document.querySelector('[user-home]');
    if (myLink) {
        myLink.href = `/userHome?user=${userId}`;
    } else {
        setTimeout(setNavbarUserId, 500);
    }
}

var successToast = Toastify({
    text: "", duration: 4000, close: true, gravity: "top", position: "left", stopOnFocus: true,
    style: { background: "#71d28d", color: "#222" }, offset: { y: '40px' }
});

var failToast = Toastify({
    text: "", duration: 3000, close: true, gravity: "top", position: "left", stopOnFocus: true,
    style: { background: "#d27171", color: "#222" }, offset: { y: '40px' }
});

if ($("[league-selector]")) {
    setTimeout(() => {
        $("[league-selector] a").click(function () {
            $(this).parents(".dropdown").find('.btn').html($(this).text());
            $(this).parents(".dropdown").find('.btn').val($(this).attr('value'));
            window.sessionStorage.setItem("league", $("#dropdownMenuButton").text());
            window.localStorage.setItem("leagueCode", $("#dropdownMenuButton").val());
            window.location.reload();
        });
    }, 200);
}
