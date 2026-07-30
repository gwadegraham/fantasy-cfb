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
        renderBento(data[0]);
    });
}

// ---------- My Team bento (#230 redesign, feat/my-team-redesign) ----------
// Renders the tile grid; each tile opens the slide-over drawer. STAGE 2 (shell):
// the hero tile shows real identity + edit; the other tiles open placeholder
// drawers that the next stage wires to the real renderers.
async function renderBento(data) {
    const bento = document.getElementById('uh-bento');
    if (!bento || !data) return;
    const season = data.seasons.at(-1) || {};
    const manager = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    const franchise = season.franchiseName || `${data.firstName || 'Unnamed'}'s Team`;
    document.title = `${franchise || manager} · Campus Clash`;
    const own = currentUserId() && String(currentUserId()) === String(data._id);
    const pencil = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    const tile = (k, label, glance, span, affordance) => `<button class="uh-tile${span === 2 ? ' span2' : ''}" id="uh-tile-${k}" data-tile="${k}"><span class="uh-tlabel">${label}<span class="uh-chev">${affordance || '›'}</span></span><span class="uh-glance" id="uh-glance-${k}">${glance}</span></button>`;

    bento.innerHTML =
        `<div class="uh-tile span2 uh-hero">
            <div class="uh-hero-av avatar avatar-lg" id="uh-hero-av"></div>
            <div class="uh-hero-meta">
                <div class="uh-hero-name">${escapeHtml(franchise)}</div>
                <div class="uh-hero-sub">${escapeHtml(franchise ? ('Managed by ' + manager) : manager)}</div>
                <div class="uh-hero-stats" id="uh-hero-stats"></div>
            </div>
            ${own ? `<button class="uh-edit" edit-profile-btn type="button" aria-label="Edit profile" hidden>${pencil}</button>` : ''}
        </div>`
        + tile('matchup', 'This week · matchup', 'Your current H2H matchup', 2, 'Lineups ›')
        + tile('roster', 'Roster · top performers', 'Your 10 teams', 2, 'All 10 teams ›')
        + tile('captain', 'Captain', 'Double a team each week', 1)
        + tile('recap', 'Your week', 'Latest recap', 1)
        + tile('schedule', 'Schedule', 'Up next', 1, 'Full schedule ›')
        + tile('trajectory', 'Trajectory', 'Season points', 1)
        + tile('draft', 'Draft grade', 'Preseason projection', 2)
        + tile('games', 'Games', 'This week’s games', 2);

    renderAvatar(document.getElementById('uh-hero-av'), data);
    const statsEl = document.getElementById('uh-hero-stats');
    let sh = '';
    try { const rank = await computeRank(data); if (rank) sh += statTile(escapeHtml(ordinal(rank.rank)), `of ${rank.total} teams`); } catch (e) { /* rank optional */ }
    sh += statTile(String(season.cumulativeScore || 0), 'Total points');
    const bt = bestTeam(season);
    if (bt && bt.total > 0) sh += statTile(`<img src="${bt.team.logos.at(-1)}" alt="">${bt.total}`, `Best: ${bt.team.school}`);
    statsEl.innerHTML = sh;

    if (own) setupEditModal(data, season);

    bento.querySelectorAll('[data-tile]').forEach(t => t.addEventListener('click', () => openDrawer(t.getAttribute('data-tile'))));
    setupDrawer();

    // Hydrate each tile's glance + drawer from real data.
    hydrateH2H(data);
    hydrateCaptain(data);
    hydrateRecap(data);
    hydrateDraft(data);
    hydrateRoster(data);
    hydrateTrajectory(data);
    hydrateGames(data);
}

// Roster → Roster tile. Glance shows your top performer; drawer lists all teams
// as cards (points + share bar) then the full week-by-week grid (reused
// displayTeams). Sums per-team points from this season's weekly scoreByTeam.
function hydrateRoster(user) {
    const tile = document.getElementById('uh-tile-roster');
    const season = (user.seasons || []).at(-1) || {};
    const teams = season.teams || [];
    if (!teams.length) { if (tile) tile.hidden = true; return; }

    const totalById = {};
    (season.weeklyScore || []).forEach(e => (e.scoreByTeam || []).forEach(st => {
        totalById[st.teamId] = (totalById[st.teamId] || 0) + (st.score || 0);
    }));
    const cards = teams.map(t => ({ t, pts: Math.round((totalById[t.id] || 0) * 10) / 10 })).sort((a, b) => b.pts - a.pts);
    const top = cards[0];

    const g = document.getElementById('uh-glance-roster');
    if (g) {
        g.innerHTML = top && top.pts > 0
            ? `<span class="uh-rg">${cards.slice(0, 4).map((c, i) => `<span class="uh-rg-row"><img src="${c.t.logos.at(-1)}" alt=""><span class="uh-rg-nm">${escapeHtml(c.t.school)}${i === 0 ? ' <span class="uh-rg-star">★</span>' : ''}</span><span class="uh-rg-pts num">${c.pts}</span></span>`).join('')}</span>`
            : 'Your 10 teams';
    }

    uhDrawer.roster = (body) => {
        const max = (cards[0] && cards[0].pts) || 1;
        const list = cards.map(c => `<a class="uh-rc" href="/team?team=${c.t.id}">
            <img src="${c.t.logos.at(-1)}" alt="">
            <span class="uh-rc-meta"><span class="uh-rc-nm">${escapeHtml(c.t.school)}</span><span class="uh-rc-bar"><i style="width:${Math.round((c.pts / max) * 100)}%"></i></span></span>
            <span class="uh-rc-pts num">${c.pts}</span></a>`).join('');
        body.innerHTML = `<div class="uh-seg">
                <button type="button" class="uh-seg-btn active" data-view="cards">Sorted</button>
                <button type="button" class="uh-seg-btn" data-view="grid">Week by week</button>
            </div>
            <div class="uh-roster-cards" data-view-panel="cards">${list}</div>
            <div data-view-panel="grid" hidden><div class="table-wrapper"><table class="fl-table"><thead user-table-head></thead><tbody user-table-body></tbody></table></div></div>`;
        displayTeams(user);   // fills the grid (hidden until toggled)
        const segs = body.querySelectorAll('.uh-seg-btn');
        segs.forEach(b => b.addEventListener('click', () => {
            segs.forEach(x => x.classList.toggle('active', x === b));
            const v = b.getAttribute('data-view');
            body.querySelectorAll('[data-view-panel]').forEach(p => { p.hidden = p.getAttribute('data-view-panel') !== v; });
        }));
    };
}

// Trajectory → Trajectory tile. Glance shows total points; drawer hosts the
// cumulative-points line chart (reused renderProfileChart).
function hydrateTrajectory(user) {
    const tile = document.getElementById('uh-tile-trajectory');
    const season = (user.seasons || []).at(-1) || {};
    if (!(season.weeklyScore || []).length) { if (tile) tile.hidden = true; return; }

    const g = document.getElementById('uh-glance-trajectory');
    if (g) {
        let cum = 0; const series = [];
        (typeof weeklyColumns === 'function' ? weeklyColumns(season) : []).forEach(c => { if (!c.entry) return; cum += c.entry.score || 0; series.push(cum); });
        g.innerHTML = `<span class="uh-traj-g"><b class="uh-traj-num num">${season.cumulativeScore || 0}</b><span class="uh-glance-sub">total points</span></span>${series.length >= 2 ? `<span class="uh-traj-spark">${uhSpark(series, 260, 34, '#5BD08D')}</span>` : ''}`;
    }

    uhDrawer.trajectory = (body) => {
        body.innerHTML = `<div class="profile-chart-section" profile-chart-section hidden><div class="profile-chart-wrap"><canvas id="profile-chart"></canvas></div></div><p class="uh-stub" id="uh-traj-empty" hidden>Not enough scored weeks yet to chart a trend.</p>`;
        renderProfileChart(user);
        const section = body.querySelector('[profile-chart-section]');
        if (section && section.hidden) { const e = body.querySelector('#uh-traj-empty'); if (e) e.hidden = false; }
    };
}

// Games → Games tile. Glance names the selected week; drawer hosts a week picker
// + this week's game cards for your rostered teams (reused displaySchedule).
function hydrateGames(user) {
    const tile = document.getElementById('uh-tile-games');
    const season = (user.seasons || []).at(-1) || {};
    if (!(season.teams || []).length) { if (tile) tile.hidden = true; return; }
    ensureWeekSelected(user);

    const g = document.getElementById('uh-glance-games');
    if (g) g.textContent = `${window.localStorage.getItem('week') || 'This week'} · your teams`;

    uhDrawer.games = (body) => {
        const weeks = [];
        for (let w = 1; w <= 16; w++) weeks.push(['week-' + w, 'Week ' + w]);
        weeks.push(['week-17', 'Postseason']);
        const cur = window.localStorage.getItem('weekCode') || 'week-1';
        body.innerHTML = `<label class="uh-games-pick"><span>Week</span><select uh-games-week>${weeks.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <div class="football-loader" style="display:none"><div class="football-icon">🏈</div><p class="loading-text">Scouting for games...</p></div>
            <div class="schedule-grid" schedule-body><div id="no-games-container"></div></div>`;
        const sel = body.querySelector('[uh-games-week]');
        const run = () => {
            const loader = body.querySelector('.football-loader'); if (loader) loader.style.display = 'flex';
            const sb = body.querySelector('[schedule-body]'); if (sb) sb.style.display = 'none';
            displaySchedule(user);
        };
        sel.addEventListener('change', () => {
            const label = sel.options[sel.selectedIndex].text;
            window.localStorage.setItem('weekCode', sel.value);
            window.localStorage.setItem('week', label);
            if (g) g.textContent = `${label} · your teams`;
            run();
        });
        run();
    };
}

var UH_DRAWERS = {
    matchup: 'This week · matchup', roster: 'Roster', captain: 'Captain',
    recap: 'Your week', schedule: 'Schedule', trajectory: 'Trajectory',
    draft: 'Draft grade', games: 'Games'
};
// key -> function(bodyEl) that fills the drawer body. Populated by the hydrators.
var uhDrawer = {};

// Compact win-probability bar for a tile glance (you% on the left).
function uhMiniBar(youPct) {
    youPct = Math.round(youPct);
    const opp = 100 - youPct;
    const tone = (a, b) => a > b ? 'fav' : a < b ? 'dog' : 'even';
    return `<span class="uh-mug-bar"><span class="uh-mug-pct ${tone(youPct, opp)}">${youPct}%</span><span class="uh-mug-track"><i class="${tone(youPct, opp)}" style="width:${youPct}%"></i><i class="r ${tone(opp, youPct)}" style="width:${opp}%"></i></span><span class="uh-mug-pct ${tone(opp, youPct)}">${opp}%</span></span>`;
}

// Tiny inline sparkline (cumulative-points trend) for the Trajectory glance.
function uhSpark(pts, w, h, color) {
    if (!pts || pts.length < 2) return '';
    const max = Math.max.apply(null, pts), min = Math.min.apply(null, pts), rng = (max - min) || 1, step = w / (pts.length - 1);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + (i * step).toFixed(1) + ' ' + (h - ((p - min) / rng) * h).toFixed(1)).join(' ');
    const ex = w.toFixed(1), ey = (h - ((pts[pts.length - 1] - min) / rng) * h).toFixed(1);
    return `<svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${ex}" cy="${ey}" r="2.6" fill="${color}"/></svg>`;
}
function openDrawer(key) {
    const title = UH_DRAWERS[key];
    if (title == null) return;
    document.getElementById('uh-drawer-title').textContent = title;
    const body = document.getElementById('uh-drawer-body');
    if (uhDrawer[key]) { body.innerHTML = ''; uhDrawer[key](body); }
    else body.innerHTML = '<p class="uh-stub">This opens the “' + title + '” detail — wired to real data in the next step.</p>';
    const d = document.getElementById('uh-drawer');
    d.hidden = false;
    document.getElementById('uh-scrim').classList.add('open');
    requestAnimationFrame(() => d.classList.add('open'));
    document.getElementById('uh-drawer-close').focus();
}
function closeDrawer() {
    const d = document.getElementById('uh-drawer');
    if (!d) return;
    d.classList.remove('open');
    document.getElementById('uh-scrim').classList.remove('open');
    setTimeout(() => { d.hidden = true; }, 300);
}
function setupDrawer() {
    const scrim = document.getElementById('uh-scrim'), close = document.getElementById('uh-drawer-close');
    if (!scrim || scrim.dataset.wired) return;
    scrim.dataset.wired = '1';
    scrim.addEventListener('click', closeDrawer);
    close.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

// Head-to-Head (#230) → Matchup + Schedule tiles. Fetches the league's H2H
// payload once, fills both tiles' glances, and registers their drawers:
//  - Matchup: this week's (or latest) matchup, full lineups + win-prob + captain.
//  - Schedule: up-next (in-season) + the full week-by-week schedule; tap a week
//    to expand its detail.
// Both tiles hide when the league doesn't have H2H on (and ?h2h=1 isn't set).
async function hydrateH2H(user) {
    const mTile = document.getElementById('uh-tile-matchup');
    const sTile = document.getElementById('uh-tile-schedule');
    const hide = () => { if (mTile) mTile.hidden = true; if (sTile) sTile.hidden = true; };
    if (!user || !user.league || !(user.seasons || []).length || !window.ccH2H) return hide();

    const played = (user.seasons || []).filter(s => (s.weeklyScore || []).length > 0).sort((a, b) => Number(b.season) - Number(a.season));
    if (!played.length) return hide();
    const season = played[0].season;

    let enabled = false;
    try {
        const r = await fetch('/scoring-config/' + encodeURIComponent(user.league), { headers: { Accept: 'application/json' } });
        if (r.ok) { const c = await r.json(); enabled = !!(c.engagement && c.engagement.h2hEnabled); }
    } catch (e) { /* preview gate below */ }
    if (!enabled && new URLSearchParams(location.search).get('h2h') !== '1') return hide();

    let data;
    try {
        data = await fetch(`/standings/h2h/${encodeURIComponent(user.league)}/${encodeURIComponent(season)}`, { headers: { Accept: 'application/json' } }).then(r => r.json());
    } catch (e) { return hide(); }
    if (!data || !(data.schedule || []).length) return hide();

    const byId = {};
    (data.managers || []).forEach(m => { byId[m.userId] = m; });
    const uid = String(user._id);
    const mine = [];
    (data.schedule || []).forEach(s => { const g = s.games.find(x => x.aId === uid || x.bId === uid); if (g) mine.push({ week: s.week, final: s.final !== false, g }); });
    if (!mine.length) return hide();

    const me = byId[uid];

    // H2H record into the hero, right after Total points.
    const statsEl = document.getElementById('uh-hero-stats');
    if (statsEl && me && me.record && !statsEl.querySelector('.uh-hero-rec')) {
        const rec = document.createElement('div');
        rec.className = 'stat uh-hero-rec';
        rec.innerHTML = `<span class="stat-value num">${escapeHtml(me.record)}</span><span class="stat-label">H2H record</span>`;
        const pts = [...statsEl.querySelectorAll('.stat')].find(s => /total points/i.test(s.textContent));
        if (pts && pts.nextSibling) statsEl.insertBefore(rec, pts.nextSibling);
        else statsEl.appendChild(rec);
    }

    const liveWk = (data.currentWeek != null && mine.some(x => x.week === data.currentWeek)) ? data.currentWeek : null;
    const featuredWk = liveWk != null ? liveWk : mine[mine.length - 1].week;
    const featured = mine.find(x => x.week === featuredWk);
    const rest = mine.slice().sort((a, b) => b.week - a.week);
    const cardOf = (x, open) => window.ccH2H.matchupCard(x.g, { byId, youId: uid, week: x.week, open });
    // My-perspective summary of a matchup (for glances).
    const summary = (x) => {
        const g = x.g, iAmA = g.aId === uid;
        const meScore = iAmA ? g.aScore : g.bScore, opScore = iAmA ? g.bScore : g.aScore;
        const opp = byId[iAmA ? g.bId : g.aId];
        const nm = (opp && (opp.franchise || opp.name)) || 'Opponent';
        const res = x.final ? (meScore > opScore ? 'W' : opScore > meScore ? 'L' : 'T') : 'LIVE';
        return { meScore, opScore, nm, res };
    };

    // Matchup tile — this week / latest. Rich glance: avatars, scores, win bar.
    if (mTile) mTile.hidden = false;
    const mg = document.getElementById('uh-glance-matchup');
    if (mg && featured) {
        const g = featured.g, iAmA = g.aId === uid;
        const s = summary(featured);
        const oppM = byId[iAmA ? g.bId : g.aId];
        const av = (m) => (window.ccH2H.avatar ? window.ccH2H.avatar(m) : '');
        let youPct = null;
        if (featured.final) youPct = s.res === 'W' ? 100 : s.res === 'L' ? 0 : 50;
        else if (g.winP) youPct = iAmA ? g.winP.a : g.winP.b;
        const wc = s.res === 'W' ? ' win' : '', oc = s.res === 'L' ? ' win' : '';
        mg.innerHTML = `<span class="uh-mug">
                <span class="uh-mug-side">${av(me)}<span class="uh-mug-nm">You</span><span class="uh-mug-sc num${wc}">${s.meScore}</span></span>
                <span class="uh-mug-vs">${featured.final ? (s.res === 'T' ? 'T' : 'vs') : 'LIVE'}</span>
                <span class="uh-mug-side r"><span class="uh-mug-sc num${oc}">${s.opScore}</span><span class="uh-mug-nm">${escapeHtml(s.nm)}</span>${av(oppM)}</span>
            </span>${youPct == null ? '' : uhMiniBar(youPct)}`;
    }
    uhDrawer.matchup = (body) => {
        const lead = `${featured.final === false ? 'This week' : 'Latest'} · Week ${featured.week}${me ? ` · ${escapeHtml(me.record)}` : ''}`;
        body.innerHTML = `<div class="uh-drawer-lead">${lead}</div>` + cardOf(featured, true);
        window.ccH2H.wire(body);
    };

    // Schedule tile — up next (in-season) + full schedule.
    if (sTile) sTile.hidden = false;
    const sg = document.getElementById('uh-glance-schedule');
    if (sg) {
        if (liveWk != null) {
            const s = summary(featured), fg = featured.g, iAmA = fg.aId === uid;
            const pct = fg.winP ? (iAmA ? fg.winP.a : fg.winP.b) : null;
            sg.innerHTML = `<span class="uh-sched-lbl">Up next</span><span class="uh-sched-row"><span class="uh-sched-opp">vs ${escapeHtml(s.nm)}</span>${pct != null ? `<span class="uh-sched-pct">${pct}%</span>` : ''}</span>`;
        } else sg.innerHTML = `<span class="uh-mu-opp">Full schedule</span>${me ? ` <span class="uh-glance-sub">${escapeHtml(me.record)}</span>` : ''}`;
    }
    uhDrawer.schedule = (body) => {
        const listWeeks = liveWk != null ? rest.filter(x => x.week !== featuredWk) : rest;
        const lead = liveWk != null ? `<div class="uh-drawer-lead">This week</div>` + cardOf(featured, true) : '';
        body.innerHTML = lead + `<div class="uh-drawer-cap">Full schedule · tap a week</div><div class="uh-h2h-log">${listWeeks.map(x => cardOf(x, false)).join('')}</div>`;
        window.ccH2H.wire(body);
    };
}

// Captain picker (#230): the profile owner sets which rostered team to double
// for the current regular-season week. Behind a hero chip that expands a team
// grid. Only shown for your own profile, and only when the league has opted in
// (or ?captain=1 to preview). Weeks already scored are locked.
// Captain (#230) → Captain tile. Own profile only, and only when the league has
// Captain on (or ?captain=1). Glance shows the current pick; drawer is the team
// picker (set/clear a 2× team for the current open week).
async function hydrateCaptain(user) {
    const tile = document.getElementById('uh-tile-captain');
    const hide = () => { if (tile) tile.hidden = true; };
    if (!user || !user.league || !(user.seasons || []).length) return hide();
    if (String(currentUserId()) !== String(user._id)) return hide();   // own profile only

    const preview = new URLSearchParams(location.search).get('captain') === '1';
    let enabled = false;
    try {
        const r = await fetch('/scoring-config/' + encodeURIComponent(user.league), { headers: { Accept: 'application/json' } });
        if (r.ok) { const c = await r.json(); enabled = !!(c.engagement && c.engagement.captainEnabled); }
    } catch (e) { /* fall through to preview gate */ }
    if (!enabled && !preview) return hide();

    // Captain is set for the active season's next unplayed regular week. Use the
    // latest season that has a roster AND an open week (consistent with every
    // other tile, which keys off seasons.at(-1) — not the wall-clock year, which
    // is ahead of the data in the offseason). No open week (finished season) →
    // nothing to set → hide.
    const firstOpenWeek = (s) => {
        const scored = new Set((s.weeklyScore || []).filter(e => e.season !== 'postseason' && e.week <= 16).map(e => Number(e.week)));
        for (let w = 1; w <= 16; w++) if (!scored.has(w)) return w;
        return null;
    };
    const season = (user.seasons || []).slice().reverse().find(s => (s.teams || []).length && firstOpenWeek(s) != null);
    const week = season ? firstOpenWeek(season) : null;
    if (!season || week == null) return hide();

    let pick = ((season.captains || []).find(c => Number(c.week) === week) || {}).teamId;
    const teamById = {};
    (season.teams || []).forEach(t => { teamById[t.id] = t; });
    if (tile) tile.hidden = false;

    const g = document.getElementById('uh-glance-captain');
    const setGlance = () => {
        if (!g) return;
        const t = pick != null ? teamById[pick] : null;
        const lead = t
            ? `<span class="uh-cap-glance"><img src="${t.logos.at(-1)}" alt=""> ${escapeHtml(t.school)} <span class="uh-cap-2x">2×</span></span>`
            : `<span class="captain-unset">Set for Wk ${week}</span>`;
        g.innerHTML = lead + `<span class="uh-cap-sub">Doubles this week’s points</span>`;
    };
    const paint = (container) => {
        container.innerHTML = `<p class="captain-note">Pick one team to score <b>2×</b> in Week ${week}. Tap the current pick to clear. Locks at kickoff.</p>
            <div class="captain-grid">${(season.teams || []).map(t => `
                <button type="button" class="captain-team${Number(pick) === Number(t.id) ? ' is-captain' : ''}" data-team="${t.id}" aria-pressed="${Number(pick) === Number(t.id)}">
                    <img src="${t.logos.at(-1)}" alt=""><span>${escapeHtml(t.school)}</span>
                </button>`).join('')}</div>`;
        container.querySelectorAll('.captain-team').forEach(btn => btn.addEventListener('click', async () => {
            const teamId = Number(btn.getAttribute('data-team'));
            const next = Number(pick) === teamId ? null : teamId;   // click current to clear
            try {
                const res = await fetch('/users/me/captain', {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ season: season.season, week, teamId: next })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Could not set captain');
                pick = next;
                setGlance(); paint(container);
                if (window.ccToast) ccToast.success(next ? `Captain set: ${teamById[next].school}` : 'Captain cleared');
            } catch (e) { if (window.ccToast) ccToast.error(e.message); }
        }));
    };

    setGlance();
    uhDrawer.captain = (body) => paint(body);
}

// Weekly Recap (#212) → Your Week tile. Glance shows the latest week's narrative;
// drawer mounts the full "Your Week" card (week selector + story) via ccRecap.
async function hydrateRecap(user) {
    const tile = document.getElementById('uh-tile-recap');
    const hide = () => { if (tile) tile.hidden = true; };
    if (!window.ccRecap || !user || !user.league || !(user.seasons || []).length) return hide();

    const played = (user.seasons || [])
        .filter(s => (s.weeklyScore || []).length > 0)
        .sort((a, b) => Number(b.season) - Number(a.season));
    if (!played.length) return hide();

    try {
        const data = await window.ccRecap.fetchRecap(user.league, played[0].season, user._id);
        if (!data || !(data.recaps || []).length) return hide();
        if (tile) tile.hidden = false;

        const latest = data.recaps[data.recaps.length - 1];
        const g = document.getElementById('uh-glance-recap');
        if (g && latest) {
            const place = latest.rank != null ? ` · ${escapeHtml(ordinal(latest.rank))} ${window.ccRecap.movement(latest.rankDelta)}` : '';
            g.innerHTML = latest.narrative ? escapeHtml(latest.narrative) : `${escapeHtml(latest.label)}${place}`;
        }
        uhDrawer.recap = (body) => { window.ccRecap.mountInline(body, data); };
    } catch (e) {
        console.error('weekly recap failed:', e);
        hide();
    }
}

// Draft grade → Draft grade tile. Glance shows the color-coded letter; drawer
// renders this manager's full draft-grade card (reused from draftGrades.js).
async function hydrateDraft(user) {
    const tile = document.getElementById('uh-tile-draft');
    const hide = () => { if (tile) tile.hidden = true; };
    if (!user || !user.league || !(user.seasons || []).length) return hide();
    const season = user.seasons.at(-1).season;
    try {
        const res = await fetch('/draft/grades/' + encodeURIComponent(user.league) + '/' + encodeURIComponent(season), {
            headers: { 'Accept': 'application/json' }
        });
        const data = await res.json();
        const mine = (data.managers || []).find(m => String(m.userId) === String(user._id));
        if (!mine) return hide();   // didn't draft that season
        if (tile) tile.hidden = false;

        const tier = (mine.grade || '').charAt(0).toLowerCase();
        const g = document.getElementById('uh-glance-draft');
        if (g) g.innerHTML = `<span class="uh-draft-g"><span class="uh-grade gg-tier-${tier}">${escapeHtml(mine.grade)}</span><span class="uh-draft-stats">`
            + `<span class="uh-ds"><b class="num">${mine.projPoints}</b>proj pts</span>`
            + `<span class="uh-ds"><b class="num">${mine.projWins}</b>proj wins</span>`
            + `<span class="uh-ds"><b class="num">${mine.cfpCount}</b>CFP teams</span>`
            + `</span></span>`;

        let me;
        try { me = userState.user_metadata.metadata.userId; } catch (e) { /* fall through */ }
        me = me || window.localStorage.getItem('userId') || user._id;
        uhDrawer.draft = (body) => {
            if (typeof renderDraftGradeCard === 'function') {
                renderDraftGradeCard(body, mine, {
                    currentUserId: me,
                    note: season + ' preseason grade — projected fantasy points in your league’s scoring (schedule + SP+ win odds + market CFP odds). Each draft graded on its own merit.'
                });
            }
        };
    } catch (e) {
        console.error('draft grade failed:', e);
        hide();
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

// Refresh the bento hero tile's identity after a profile edit (name/avatar),
// without re-fetching/re-rendering the whole grid.
function refreshHeroIdentity(data, season) {
    const manager = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    const franchise = season.franchiseName || `${data.firstName || 'Unnamed'}'s Team`;
    const av = document.getElementById('uh-hero-av');
    if (av) renderAvatar(av, data);
    const nameEl = document.querySelector('.uh-hero-name');
    if (nameEl) nameEl.textContent = franchise;
    const subEl = document.querySelector('.uh-hero-sub');
    if (subEl) subEl.textContent = franchise && season.franchiseName ? `Managed by ${manager}` : manager;
    document.title = `${franchise || manager} · Campus Clash`;
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
            refreshHeroIdentity(data, season);
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
        + (game.outlet ? '<tr><td class="game-broadcast">' + (window.ccIcon ? window.ccIcon('broadcast', { size: 15 }) : '') + ' ' + game.outlet + '</td></tr>' : '')
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