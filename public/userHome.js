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

    detectMobile();
    getUserProfile();
    setNavbarUserId();
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
        document.querySelector('.schedule-table').style.display = "none";
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
        displaySchedule(data[0]);
    });
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

// Column model for the weekly table: regular weeks 1-16 keyed by week number,
// plus one aggregated Postseason column. Building columns by week (rather than
// by array position) keeps each score under its correct header even when weeks
// are missing or a postseason entry is present — the old positional rendering
// dropped the postseason bonus into whatever column index it happened to land.
function weeklyColumns(season) {
    const weekly = (season && season.weeklyScore) || [];
    const isPost = (w) => w.season === 'postseason' || w.week > 16;

    const regularByWeek = {};
    weekly.forEach(w => { if (!isPost(w)) regularByWeek[w.week] = w; });

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
    for (let wk = 1; wk <= 16; wk++) columns.push(regularByWeek[wk] || null);
    columns.push(postseason);   // Postseason column (null until it exists)
    return columns;
}

function displayTeams(data) {
    const userTableBody = document.querySelector('[user-table-body]');
    const season = data.seasons.at(-1) || {};
    const columns = weeklyColumns(season);
    var str = '';

    (season.teams || []).forEach(team => {
        var totalScore = 0;
        var cells = '';

        columns.forEach(entry => {
            // No entry -> week hasn't been played yet (blank, not a scored 0).
            if (!entry) { cells += '<td class="cell-future"></td>'; return; }
            const games = (entry.scoreByTeam || []).filter(o => o.team === team.school);
            // Week was scored but this team had no game -> bye (muted dash).
            if (!games.length) { cells += '<td class="cell-bye">–</td>'; return; }
            const sum = games.reduce((s, g) => s + (g.score || 0), 0);
            totalScore += sum;
            cells += '<td>' + sum + '</td>';
        });

        const refLink = `/team?team=${team.id}`;
        str += '<tr><th class="team-header sticky-header">'
            + '<a href="' + refLink + '"><img src="' + team.logos.at(-1) + '" alt="' + escapeHtml(team.mascot) + '">'
            + escapeHtml(team.school) + '</a></th>'
            + cells
            + '<th class="sticky-header-score">' + totalScore + '</th></tr>';
    });

    // Cumulative row: the whole-week total per column.
    str += '<tr class="cumulative-row"><th class="team-header sticky-header">Cumulative Score</th>';
    columns.forEach(entry => {
        str += entry ? '<td>' + (entry.score || 0) + '</td>' : '<td class="cell-future"></td>';
    });
    str += '<th class="sticky-header-score">' + (season.cumulativeScore || 0) + '</th></tr>';

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

async function displaySchedule(data) {
    const scheduleContainer = document.querySelector('[schedule-body]');
    const leagueCode = window.localStorage.getItem("leagueCode");
    var str = '<tr>';
    var gameIds = [];
    var gameTables = [];

    var week = window.localStorage.getItem("weekCode").substring(5);
    var gameWeek;
    var seasonType = "regular";
    var rankingsInfo;

    // Resolve the year from the season being viewed (the user's latest roster),
    // the same source displayTeams uses — never the wall-clock year.
    var seasonYear = data.seasons.at(-1).season;

    if (week == "17") {
        rankingsInfo = await getRankings((week - 1), seasonType, seasonYear);

        seasonType = "postseason";
        week = 1;
        gameWeek = "17"
    } else {
        gameWeek = week;
        rankingsInfo = await getRankings(week, seasonType, seasonYear);
    }

    var allBettingLines = await getAllBettingLines(seasonYear) || [];

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

            var bettingLineObj = allBettingLines.find(bettingObj => bettingObj.homeTeam == game.homeTeam && bettingObj.awayTeam == game.awayTeam)?.lines;
            // A matchup may have no betting line (or none from DraftKings); guard
            // so a missing line renders blank instead of throwing.
            var chosenLine = bettingLineObj && (bettingLineObj.find(line => line.provider == "DraftKings") || bettingLineObj[0]);
            var bettingLine = chosenLine?.formattedSpread?.split("-");
            var awayLine = '';
            var homeLine = '';

            if (bettingLine) {
                awayLine = (bettingLine[0]?.trim() == game.awayTeam) ? bettingLine.at(-1) :  '';
                homeLine = (bettingLine[0]?.trim() == game.homeTeam) ? bettingLine.at(-1) :  '';
            }

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
                        awayTeam = `<a href="/team?team=${game.awayId}"><strong>` + game.awayTeam + '</strong></a>';
                        homeTeam = `<a href="/team?team=${game.homeId}"><strong>` + game.homeTeam + '</strong></a>';
                    } else {
                        awayTeam = `<a href="/team?team=${game.awayId}"><strong>` + game.awayTeam + '</strong></a>';
                        homeTeam = `<a href="/team?team=${game.homeId}">` + game.homeTeam + '</a>';
                    }

                    isAway = true;
                } else {
                    awayTeam = `<a href="/team?team=${game.awayId}">` + game.awayTeam + '</a>';
                    homeTeam = `<a href="/team?team=${game.homeId}"><strong>` + game.homeTeam + '</strong></a>';
                }
    
                if (game.completed) {
    
                    if( game.awayPoints > game.homePoints ) {
                        if(game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                            scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
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
                            scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.homeId, game.id) + '<strong>';
                        }

                        topData = (game.awayPoints || '0');
                        bottomData = (game.homePoints || '0')+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                    } else {
                        if(game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                            scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
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

                var awayLineHtml = `<span class="betting-line">${awayLine ? '-' + awayLine : ''}</span>`;
                var homeLineHtml = `<span class="betting-line">${homeLine ? '-' + homeLine : ''}</span>`;
    
                teamTable += awayImg + awayRank + awayTeam + awayLineHtml;
                teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 70px;">' + topData;
                teamTable += '</tr><tr><td style="width: 250px;">';
    
                teamTable += homeImg + homeRank + homeTeam + homeLineHtml;
                teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 100px;">' + bottomData;
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

                gameTables.push(gameInfo);
            } else {
                if (!game.startTimeTbd) {

                    if (game.completed) {
                        var shouldReplace = false;
    
                        if (game.awayId == data.seasons.at(-1).teams[iterNum].id) {
                            if (await data.seasons.at(-1).teams.some(e => e.id === game.homeId)) {
                                awayTeam = `<a href="/team?team=${game.awayId}"><strong>` + game.awayTeam + '</strong></a>';
                                homeTeam = `<a href="/team?team=${game.homeId}"><strong>` + game.homeTeam + '</strong></a>';
                            } else {
                                awayTeam = `<a href="/team?team=${game.awayId}"><strong>` + game.awayTeam + '</strong></a>';
                                homeTeam = `<a href="/team?team=${game.homeId}">` + game.homeTeam + '</a>';
                            }
        
                            isAway = true;
                        } else {
                            awayTeam = `<a href="/team?team=${game.awayId}">` + game.awayTeam + '</a>';
                            homeTeam = `<a href="/team?team=${game.homeId}"><strong>` + game.homeTeam + '</strong></a>';
                        }
        
        
                        if (game.seasonType == "postseason" && game.notes && game.notes.toLowerCase().includes("playoff")) {
                            shouldReplace = true;
                            awayScoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
                            homeScoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.homeId, game.id) + '<strong>';

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
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.awayId, game.id) + '<strong>';
                            }
                            topData = (game.awayPoints || '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                            bottomData = (game.homePoints || '-');
                        } else {

                            if(game.homeId == data.seasons.at(-1).teams[iterNum].id) {
                                shouldReplace = true;
                                scoreAdded = '<strong style="color: #22C37A;">+' + teamGameScoreById(userData.seasons.at(-1).weeklyScore, game.homeId, game.id) + '<strong>';
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
                    var awayLineHtml = `<span class="betting-line">${awayLine ? '-' + awayLine : ''}</span>`;
                    var homeLineHtml = `<span class="betting-line">${homeLine ? '-' + homeLine : ''}</span>`;

                    var teamTable = '<td><table class="schedule-table game-table"><tbody><tr></tr><tr><td style="width: 250px;">';
    
                    teamTable += awayImg + awayRank + awayTeam + awayLineHtml;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 70px;">' + topData;
                    teamTable += '</tr><tr><td style="width: 250px;">';
        
                    teamTable += homeImg + homeRank + homeTeam + homeLineHtml;
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 100px;">' + bottomData;
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

                    if (shouldReplace) {
                        var indexToReplace = gameTables.findIndex(x => x.id == game.id);
                        gameTables.splice(indexToReplace, 1);
                        gameTables.push(gameInfo);
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

    scheduleContainer.innerHTML = str;
    document.querySelector('.football-loader').style.display = "none";
    document.querySelector('.schedule-table').style.display = "flex";
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


function setNavbarUserId() {
    var userId = userState.user_metadata.metadata.userId || null;

    if (userId == null) {
        userId = window.localStorage.getItem("userId");
    }
    
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