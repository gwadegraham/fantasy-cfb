// Live draft room. Connects to the Socket.IO draft engine, renders the board
// in real time, and lets whoever is on the clock draft a team. The team pool
// below the board is a sortable/filterable draft aid.

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
var justPickedKey = null;    // "userId-round" of the pick to animate in once

function ccReduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

var pool = [];               // enriched team rows for the pool table
var poolSort = { key: 'xwins', dir: -1 };
var xwMin = 0, xwMax = 0;

// Self-hosted conference logos (same set as the team page) — used instead of
// conference names in the mobile pool cards so long names don't get cut off.
function conferenceLogo(conf) {
    var map = {
        'ACC': '../images/logo-acc.svg',
        'American Athletic': '../images/logo-aac.png',
        'Big 12': '../images/logo-big12.png',
        'Big Ten': '../images/logo-big-ten.svg',
        'Conference USA': '../images/logo-cusa.png',
        'FBS Independents': '../images/logo-fbs-independents.gif',
        'Mid-American': '../images/logo-mac.png',
        'Mountain West': '../images/logo-mountain-west.png',
        'Pac-12': '../images/logo-pac12.png',
        'Sun Belt': '../images/logo-sun-belt.png',
        'SEC': '../images/logo-sec.png'
    };
    return map[conf] || '';
}

// Manager display: prefer the season's franchise/team name, fall back to person.
function managerName(userId) {
    var m = membersById[String(userId)];
    return m ? `${m.firstName || ''} ${m.lastName || ''}`.trim() : 'Unknown';
}
function managerDisplay(userId) {
    var m = membersById[String(userId)];
    if (!m) return 'Unknown';
    var yr = (draft && draft.season) || season;
    var s = (m.seasons || []).find(x => String(x.season) === String(yr));
    return (s && s.franchiseName) || managerName(userId);
}

// Small round avatar for the board (photo face-crop or colored initials), so the
// board can show managers by picture and reclaim the space the names used.
function memberAvatar(userId) {
    var m = membersById[String(userId)];
    if (!m) return '<span class="board-avatar board-avatar-initials" style="background:#333">?</span>';
    var initials = (((m.firstName || '')[0] || '') + ((m.lastName || '')[0] || '')).toUpperCase();
    if (m.avatarUrl) {
        var src = m.avatarUrl.indexOf('/upload/') !== -1
            ? m.avatarUrl.replace('/upload/', '/upload/c_fill,g_face,w_64,h_64,q_auto,f_auto/')
            : m.avatarUrl;
        return `<span class="board-avatar"><img src="${src}" alt=""></span>`;
    }
    return `<span class="board-avatar board-avatar-initials" style="background:${m.color || '#333'}">${escapeHtml(initials || '?')}</span>`;
}

window.onload = async function () {
    detectMobile();
    // The navbar partial (views/partials/navbar.ejs) owns its hamburger and the
    // "My team" link + userId caching.
    setUserContext();
    await getMembers();
    await getTeams();
    connectSocket();
};

function detectMobile() {
    isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/.test(navigator.userAgent);
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

async function getRecruitingRankings() {
    const res = await fetch(`/recruiting/${new Date().getFullYear()}`, { headers: { 'Accept': 'application/json' } });
    return res.json().catch(() => []);
}

async function getTeams() {
    const res = await fetch('/teams', { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    teamList = data;
    data.forEach(t => { teamsById[String(t.id)] = t; });

    const recruiting = await getRecruitingRankings();
    buildPool(data, recruiting);
    populateConfFilter();
    renderPool();
}

function buildPool(teams, recruiting) {
    var yr = new Date().getFullYear();
    pool = teams.map(t => {
        var conf = '-', score = null, xwins = 0, sp = null, spRank = null;
        if (t.seasons && t.seasons.length) {
            var prev = t.seasons.find(s => s.season == (yr - 1));
            var cur = t.seasons.find(s => s.season == yr);
            conf = t.seasons.at(-1).conference;
            if (prev) score = (leagueVersion == 'V1') ? prev.cumulativeScoreV1 : prev.cumulativeScoreV2;
            if (cur) {
                xwins = cur.expectedWins || 0;
                if (cur.spRating != null) sp = cur.spRating;
                if (cur.spRank != null) spRank = cur.spRank;
            }
            // Preseason fallback: before the upcoming season's ratings publish,
            // use last season's final SP+ as the draft signal.
            if (sp == null && prev) {
                if (prev.spRating != null) sp = prev.spRating;
                if (prev.spRank != null) spRank = prev.spRank;
            }
        }
        var rank = null;
        if (recruiting && recruiting.length) {
            var r = recruiting.filter(o => o.team == t.school || (t.alternateNames || []).includes(o.team))[0];
            if (r) rank = r.rank;
        }
        return { id: t.id, name: t.school, logo: (t.logos || []).at(-1), conf, score, xwins, rank, sp, spRank, scoreYear: prev ? prev.season : null };
    });
    var xw = pool.map(p => p.xwins).filter(v => v > 0);
    xwMin = xw.length ? Math.min(...xw) : 0;
    xwMax = xw.length ? Math.max(...xw) : 0;

    // Once SP+ is populated (enrichment job has run), default the draft sort to
    // it — a truer team-strength signal than recruiting/xWins.
    if (pool.some(p => p.sp != null)) poolSort = { key: 'sp', dir: -1 };
}

function barWidth(x) {
    if (!x || x <= 0) return 0;
    if (xwMax === xwMin) return 100;
    return 15 + ((x - xwMin) / (xwMax - xwMin)) * 85;
}

// Color the bar by win total: red (weak) -> gold -> lime -> green (elite).
function barColor(x) {
    if (x >= 9.5) return '#5bbf79';
    if (x >= 7.5) return '#a3d977';
    if (x >= 5.5) return '#e6b34d';
    return '#e06b6b';
}

function populateConfFilter() {
    var sel = document.getElementById('poolConf');
    if (!sel) return;
    [...new Set(pool.map(p => p.conf))].filter(c => c && c !== '-').sort().forEach(c => {
        var o = document.createElement('option');
        o.value = c; o.textContent = c;
        sel.appendChild(o);
    });
}

function sortVal(p, k) {
    if (k === 'name') return p.name.toLowerCase();
    if (k === 'conf') return (p.conf || '').toLowerCase();
    if (k === 'rank') return p.rank == null ? 999 : p.rank;
    if (k === 'score') return p.score == null ? -1 : p.score;
    if (k === 'xwins') return p.xwins == null ? -1 : p.xwins;
    if (k === 'sp') return p.sp == null ? -Infinity : p.sp;   // higher SP+ = better
    return 0;
}

function sortPool(key) {
    if (poolSort.key === key) {
        poolSort.dir *= -1;
    } else {
        poolSort.key = key;
        // Names/conference/recruiting read best ascending; stats descending.
        poolSort.dir = (key === 'name' || key === 'conf' || key === 'rank') ? 1 : -1;
    }
    renderPool();
}

function renderPool() {
    var body = document.querySelector('[user-table-body]');
    if (!body) return;

    var draftedIds = new Set((draft && draft.picks ? draft.picks : []).map(p => String(p.team.id)));
    var oc = (draft && draft.onTheClock) || {};
    var canAct = draft && draft.status === 'active' && (String(oc.userId) === String(myUserId) || isCommish);

    var q = (document.getElementById('poolSearch').value || '').toLowerCase();
    var cf = document.getElementById('poolConf').value;
    var showD = document.getElementById('showDrafted').checked;

    var rows = pool.filter(p => {
        var drafted = draftedIds.has(String(p.id));
        if (drafted && !showD) return false;
        if (cf && p.conf !== cf) return false;
        if (q && !(p.name.toLowerCase().includes(q) || (p.conf || '').toLowerCase().includes(q))) return false;
        return true;
    });
    var k = poolSort.key, dir = poolSort.dir;
    rows.sort((a, b) => { var av = sortVal(a, k), bv = sortVal(b, k); return (av < bv ? -1 : av > bv ? 1 : 0) * dir; });

    var cols = [['name', 'Team'], ['conf', 'Conference'], ['sp', 'SP+'], ['rank', 'Recruiting'], ['score', 'Last Season'], ['xwins', 'xWins'], ['draft', '']];
    document.getElementById('pool-head').innerHTML = cols.map(([key, label]) => {
        var numCls = (key === 'rank' || key === 'score' || key === 'xwins' || key === 'sp') ? 'num' : '';
        var sorted = key === poolSort.key;
        var arrow = key === 'draft' ? '' : `<span class="arrow">${sorted ? (poolSort.dir < 0 ? '▼' : '▲') : '↕'}</span>`;
        var onclick = key === 'draft' ? '' : `onclick="sortPool('${key}')"`;
        return `<th class="${numCls} ${sorted ? 'sorted' : ''}" ${onclick}>${label}${arrow}</th>`;
    }).join('');

    body.innerHTML = rows.map(p => {
        var drafted = draftedIds.has(String(p.id));
        var badge = p.rank == null ? '<span class="muted">—</span>' : `<span class="rank-badge ${p.rank <= 10 ? 'top10' : p.rank <= 25 ? 'top25' : ''}">#${p.rank}</span>`;
        var bw = barWidth(p.xwins);
        var action = drafted
            ? '<span class="drafted-chip">Drafted</span>'
            : `<button class="draft-pick-btn" onclick="makePick(${p.id})" ${canAct ? '' : 'disabled'}>Draft</button>`;
        var spCell = p.spRank == null
            ? '<span class="muted">—</span>'
            : `<span class="sp-badge" title="SP+ rating ${p.sp}">#${p.spRank}</span>`;
        return `<tr class="${drafted ? 'drafted' : ''}">
            <td><a class="team-link" href="/team?team=${p.id}" target="_blank" rel="noopener"><span class="team-cell"><img src="${p.logo}" alt="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span></a></td>
            <td>${escapeHtml(p.conf)}</td>
            <td class="num">${spCell}</td>
            <td class="num">${badge}</td>
            <td class="num">${p.score == null ? '-' : p.score}</td>
            <td class="num"><span class="xwins-wrap">${p.xwins || '-'}<span class="xwins-bar"><span class="xwins-fill" style="width:${bw}%;background:${barColor(p.xwins)}"></span></span></span></td>
            <td class="num">${action}</td>
        </tr>`;
    }).join('');

    // Mobile card list (CSS shows this instead of the table at <=768px). Built
    // from the same filtered/sorted rows so search/filter/sort stay in sync.
    var cardsEl = document.getElementById('pool-cards');
    if (cardsEl) {
        cardsEl.innerHTML = rows.map(p => {
            var drafted = draftedIds.has(String(p.id));
            // Labelled "Rec" so it's clearly the recruiting-class rank, not a
            // team-strength ranking (e.g. recruiting has Arkansas above Kentucky).
            var badge = p.rank == null ? '' : `<span class="rank-badge ${p.rank <= 10 ? 'top10' : p.rank <= 25 ? 'top25' : ''}">Rec #${p.rank}</span>`;
            var action = drafted
                ? '<span class="drafted-chip">Drafted</span>'
                : `<button class="draft-pick-btn card-draft" onclick="makePick(${p.id})" ${canAct ? '' : 'disabled'}>Draft</button>`;
            var cl = conferenceLogo(p.conf);
            var confHtml = cl
                ? `<img class="pc-conf-logo" src="${cl}" alt="${escapeHtml(p.conf)}" title="${escapeHtml(p.conf)}">`
                : `<span class="pc-conf">${escapeHtml(p.conf)}</span>`;
            var ptsLabel = p.scoreYear ? `'${String(p.scoreYear).slice(-2)} pts` : 'pts';
            return `<div class="pool-card${drafted ? ' drafted' : ''}">
                ${action}
                <div class="pool-card-main">
                    <a class="team-link" href="/team?team=${p.id}" target="_blank" rel="noopener"><span class="team-cell"><img src="${p.logo}" alt="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span></a>
                    <span class="pool-card-meta">${confHtml}${badge}</span>
                </div>
                <div class="pool-card-stats">
                    ${p.spRank != null ? `<span title="SP+ rating ${p.sp}"><b>#${p.spRank}</b><small>SP+</small></span>` : ''}
                    <span><b>${p.xwins || '-'}</b><small>xWins</small></span>
                    <span><b>${p.score == null ? '-' : p.score}</b><small>${ptsLabel}</small></span>
                </div>
            </div>`;
        }).join('');
    }

    var avail = pool.filter(p => !draftedIds.has(String(p.id))).length;
    document.getElementById('poolCount').textContent = `${rows.length} shown · ${avail} available`;
}

/////////////////////////////////////////////////////
//////////////////// Live Socket /////////////////////
/////////////////////////////////////////////////////

async function connectSocket() {
    try {
        const res = await fetch('/draft-token', { headers: { 'Accept': 'application/json' } });
        const { token } = await res.json();
        socket = io({ auth: { token } });

        // Fires on the initial connect AND every reconnect, so a dropped
        // connection auto-rejoins and re-syncs the latest state.
        socket.on('connect', () => socket.emit('join-draft', { league: leagueCode, season }));
        socket.on('disconnect', (reason) => {
            if (reason !== 'io client disconnect') {
                failToast.options.text = 'Connection lost — reconnecting…';
                failToast.showToast();
            }
        });
        socket.io.on('reconnect', () => {
            successToast.options.text = 'Reconnected';
            successToast.showToast();
        });
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
    // Mark this pick's board cell so renderBoard animates just it (once).
    justPickedKey = String(pick.userId) + '-' + pick.round;
    renderAll();
    // No per-pick toast — the board pick-reveal and the ticker already show it.
    // Celebrate your own pick with a short confetti burst in white + the
    // drafted team's colour.
    if (String(pick.userId) === String(myUserId) && !ccReduced() && typeof startConfetti === 'function') {
        var tc = pick.team && pick.team.color;
        if (tc && tc.charAt(0) !== '#') tc = '#' + tc;
        startConfetti(tc ? ['#ffffff', tc] : undefined);
        setTimeout(function () { if (typeof stopConfetti === 'function') stopConfetti(); }, 2500);
    }
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

function undoPick() {
    if (socket) socket.emit('undo-pick', { league: leagueCode, season });
}

/////////////////////////////////////////////////////
/////////////////////// Render ///////////////////////
/////////////////////////////////////////////////////

function renderAll() {
    renderStatus();
    renderBoard();
    renderTicker();
    renderOnTheClock();
    renderPool();
    renderGrades();
}

// Immediate post-draft report card: once the draft is complete, fetch the
// preseason grades and render the shared cards (highlighting the viewer). Fetch
// once per completed draft to avoid re-hitting the endpoint on every re-render.
var gradesRenderedFor = null;
function renderGrades() {
    var el = document.getElementById('draft-grades-panel');
    if (!el) return;
    if (!draft || draft.status !== 'complete') { el.style.display = 'none'; return; }
    el.style.display = '';
    var key = leagueCode + ':' + season;
    if (gradesRenderedFor === key) return;
    gradesRenderedFor = key;
    fetch('/draft/grades/' + encodeURIComponent(leagueCode) + '/' + encodeURIComponent(season), { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (typeof renderDraftGrades === 'function') {
                renderDraftGrades(el, data, {
                    currentUserId: myUserId,
                    title: 'Draft Grades',
                    note: 'Instant, preseason grades — projected fantasy points in this league’s scoring (schedule + SP+ win odds + market CFP odds). Each draft graded on its own merit.'
                });
            }
        })
        .catch(function (e) { gradesRenderedFor = null; console.error('grades load failed:', e); });
}

// Scrolling ribbon of every pick, in draft order (pick #1 → most recent).
function renderTicker() {
    var el = document.getElementById('pick-ticker');
    if (!el) return;
    if (!draft || !draft.picks || !draft.picks.length ||
        (draft.status !== 'active' && draft.status !== 'complete')) {
        el.innerHTML = '';
        return;
    }
    // Chronological order (defensive sort in case picks aren't stored ordered).
    var ordered = draft.picks.slice().sort(function (a, b) { return (a.overall || 0) - (b.overall || 0); });
    var chips = ordered.map(function (p) {
        var logo = (p.team.logos && p.team.logos.length) ? p.team.logos.at(-1) : '';
        return `<a class="pick-chip" href="/team?team=${p.team.id}" target="_blank" rel="noopener"><span class="pk">#${p.overall}</span>`
            + `<img src="${logo}" alt="">${escapeHtml(p.team.school)}</a>`;
    }).join('');
    // Only loop-scroll when there are enough picks to overflow and motion is OK.
    // Duration scales with pick count (~2s per chip) so the on-screen speed
    // stays constant as the draft grows. The track is duplicated so a -50%
    // translate loops seamlessly.
    var scroll = !ccReduced() && ordered.length > 5;
    var durStyle = scroll ? ` style="animation-duration:${Math.max(12, ordered.length * 2)}s"` : '';
    el.innerHTML = `<div class="pick-ticker-track${scroll ? ' scroll' : ''}"${durStyle}>${scroll ? chips + chips : chips}</div>`;
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
        var undoBtn = (isCommish && draft.picks && draft.picks.length)
            ? `<button type="button" class="draft-undo-btn" onclick="undoPick()">&#8617; Undo last pick</button>` : '';
        el.innerHTML = `<p class="draft-live-label">🟢 Draft in progress</p>${undoBtn}`;
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
        bodyStr += '<tr>';
        // Avatar only (name in the tooltip) to save horizontal space.
        bodyStr += `<td class="draft-board-name" title="${escapeHtml(managerDisplay(userId))}">${memberAvatar(userId)}</td>`;
        for (var round = 1; round <= draft.totalRounds; round++) {
            var pick = draft.picks.find(p => String(p.userId) === String(userId) && p.round === round);
            var isClock = onClock.userId === String(userId) && onClock.round === round;
            var cls = isClock ? 'draft-board-cell on-clock-cell' : 'draft-board-cell';
            if (pick) {
                var freshCls = (justPickedKey === String(userId) + '-' + round) ? ' just-picked' : '';
                bodyStr += `<td class="${cls}${freshCls}"><a href="/team?team=${pick.team.id}" target="_blank" rel="noopener" title="${escapeHtml(pick.team.school)}"><img src="${pick.team.logos ? pick.team.logos.at(-1) : ''}" alt="${escapeHtml(pick.team.school)}"></a></td>`;
            } else {
                bodyStr += `<td class="${cls}"></td>`;
            }
        }
        bodyStr += '</tr>';
    });
    body.innerHTML = bodyStr;
    justPickedKey = null;   // consumed — don't re-animate on the next render
}

function renderOnTheClock() {
    var el = document.getElementById('on-the-clock');
    if (!draft || draft.status !== 'active' || !draft.onTheClock) { el.innerHTML = ''; el.classList.remove('your-turn'); return; }
    var oc = draft.onTheClock;
    var mine = String(oc.userId) === String(myUserId);
    // .your-turn drives the urgency pulse in CSS (only when it's you).
    el.classList.toggle('your-turn', mine);
    if (mine) {
        el.innerHTML = `<span class="you-are-up">🟢 You're on the clock! — Round ${oc.round}, Pick #${oc.overall}</span>`;
    } else {
        // Show the manager's team/franchise name (falls back to their name).
        el.innerHTML = `<span>On the clock: <strong>${escapeHtml(managerDisplay(oc.userId))}</strong> — Round ${oc.round}, Pick #${oc.overall}</span>`;
    }
}

/////////////////////////////////////////////////////
//////////////////// Helpers /////////////////////////
/////////////////////////////////////////////////////

// The navbar owns the "My team" link + userId caching (views/partials/navbar.ejs).

// successToast / failToast are shared globals defined in public/toast.js
// (loaded by the navbar partial). Set .options.text then call .showToast().

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
