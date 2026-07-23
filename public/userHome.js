var weekCode;
var userData;
var isMobile;

// Escapes HTML special chars before interpolating values into innerHTML.
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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

        if (userState.user_metadata.roles?.at(-1) == 'Admin') {
            const leagueCode = window.localStorage.getItem("leagueCode");

            if (leagueCode && (leagueCode != "undefined")) {
                const currentSelectedLeague = window.sessionStorage.getItem("league");
                if (currentSelectedLeague) {
                    $("#dropdownMenuButton").text(currentSelectedLeague);
                }
            }
        }    

        getUser();
    });
}

window.onload = function() {
    // The navbar partial (views/partials/navbar.ejs) owns its hamburger and the
    // "My team" link + userId caching.
    detectMobile();
    getUserProfile();
};

if ($(".dropdown-menu-week")) {
    $(".dropdown-menu-week a").click(function(){
        $(this).parents(".dropdownWeek").find('.btn').html($(this).text());
        $(this).parents(".dropdownWeek").find('.btn').val($(this).attr('value'));
        var selectedWeek = $("#dropdownMenuButtonWeek").text();
        var selectedWeekCode = $("#dropdownMenuButtonWeek").val();
        window.localStorage.setItem("week", selectedWeek);
        window.localStorage.setItem("weekCode", selectedWeekCode);

        document.querySelector('.football-loader').style.display = "flex";
        document.querySelector('[schedule-body]').style.display = "none";
        displaySchedule(userData);
    });
}

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
        userData = data[0];
        renderHero(data[0]);
        displayTeams(data[0]);
        renderProfileChart(data[0]);
        ensureWeekSelected(data[0]);
        displaySchedule(data[0]);
        loadHomeGrades(data[0]);
    });
}

// Draft grade on the profile: just THIS manager's own most-recent-season card,
// surfaced as a color-coded chip in the hero that expands the detail on demand.
// Preseason blend of roster strength + draft value (see modules/draft-grades.js).
async function loadHomeGrades(user) {
    const el = document.getElementById('uh-grades');
    const chip = document.querySelector('[profile-grade-chip]');
    if (!el || !chip || !user || !user.league || !(user.seasons || []).length) return;
    const season = user.seasons.at(-1).season;
    try {
        const res = await fetch('/draft/grades/' + encodeURIComponent(user.league) + '/' + encodeURIComponent(season), {
            headers: { 'Accept': 'application/json' }
        });
        const data = await res.json();
        // Show only the profile owner's card; hide the chip entirely if this
        // manager didn't draft that season.
        const mine = (data.managers || []).find(m => String(m.userId) === String(user._id));
        if (!mine) return;   // chip stays hidden

        const tier = (mine.grade || '').charAt(0).toLowerCase();
        chip.classList.add('gg-tier-' + tier);
        document.querySelector('[profile-grade-letter]').textContent = mine.grade;
        chip.hidden = false;

        // "you" tag keys off the logged-in viewer, not the profile owner, so it
        // only appears when you're looking at your own profile.
        let me;
        try { me = userState.user_metadata.metadata.userId; } catch (e) { /* fall through */ }
        me = me || window.localStorage.getItem('userId') || user._id;
        if (typeof renderDraftGradeCard === 'function') {
            renderDraftGradeCard(el, mine, {
                currentUserId: me,
                note: season + ' preseason grade — projected fantasy points in your league’s scoring (schedule + SP+ win odds + market CFP odds). Each draft graded on its own merit.'
            });
        }
        // Reveal the panel but keep it collapsed via CSS max-height, so the
        // first expand animates (display:none can't transition).
        el.hidden = false;

        // Chip toggles the detail panel (collapsed by default).
        if (!chip.dataset.wired) {
            chip.dataset.wired = '1';
            chip.addEventListener('click', () => {
                const open = el.classList.toggle('is-open');
                chip.setAttribute('aria-expanded', String(open));
            });
        }
    } catch (e) {
        console.error('home grades failed:', e);
    }
}

// The Games week defaults to the latest played week when nothing is stored,
// so the dropdown never shows the literal "Week X" placeholder (and
// displaySchedule never reads a null weekCode) on a fresh visit.
function ensureWeekSelected(data) {
    if (window.localStorage.getItem('weekCode') && window.localStorage.getItem('week')) return;
    const weekly = (data.seasons.at(-1) || {}).weeklyScore || [];
    let maxWeek = 0, hasPost = false;
    weekly.forEach(w => {
        if (w.season === 'postseason' || w.week > 16) hasPost = true;
        else if (w.week > maxWeek) maxWeek = w.week;
    });
    let code = 'week-1', label = 'Week 1';
    if (hasPost) { code = 'week-17'; label = 'Postseason'; }
    else if (maxWeek > 0) { code = 'week-' + maxWeek; label = 'Week ' + maxWeek; }
    window.localStorage.setItem('weekCode', code);
    window.localStorage.setItem('week', label);
    weekCode = code;
    $('#dropdownMenuButtonWeek').text(label);
}
// ---------- Profile hero ----------

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function initials(data) {
    return (((data.firstName || '')[0] || '') + ((data.lastName || '')[0] || '')).toUpperCase();
}

// Stable color for the initials avatar: the user's stored color if any, else a
// hue hashed from their name so each manager gets a consistent shade.
function colorFor(data) {
    if (data.color) return data.color;
    const s = (data.firstName || '') + (data.lastName || '');
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360}, 45%, 45%)`;
}

// Deliver the avatar as a face-centered 256px square (Cloudinary transformation
// inserted into the stored delivery URL).
function cloudinaryAvatar(url) {
    if (typeof url === 'string' && url.indexOf('/upload/') !== -1) {
        return url.replace('/upload/', '/upload/c_fill,g_face,w_256,h_256,q_auto,f_auto/');
    }
    return url;
}

function renderAvatar(el, data) {
    if (!el) return;
    el.innerHTML = '';
    if (data.avatarUrl) {
        const img = document.createElement('img');
        img.src = cloudinaryAvatar(data.avatarUrl);
        img.alt = '';
        el.style.background = 'transparent';
        el.appendChild(img);
    } else {
        el.textContent = initials(data) || '?';
        el.style.background = colorFor(data);
    }
}

// Highest-scoring team on the roster this season (summed from scoreByTeam).
function bestTeam(season) {
    const weekly = season.weeklyScore || [];
    let best = null;
    (season.teams || []).forEach(t => {
        let total = 0;
        weekly.forEach(w => (w.scoreByTeam || []).forEach(st => { if (st.team === t.school) total += (st.score || 0); }));
        if (!best || total > best.total) best = { team: t, total };
    });
    return best;
}

// League rank for the profile user, by current-season cumulative score.
async function computeRank(data) {
    try {
        if (!data.league) return null;
        const res = await fetch(`/users/league/${data.league}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const users = await res.json();
        const ranked = users
            .map(u => ({ id: u._id, score: (u.seasons && u.seasons[0] && u.seasons[0].cumulativeScore) || 0 }))
            .sort((a, b) => b.score - a.score);
        const idx = ranked.findIndex(r => r.id === data._id);
        return idx < 0 ? null : { rank: idx + 1, total: ranked.length };
    } catch (e) { return null; }
}

function statTile(valueHtml, label) {
    return `<div class="stat"><span class="stat-value">${valueHtml}</span><span class="stat-label">${escapeHtml(label)}</span></div>`;
}

// The logged-in user's own id (from the Auth0 session), used to decide whether
// to show the Edit control.
function currentUserId() {
    try { return (userState.user_metadata.metadata.userId) || window.localStorage.getItem('userId'); }
    catch (e) { return window.localStorage.getItem('userId'); }
}

async function renderHero(data) {
    const season = data.seasons.at(-1) || {};
    const manager = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    const franchise = season.franchiseName;

    document.querySelector('[profile-franchise]').textContent = franchise || `${data.firstName || 'Unnamed'}'s Team`;
    document.querySelector('[profile-manager]').textContent = franchise ? `Managed by ${manager}` : manager;
    document.title = `${franchise || manager} · Campus Clash`;
    renderAvatar(document.querySelector('[profile-avatar]'), data);

    const statsEl = document.querySelector('[profile-stats]');
    let html = '';
    const rank = await computeRank(data);
    if (rank) html += statTile(escapeHtml(ordinal(rank.rank)), `of ${rank.total} teams`);
    html += statTile(String(season.cumulativeScore || 0), 'Total points');
    const bt = bestTeam(season);
    if (bt && bt.total > 0) {
        html += statTile(`<img src="${bt.team.logos.at(-1)}" alt="">${bt.total}`, `Best: ${bt.team.school}`);
    }
    statsEl.innerHTML = html;

    // Edit is only offered on the viewer's own profile (the endpoint enforces
    // this too, from the session).
    if (currentUserId() && String(currentUserId()) === String(data._id)) {
        setupEditModal(data, season);
    }
}

// ---------- Edit modal (franchise name + avatar upload) ----------

function setupEditModal(data, season) {
    const btn = document.querySelector('[edit-profile-btn]');
    const modal = document.querySelector('[profile-modal]');
    const nameInput = document.querySelector('[profile-name-input]');
    const modalAvatar = document.querySelector('[profile-modal-avatar]');
    const fileInput = document.querySelector('[profile-file-input]');
    const uploadBtn = document.querySelector('[profile-upload-btn]');
    const status = document.querySelector('[profile-upload-status]');
    const errorEl = document.querySelector('[profile-modal-error]');
    const saveBtn = document.querySelector('[profile-save-btn]');
    const cancelBtn = document.querySelector('[profile-cancel-btn]');
    if (!btn || !modal || btn.dataset.wired) return;
    btn.dataset.wired = '1';
    btn.hidden = false;

    let pendingAvatar; // undefined = unchanged; string/null = new value to save

    const cloudinaryReady = !!(CLOUDINARY && CLOUDINARY.cloudName && CLOUDINARY.uploadPreset);

    function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

    function open() {
        pendingAvatar = undefined;
        nameInput.value = season.franchiseName || '';
        renderAvatar(modalAvatar, data);
        showError('');
        // Set the upload control's state every open so a missing Cloudinary
        // config surfaces a persistent reason rather than a silently-dead button.
        uploadBtn.disabled = !cloudinaryReady;
        status.textContent = cloudinaryReady ? '' : 'Photo upload unavailable';
        modal.hidden = false;
    }
    function close() { modal.hidden = true; }

    btn.addEventListener('click', open);
    cancelBtn.addEventListener('click', close);

    // Arriving from the first-login onboarding nudge opens the editor straight away.
    if (new URLSearchParams(window.location.search).get('setup') === '1') open();
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });

    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        showError('');
        status.textContent = 'Uploading…';
        uploadBtn.disabled = true;
        try {
            const form = new FormData();
            form.append('file', file);
            form.append('upload_preset', CLOUDINARY.uploadPreset);
            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method: 'POST', body: form });
            if (!res.ok) throw new Error('Upload failed');
            const out = await res.json();
            pendingAvatar = out.secure_url;
            renderAvatar(modalAvatar, { avatarUrl: pendingAvatar });
            status.textContent = 'Photo ready — click Save';
        } catch (e) {
            status.textContent = '';
            showError('Upload failed. Try a different image.');
        } finally {
            uploadBtn.disabled = !cloudinaryReady;
            fileInput.value = '';
        }
    });

    saveBtn.addEventListener('click', async () => {
        showError('');
        saveBtn.disabled = true;
        const body = { franchiseName: nameInput.value };
        if (pendingAvatar !== undefined) body.avatarUrl = pendingAvatar;
        try {
            const res = await fetch('/users/me/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const out = await res.json();
            if (!res.ok) throw new Error(out.message || 'Save failed');
            data.avatarUrl = out.avatarUrl;
            season.franchiseName = out.franchiseName;
            renderHero(data);
            close();
        } catch (e) {
            showError(e.message || 'Save failed.');
        } finally {
            saveBtn.disabled = false;
        }
    });
}

// Column model for the weekly table. Each entry is mapped to its real week
// (regular weeks by number, postseason folded into one column) rather than by
// array position, so scores never land under the wrong header. Only weeks that
// have actually been played are included (plus Postseason once it exists), so
// the table isn't padded out with a wall of empty future columns — which also
// keeps it far narrower on mobile.
function weeklyColumns(season) {
    const weekly = (season && season.weeklyScore) || [];
    const isPost = (w) => w.season === 'postseason' || w.week > 16;

    const regularByWeek = {};
    let maxWeek = 0;
    weekly.forEach(w => { if (!isPost(w)) { regularByWeek[w.week] = w; if (w.week > maxWeek) maxWeek = w.week; } });

    // Fold any/all postseason entries into a single synthetic column.
    const postEntries = weekly.filter(isPost);
    let postseason = null;
    if (postEntries.length) {
        postseason = {
            score: postEntries.reduce((s, w) => s + (w.score || 0), 0),
            scoreByTeam: postEntries.flatMap(w => w.scoreByTeam || [])
        };
    }

    const columns = [];
    for (let wk = 1; wk <= maxWeek; wk++) {
        columns.push({ label: String(wk), ariaLabel: 'Week ' + wk, entry: regularByWeek[wk] || null });
    }
    if (postseason) columns.push({ label: 'Post&shy;season', ariaLabel: 'Postseason', entry: postseason });
    return columns;
}

// The points a team banked in one column (bye / not yet played -> null).
function columnTeamScore(entry, teamSchool) {
    if (!entry) return null;
    const games = (entry.scoreByTeam || []).filter(o => o.team === teamSchool);
    if (!games.length) return null;
    return games.reduce((s, g) => s + (g.score || 0), 0);
}

function displayTeams(data) {
    const head = document.querySelector('[user-table-head]');
    const body = document.querySelector('[user-table-body]');
    const season = data.seasons.at(-1) || {};
    const teams = season.teams || [];
    const columns = weeklyColumns(season);

    // Header (generated so it always matches the columns actually shown, and so
    // the week numbers carry an accessible "Week N" label for screen readers).
    let headHtml = '<tr><th class="sticky-header team-header" scope="col">Team</th>';
    columns.forEach(c => {
        headHtml += `<th class="team-header" scope="col" aria-label="${c.ariaLabel}">${c.label}</th>`;
    });
    headHtml += '<th class="sticky-header-score team-header" scope="col">Team Score</th></tr>';
    if (head) head.innerHTML = headHtml;

    // Highlight the season's best single team-game and best week (top weekly
    // total) — the standout cells, tie-inclusive.
    let bestGame = 0;
    teams.forEach(t => columns.forEach(c => { const s = columnTeamScore(c.entry, t.school); if (s != null && s > bestGame) bestGame = s; }));
    let bestWeek = 0;
    columns.forEach(c => { if (c.entry && (c.entry.score || 0) > bestWeek) bestWeek = c.entry.score || 0; });

    let str = '';
    teams.forEach(team => {
        let totalScore = 0;
        let cells = '';
        columns.forEach(c => {
            const s = columnTeamScore(c.entry, team.school);
            if (!c.entry) { cells += '<td class="cell-future"></td>'; return; }   // week not played yet
            if (s == null) { cells += '<td class="cell-bye">–</td>'; return; }    // bye / no game
            totalScore += s;
            const best = (s === bestGame && s > 0) ? ' cell-best' : '';
            cells += `<td class="${best}">${s}</td>`;
        });
        const refLink = `/team?team=${team.id}`;
        str += '<tr><th class="team-header sticky-header" scope="row">'
            + '<a href="' + refLink + '"><img src="' + team.logos.at(-1) + '" alt="' + escapeHtml(team.mascot) + '">'
            + escapeHtml(team.school) + '</a></th>'
            + cells
            + '<th class="sticky-header-score">' + totalScore + '</th></tr>';
    });

    // Cumulative row: the whole-week total per column, best week highlighted.
    str += '<tr class="cumulative-row"><th class="team-header sticky-header" scope="row">Cumulative Score</th>';
    columns.forEach(c => {
        if (!c.entry) { str += '<td class="cell-future"></td>'; return; }
        const v = c.entry.score || 0;
        const best = (v === bestWeek && v > 0) ? ' cell-best' : '';
        str += `<td class="${best}">${v}</td>`;
    });
    str += '<th class="sticky-header-score">' + (season.cumulativeScore || 0) + '</th></tr>';

    body.innerHTML = str;
}

// Cumulative-points-over-the-season line chart for this manager. Hidden until
// there are at least two scored weeks (a single point isn't a trend).
let profileChart = null;
function renderProfileChart(data) {
    const section = document.querySelector('[profile-chart-section]');
    const canvas = document.getElementById('profile-chart');
    if (!section || !canvas || typeof Chart === 'undefined') return;

    const season = data.seasons.at(-1) || {};
    const cols = weeklyColumns(season);
    let cum = 0;
    const labels = [], points = [];
    cols.forEach(c => {
        if (!c.entry) return;   // skip any unplayed gap
        cum += c.entry.score || 0;
        labels.push(c.ariaLabel === 'Postseason' ? 'Post' : c.ariaLabel.replace('Week', 'Wk'));
        points.push(cum);
    });

    if (points.length < 2) { section.hidden = true; return; }
    section.hidden = false;
    if (profileChart) profileChart.destroy();
    profileChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Cumulative points', data: points,
                borderColor: '#8E8CF0', backgroundColor: 'rgba(142,140,240,0.15)',
                fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#8E8CF0'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { intersect: false, mode: 'index' } },
            scales: {
                x: { grid: { color: '#2A2E42' }, ticks: { color: '#A4A9C2' } },
                y: { beginAtZero: true, grid: { color: '#2A2E42' }, ticks: { color: '#A4A9C2' } }
            }
        }
    });
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

async function getRankings (week, seasonType, seasonYear) {
    // seasonYear is the league's active season (from the user's roster), NOT the
    // wall-clock year — otherwise, once the calendar rolls past the season (e.g.
    // viewing the 2025 season in 2026, or bowl games in January), this fetches a
    // year with no rankings and returns nothing.
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
        weekRankings = rankings.find(r => r.week == '16' && r.season == seasonYear)?.polls?.find(p => p.poll == pollName)?.ranks || [];
    }

    // Always hand back an array so callers can safely call .findIndex even when
    // the requested week/season has no rankings loaded.
    return Array.isArray(weekRankings) ? weekRankings : [];
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

async function getAllBettingLines (seasonYear) {
    // Same as getRankings: use the league's active season, not the wall-clock
    // year, so betting lines are fetched for the season actually being viewed.
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
// (teamId, gameId) anywhere in the season's weeklyScore. This avoids the old
// weeklyScore[gameWeek - 1] index math — which broke for the postseason bucket
// (gameWeek "17" indexed slot 16, which only lines up by coincidence) — and
// safely returns 0 when the game hasn't been scored yet instead of throwing.
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

// Fetch every team logo the week's games need in ONE request, returning a
// { teamId: <img html> } map. Replaces the old per-game POST to
// /teams/teamLogos (one round-trip per game); missing teams fall back to the
// helmet icon at lookup time.
async function batchTeamLogos(games) {
    const ids = [...new Set((games || []).flatMap(g => [g.awayId, g.homeId]))];
    const map = {};
    if (!ids.length) return map;
    try {
        const res = await fetch('/teams/teamLogos', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ teams: ids })
        });
        if (res.status === 200) {
            (await res.json()).forEach(t => {
                if (t && t.logos && t.logos.length) map[t.id] = '<img src="' + t.logos.at(-1) + '" style="padding-right: 5px;">';
            });
        }
    } catch (e) { /* fall back to helmet icons */ }
    return map;
}
function logoHtmlFromMap(map, teamId) {
    return map[teamId] || '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';
}

// Formats a kickoff time like "7:30PM" from a game's start date.
function kickoffTime(date) {
    const mil = date.toString().substring(16, 21);
    const [h, m] = mil.split(':');
    const hours = parseInt(h);
    if (hours < 12) return hours + ':' + m + 'AM';
    if (hours == 12) return '12:' + m + 'PM';
    return (hours - 12) + ':' + m + 'PM';
}

// Builds one game card. The green "+N" badge shows the fantasy points a
// ROSTERED team earned in this game (from the season's weeklyScore) and only
// when that's > 0 — so a team that earned nothing (or isn't yours) shows no
// badge, while your teams stay identifiable by their bold name. The caret
// marks the winner, independent of the badge. This reads the same per-game
// values the weekly table uses, so there's no league-specific special-casing.
function buildGameCard(game, rosteredIds, logoMap, rankingsInfo, allBettingLines) {
    const rankOf = (school) => {
        const i = rankingsInfo.findIndex(e => e.school === school);
        return i > -1 ? rankingsInfo[i].rank : '';
    };
    const rankHtml = (r) => `<p style="display: inline; padding-right: 5px; color: #A4A9C2;">${r}</p>`;

    // Betting spread (formattedSpread names the favored team + line).
    const lines = allBettingLines.find(b => b.homeTeam == game.homeTeam && b.awayTeam == game.awayTeam)?.lines;
    const chosen = lines && (lines.find(l => l.provider == 'DraftKings') || lines[0]);
    const parts = chosen?.formattedSpread?.split('-');
    let awayLine = '', homeLine = '';
    if (parts) {
        awayLine = (parts[0]?.trim() == game.awayTeam) ? parts.at(-1) : '';
        homeLine = (parts[0]?.trim() == game.homeTeam) ? parts.at(-1) : '';
    }
    const lineHtml = (v) => `<span class="betting-line">${v ? '-' + v : ''}</span>`;

    const awayRostered = rosteredIds.has(game.awayId);
    const homeRostered = rosteredIds.has(game.homeId);
    const nameHtml = (id, name, rostered) =>
        `<a href="/team?team=${id}">${rostered ? '<strong>' + name + '</strong>' : name}</a>`;

    const awayCol = logoHtmlFromMap(logoMap, game.awayId) + rankHtml(rankOf(game.awayTeam)) + nameHtml(game.awayId, game.awayTeam, awayRostered) + lineHtml(awayLine);
    const homeCol = logoHtmlFromMap(logoMap, game.homeId) + rankHtml(rankOf(game.homeTeam)) + nameHtml(game.homeId, game.homeTeam, homeRostered) + lineHtml(homeLine);

    // A rostered team's points for this game -> a green badge cell, or '' at 0.
    const badgeCell = (id, rostered) => {
        if (!rostered) return '';
        const pts = teamGameScoreById(userData.seasons.at(-1).weeklyScore, id, game.id);
        return pts > 0 ? `<td class="score-added"><strong style="color: #22C37A;">+${pts}</strong></td>` : '';
    };
    const caret = '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i>';

    let awayScore, homeScore;
    if (game.completed) {
        const awayWon = game.awayPoints > game.homePoints;
        const homeWon = game.homePoints > game.awayPoints;
        awayScore = (game.awayPoints ?? 0) + (awayWon ? caret : '') + '</td>' + badgeCell(game.awayId, awayRostered);
        homeScore = (game.homePoints ?? 0) + (homeWon ? caret : '') + '</td>' + badgeCell(game.homeId, homeRostered);
    } else {
        const d = new Date(game.startDate);
        awayScore = d.toString().substring(4, 10) + '</td>';
        homeScore = (game.startTimeTbd ? 'TBD' : kickoffTime(d)) + '</td>';
    }

    return '<div class="game-card"><table class="game-table"><tbody><tr></tr>'
        + '<tr><td class="gc-team">' + awayCol + '</td><td class="gc-divider"></td><td class="gc-score">' + awayScore + '</tr>'
        + '<tr><td class="gc-team">' + homeCol + '</td><td class="gc-divider"></td><td class="gc-score">' + homeScore + '</tr>'
        + (game.outlet ? '<tr><td class="game-broadcast">📺 ' + game.outlet + '</td></tr>' : '')
        + '<tr><td class="game-notes">' + (game.notes || '') + '</td></tr>'
        + '</tbody></table></div>';
}

async function displaySchedule(data) {
    const scheduleContainer = document.querySelector('[schedule-body]');

    let week = window.localStorage.getItem('weekCode').substring(5);
    let seasonType = 'regular';
    let rankingsInfo;
    const seasonYear = data.seasons.at(-1).season;

    if (week == '17') {
        rankingsInfo = await getRankings((week - 1), seasonType, seasonYear);
        seasonType = 'postseason';
        week = 1;
    } else {
        rankingsInfo = await getRankings(week, seasonType, seasonYear);
    }

    const allBettingLines = await getAllBettingLines(seasonYear) || [];

    // Fetch each roster team's games in parallel, then all logos in one request.
    const teamsList = data.seasons.at(-1).teams;
    const rosteredIds = new Set(teamsList.map(t => t.id));
    const gamesPerTeam = await Promise.all(teamsList.map(t => getGame(seasonType, week, t)));

    // Dedup by game id (a game between two rostered teams comes back twice).
    const gamesById = new Map();
    gamesPerTeam.flat().forEach(g => { if (!gamesById.has(g.id)) gamesById.set(g.id, g); });
    const games = [...gamesById.values()];

    const logoMap = await batchTeamLogos(games);

    const cards = games
        .map(g => ({ startDate: g.startDate || '', html: buildGameCard(g, rosteredIds, logoMap, rankingsInfo, allBettingLines) }))
        .sort((a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0));

    if (cards.length) {
        scheduleContainer.innerHTML = cards.map(c => c.html).join('');
    } else {
        scheduleContainer.innerHTML = '<div id="no-games-container"></div>';
        showRandomNoGamesMessage();
    }

    document.querySelector('.football-loader').style.display = 'none';
    document.querySelector('[schedule-body]').style.display = 'flex';
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


// The navbar owns the "My team" link + userId caching (views/partials/navbar.ejs).