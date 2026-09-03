import { setChartData } from './weekByWeek.js';
import { rankedRows, buildStandingsRowsHtml, standingsHeadHtml, buildHighlights, buildHighlightsHtml } from './standings-insights.js';

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

// True once the season has REAL scoring — some manager has banked non-zero
// points. The nightly scoring job seeds a zero-point weekly entry as soon as a
// week's games exist (even with undrafted, 0-team rosters), so "a weekly entry
// exists" fires too early. The highlights panel and the points chart gate on
// this instead, so they stay hidden until the season is actually underway.
//
// The rule itself lives in public/season-scoring.js (loaded app-wide by the
// navbar partial) because the Weekly Recap and the server need the same answer —
// the two had drifted, and the recap was popping a zero-point week-one story
// through the preseason. The users here carry one season each (routes/users.js
// $elemMatch's the active one), which is the no-season-argument form.
const seasonHasScoring = (users) => ccSeasonScoring.seasonHasScoring(users);

// True once someone has banked real postseason points — i.e. the bowl/playoff
// slate has something on it. Gated on a non-zero score for the same reason
// seasonHasScoring is: the scoring job writes the postseason entry whenever it
// runs for the postseason, so a bare entry can exist at 0.
//
// This is deliberately NOT the same moment as "the H2H schedule ran out".
// Conference championship week and Army/Navy fall between the two, and they
// carry rivalry games of their own — see revealRivalryGames.
//
// Shares its "non-zero banked points" rule with seasonHasScoring above, from the
// same place (public/season-scoring.js), so the two can't drift apart.
const postseasonHasScoring = (users) => ccSeasonScoring.postseasonHasScoring(users);

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
    // Hamburger toggle is owned by the navbar partial (views/partials/navbar.ejs).


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
        const rivalryWeekSel = document.querySelector('[rivalry-week]');
        if (weekCode && rivalryWeekSel) {
            rivalryWeekSel.value = weekCode;
        } else {
            if (rivalryWeekSel) rivalryWeekSel.value = 'week-1';
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
                    var _lSel = document.querySelector('[league-select]');
                    if (_lSel) _lSel.value = window.localStorage.getItem("leagueCode");
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
            var _rwSel = document.querySelector('[rivalry-week]');
            if (_rwSel) _rwSel.style.display = 'none';
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
                    var _rwSel = document.querySelector('[rivalry-week]');
                    if (_rwSel) _rwSel.value = 'week-' + cw;
                }
            }
            // Standings table: decide the layout before painting so an H2H
            // league doesn't flash the classic table then swap (see below). It
            // owns the schedule render too — an H2H league hides that section,
            // and its ~60 game fetches are pure waste until we know the mode.
            renderStandingsSection(data, leagueCode, data[0]?.seasons?.[0]?.season);
            maybePromptProfileSetup(data);
            displayLastUpdated(data);
            displayHighlights(data);
            maybeCelebrateWeeklyWin(data);
            // Server "advanced" highlights append to the same panel — skip them
            // too until there's real scoring, or they'd re-populate the panel
            // displayHighlights just hid.
            if (seasonHasScoring(data)) loadAdvancedHighlights(leagueCode, data[0]?.seasons?.[0]?.season);
            loadProjections(leagueCode, data[0]?.seasons?.[0]?.season);
            seedUserIdFromEmail(userMetadata, usersData);
            // Chart is responsive now, so show it on mobile too — but only once
            // the season has real scoring. A zero-point week the nightly job seeds
            // has nothing to plot, so the chart stays hidden until points land.
            if (seasonHasScoring(data)) {
                setChartData(data);
                document.querySelector('[chart-container]').removeAttribute("style");
            }
        }
    });
}

function displayUsers(data) {
    // Base render: ranked by cumulative points. loadH2H() re-renders this same
    // table with adjusted totals + a Record column when the league runs H2H.
    renderStandingsTable(rankedRows(data), { h2h: false });
}

// Picks the standings layout BEFORE the first paint so an H2H league doesn't
// render the classic table and then flash to the (heavier, ~1s) H2H view. A
// cheap /enabled check decides: non-H2H leagues render classic immediately;
// H2H leagues show a loading skeleton, then loadH2H swaps in the real table.
async function renderStandingsSection(data, league, season) {
    const params = new URLSearchParams(location.search);
    const preview = params.get('h2h') === '1' || !!params.get('h2hSim');

    let enabled = false;
    if (league && season != null) {
        try {
            // Bound the check with a timeout so a slow/hung /enabled can't leave
            // the table blank — on timeout (or error) we fall back to classic.
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 2500);
            const res = await fetch(`/standings/h2h/${league}/${season}/enabled`, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
            clearTimeout(timer);
            const j = await res.json();
            enabled = !!(j && j.enabled);
        } catch (e) { /* timeout or error → treat as classic */ }
    }

    if (!enabled && !preview) { displayUsers(data); displaySchedule(data); return; }
    hideLegacyH2HSchedule();   // hide the Rivalry Games section ASAP (before it paints)
    showStandingsLoading();
    // The schedule render is deferred to revealRivalryGames(): while matchups
    // are live the section stays hidden, so building it would cost a game fetch
    // per team per week for markup nobody sees.
    loadH2H(league, season, data);   // renders H2H, or falls back to classic
}

// Shimmer placeholder shown in the table while the H2H payload loads, so the
// H2H view arrives once instead of flashing in over the classic table.
function showStandingsLoading() {
    const head = document.querySelector('[user-table-head]');
    const body = document.querySelector('[user-table-body]');
    if (head) head.innerHTML = '';
    if (!body) return;
    let rows = '';
    for (let i = 0; i < 6; i++) rows += '<tr class="std-skel-row"><td colspan="6"><span class="std-skel"></span></td></tr>';
    body.innerHTML = rows;
}

// Paints the standings table (header + rows) for a given mode and wires the
// per-row roster expanders. One template drives both the points-only and the
// Head-to-Head views; `h2h` toggles the Record column, the "Total" heading, the
// base+bonus sub-line, and the ranking note above the table.
function renderStandingsTable(rows, opts) {
    const h2h = !!(opts && opts.h2h);
    const head = document.querySelector('[user-table-head]');
    const body = document.querySelector('[user-table-body]');
    // Mode class drives layout: the H2H table fills the width (Record fills the
    // middle); the points-only table has fewer columns, so it centres at its
    // content width instead of stretching name and score to opposite edges.
    const table = (head && head.closest('table')) || (body && body.closest('table'));
    if (table) {
        table.classList.toggle('mode-h2h', h2h);
        table.classList.toggle('mode-plain', !h2h);
        // Preseason / undrafted: no rosters yet, so hide the empty Teams column.
        table.classList.toggle('std-no-teams', !rows.some(r => (r.teams || []).length));
    }
    if (head) head.innerHTML = standingsHeadHtml(h2h);
    if (body) {
        body.innerHTML = buildStandingsRowsHtml(rows, { h2h });
        animateScores(body);
        wireRosterToggles(body);
    }
    const note = document.querySelector('[standings-rank-note]');
    if (note) {
        note.textContent = h2h ? 'Ranked by total points + H2H bonuses' : '';
        note.hidden = !h2h;
    }
}

// Each row's caret button toggles the hidden roster row that follows it. The
// caret (not the whole row) is the only expander, so the manager-name link and
// the team logos inside the drawer stay independently clickable. The <button>
// gives keyboard/screen-reader support for free.
function wireRosterToggles(root) {
    root.querySelectorAll('.std-caret').forEach(btn => {
        if (btn.dataset.wired) return;
        btn.dataset.wired = '1';
        btn.addEventListener('click', () => {
            const row = btn.closest('tr');
            const drawer = row && row.nextElementSibling;
            if (!drawer || !drawer.classList.contains('std-roster-row')) return;
            const opening = drawer.hasAttribute('hidden');
            if (opening) drawer.removeAttribute('hidden'); else drawer.setAttribute('hidden', '');
            btn.setAttribute('aria-expanded', String(opening));
            btn.classList.toggle('open', opening);
        });
    });
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

// "Data as of" freshness badge. Prefers the last SUCCESSFUL scoring run
// (/standings/last-updated → JobRun) — the honest refresh time — and only falls
// back to the legacy per-user `lastUpdated` string if no run history exists yet
// (fresh DB / pre-JobRun data), so the stamp never goes blank.
async function displayLastUpdated(data) {
    const el = document.querySelector('[last-updated]');
    if (!el) return;

    let when = null;   // Date to display
    let run = null;    // JobRun record when available (drives the tooltip detail)
    try {
        const res = await fetch('/standings/last-updated', { headers: { Accept: 'application/json' } });
        run = res.ok ? await res.json() : null;
        if (run && (run.finishedAt || run.startedAt)) when = new Date(run.finishedAt || run.startedAt);
    } catch (e) { /* fall back to the legacy stamp below */ }

    if (!when || isNaN(when.getTime())) {
        const legacy = new Date(data && data[0] && data[0].lastUpdated);
        when = isNaN(legacy.getTime()) ? null : legacy;
        run = null;
    }
    if (!when) { el.hidden = true; return; }
    el.hidden = false;

    const abs = formatStamp(when);
    const detail = run
        ? `Last successful scoring update — ${abs}${run.week != null ? ` · week ${run.week}` : ''}`
        : `Last updated — ${abs}`;
    el.innerHTML = `<span class="lu-badge" title="${escapeHtml(detail)}">`
        + `<span class="lu-dot" aria-hidden="true"></span>`
        + `<span class="lu-text">Updated <b>${escapeHtml(relativeTime(when))}</b></span>`
        + `</span>`;
}

// Absolute stamp, e.g. "7/23 at 11:58 PM" (shown in the badge's hover tooltip).
function formatStamp(d) {
    let hours = d.getHours() % 12; hours = hours || 12;
    let minutes = d.getMinutes(); minutes = minutes < 10 ? ('0' + minutes) : minutes;
    const amPm = d.getHours() >= 12 ? 'PM' : 'AM';
    return `${d.getMonth() + 1}/${d.getDate()} at ${hours}:${minutes} ${amPm}`;
}

// Compact relative time for the badge label ("just now", "2h ago", "5mo ago").
function relativeTime(d) {
    const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
    if (s < 90) return 'just now';
    const units = [['y', 31536000], ['mo', 2592000], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]];
    for (const [label, secs] of units) {
        const n = Math.floor(s / secs);
        if (n >= 1) return `${n}${label} ago`;
    }
    return 'just now';
}

// Advanced highlights (Overachiever, Draft Steal, Giant Killer) come from the
// server since they need records/games/rankings/draft data the roster payload
// doesn't carry. Appended to the highlights grid; failures are silent.
async function loadAdvancedHighlights(league, season) {
    if (!league || season == null) return;
    try {
        const res = await fetch(`/standings/highlights/${league}/${season}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return;
        const cards = await res.json();
        const container = document.querySelector('.highlights-container');
        if (container && Array.isArray(cards) && cards.length) {
            container.insertAdjacentHTML('beforeend', buildHighlightsHtml(cards));
        }
    } catch (e) { /* advanced highlights are best-effort */ }
}

function displayHighlights(users) {
    const cards = buildHighlights(users);
    const container = document.querySelector('.highlights-container');
    const header = document.querySelector('.highlights-header');
    // Hide the whole section (header + its leading divider) when there's nothing
    // to show yet — e.g. preseason, before any real points are scored — so we
    // don't leave a bare "League Highlights" heading over empty space (or worse,
    // "winners" and "streaks" computed from all-zero weeks the nightly job seeds).
    if (!cards.length || !seasonHasScoring(users)) {
        if (header) header.style.display = 'none';
        if (container) container.style.display = 'none';
        const hr = header && header.previousElementSibling;
        if (hr && hr.classList && hr.classList.contains('hr-subtle')) hr.style.display = 'none';
        return;
    }
    if (header) header.style.display = '';
    if (container) { container.style.display = ''; container.innerHTML = buildHighlightsHtml(cards); }
}

// Forward-looking analytics (#210): projected final points + title odds, in a
// dedicated "Projected Finish" panel below the standings. Server-computed (needs
// schedule/SP+/odds); the route returns nothing when a season has no games left.
async function loadProjections(league, season) {
    if (!league || season == null) return;
    let managers = [];
    try {
        const res = await fetch(`/standings/projections/${league}/${season}`, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        managers = (data && data.managers) || [];
    } catch (e) { return; }
    if (!managers.length) return;
    renderProjPanel(managers);
}

function projAvatarHtml(m) {
    if (m.avatarUrl) {
        const src = m.avatarUrl.indexOf('/upload/') !== -1
            ? m.avatarUrl.replace('/upload/', '/upload/c_fill,g_face,w_48,h_48,q_auto,f_auto/') : m.avatarUrl;
        return `<span class="pp-avatar"><img src="${src}" alt=""></span>`;
    }
    return `<span class="pp-avatar pp-avatar-initials" style="background:${m.color || '#333'}">${escapeHtml(m.initials || '?')}</span>`;
}

function renderProjPanel(managers) {
    const el = document.getElementById('proj-panel');
    if (!el) return;
    const rows = managers.map((m, i) => `
        <div class="pp-row">
            <span class="pp-rank">${i + 1}</span>
            ${projAvatarHtml(m)}
            <a href="/userHome?user=${m.userId}" class="pp-id" style="color:inherit;text-decoration:none"><span class="pp-name">${escapeHtml(m.franchise || m.name)}</span>${m.franchise ? `<span class="pp-sub">${escapeHtml(m.name)}</span>` : ''}</a>
            <span class="pp-points"><span class="pp-cur">${m.banked}</span><i class="fa-solid fa-arrow-right pp-arrow"></i><span class="pp-proj">${m.projectedFinal}</span></span>
            <span class="pp-title"><span class="pp-bar"><i style="width:${Math.min(100, m.titleOdds)}%"></i></span><b>${m.titleOdds}%</b></span>
        </div>`).join('');
    el.innerHTML = `<h2 class="proj-panel-title">${window.ccIcon ? window.ccIcon('crystalball', { size: 22 }) : ''}Projected Finish</h2>
        <p class="proj-panel-note">Projected final points and title odds — banked points plus expected points from each roster's remaining schedule.</p>
        <div class="pp-list">${rows}</div>`;
    el.hidden = false;
}

// Head-to-head win-bonus standings (#230). Shown only when the league has
// opted in (config `enabled`) or when previewing the format via ?h2h=1.
async function loadH2H(league, season, fallbackData) {
    // If H2H can't render (bad params, fetch error, or not actually enabled),
    // fall back to the classic table so a skeleton shown by the caller resolves.
    const renderClassic = () => { if (fallbackData) displayUsers(fallbackData); };
    if (!league || season == null) return renderClassic();
    const params = new URLSearchParams(location.search);
    const sim = params.get('h2hSim');   // dev-only in-progress preview (non-prod route honors it)
    const preview = params.get('h2h') === '1' || !!sim;
    const simQ = sim ? `&h2hSim=${encodeURIComponent(sim)}` : '';

    // 1) Standings-only: fast (skips the matchup win-prob compute), so the table
    //    paints without waiting ~1s on projections.
    let data;
    try {
        const res = await fetch(`/standings/h2h/${league}/${season}?standingsOnly=1${simQ}`, { headers: { Accept: 'application/json' } });
        data = await res.json();
    } catch (e) { return renderClassic(); }
    if (!data || !(data.managers || []).length || (!data.enabled && !preview)) return renderClassic();
    renderStandingsTable(h2hRows(data), { h2h: true });

    // 2) Matchups: the heavier win-prob payload, loaded after the table into its
    //    own module below.
    loadH2HMatchups(league, season, sim);
}

// Fetches the full H2H payload (schedule + win-prob) and renders the weekly
// matchup cards. Kept separate from the standings render so the table isn't
// blocked on the projection compute. Best-effort: if it fails, the standings
// table is already up and only the matchups module is missing.
async function loadH2HMatchups(league, season, sim) {
    try {
        const url = `/standings/h2h/${league}/${season}` + (sim ? `?h2hSim=${encodeURIComponent(sim)}` : '');
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const d = await res.json();
        if (d && d.scheduleComplete) revealRivalryGames();
        if (d && (d.schedule || []).length) renderH2HMatchups(d);
    } catch (e) { /* matchups are best-effort */ }
}

// Maps the H2H payload's managers (already ranked by adjusted total, server-side)
// into the shared standings-row shape. Rank is by points + win bonus, so the
// gap-to-leader is measured against the leader's adjusted total, and base/bonus
// feed the sub-line. Movement is the same points-based rank change the classic
// table shows — it doesn't depend on H2H records — so reuse the ranked league
// data (usersData) and attach each manager's delta by id.
function h2hRows(d) {
    const managers = (d.managers || []).slice();
    const leader = managers.length ? managers[0].adjustedTotal : 0;
    const preseason = leader <= 0;   // no points scored yet → flat tie, no crown
    const deltaById = {};
    try { rankedRows(usersData || []).forEach(r => { deltaById[r.id] = r.delta; }); } catch (e) { /* movement is best-effort */ }
    return managers.map((m, i) => ({
        rank: m.rank != null ? m.rank : i + 1,
        tie: !!m.tie,                     // competition-ranked server-side, so ties share a place
        id: m.userId,
        name: m.name,
        franchise: m.franchise,
        avatarUrl: m.avatarUrl || null,
        initials: m.initials,
        color: m.color,
        teams: m.teams || [],
        score: m.adjustedTotal,
        gap: i === 0 ? 0 : Math.round((leader - m.adjustedTotal) * 10) / 10,
        preseason: preseason,
        delta: deltaById[m.userId] != null ? deltaById[m.userId] : null,
        record: m.record || '',
        base: Math.round((m.adjustedTotal - m.h2hBonus) * 10) / 10,
        bonus: m.h2hBonus
    }));
}

// The pieces of the lower Rivalry Games section — real CFB games where two
// managers' drafted teams meet. The divider directly above it is included, so
// hiding the section doesn't leave a stray rule between the highlights and the
// chart.
function rivalryGamesEls() {
    const pollHeader = document.querySelector('[poll-name]');
    const headerWrap = pollHeader && pollHeader.closest('.header');
    const els = [headerWrap, document.querySelector('[rivalry-week]'), document.querySelector('.game-content')];
    if (headerWrap) {
        const prev = headerWrap.previousElementSibling;
        if (prev && prev.classList && prev.classList.contains('hr-subtle')) els.push(prev);
    }
    return els.filter(Boolean);
}

// While an H2H league has live matchups, the Rivalry Games section is hidden:
// both surfaces pair manager against manager, and two of those on one page is
// confusing. The H2H panel wins the slot because its pairings are the ones that
// carry a bonus. revealRivalryGames() undoes this once no matchup is left.
function hideLegacyH2HSchedule() {
    rivalryGamesEls().forEach(el => { el.style.display = 'none'; });
}

// Every H2H week is final, so there is no live matchup left to confuse this
// section with — bring it back to carry the rest of the season. Called from
// loadH2HMatchups off the payload's scheduleComplete flag; if that fetch fails
// the section simply stays hidden.
//
// The H2H schedule runs out weeks before the bowls start: conference
// championship week and Army/Navy sit in between, and each carries rivalry
// games of its own. So the reveal has two stages — the section comes back the
// moment matchups end, but it only retitles and jumps to the postseason once
// the postseason has points on it. Jumping straight there would park the league
// on an empty "no rivalry games" view for a fortnight.
function revealRivalryGames() {
    rivalryGamesEls().forEach(el => { el.style.display = ''; });

    const title = document.querySelector('[poll-name]');
    const note = document.querySelector('[schedule-note]');
    if (note) {
        // True in both stages: championship-week points count too, and no week
        // past the H2H schedule carries a bonus.
        note.textContent = 'Real games where your teams meet another manager’s. These points count toward your total — matchup bonuses ended with the regular season.';
        note.hidden = false;
        // Closes the heading's bottom padding so the note reads as its sub-line
        // rather than floating above the week picker (see .has-section-note).
        if (title) title.closest('.header').classList.add('has-section-note');
    }

    // Stage two. Until it fires, the bootstrap's latest-scored-week default is
    // the right landing and the season-neutral "Rivalry Games" title still reads
    // true, so neither is touched.
    if (postseasonHasScoring(usersData)) {
        if (title) title.textContent = 'Postseason Rivalries';
        // latestWeek() deliberately skips the postseason bucket, so the
        // bootstrap defaulted to a regular week. A week the user picked
        // themselves is left alone — the same rule the bootstrap uses.
        if (!window.localStorage.getItem('week')) {
            window.localStorage.setItem('weekCode', 'week-17');
            weekCode = 'week-17';
            var _rwSel = document.querySelector('[rivalry-week]');
            if (_rwSel) _rwSel.value = 'week-17';
        }
    }

    // This is the only schedule render an H2H league does; renderStandingsSection
    // skipped the bootstrap one while the section was still hidden.
    displaySchedule(usersData);
}

function renderH2HMatchups(d) {
    const el = document.getElementById('h2h-panel');
    if (!el) return;
    const byId = {};
    (d.managers || []).forEach(m => { byId[m.userId] = m; });
    const weekOpts = (d.schedule || []).map(s => `<option value="${s.week}"${s.week === d.featuredWeek ? ' selected' : ''}>Week ${s.week}</option>`).join('');

    const preview = !d.enabled ? '<span class="h2h-preview-tag">preview</span>' : '';
    // Once the schedule is exhausted the panel would otherwise sit on the last
    // regular week forever under a "This Week's" heading. It becomes a closing
    // summary instead, and hands the postseason off to the Rivalry Games section
    // that revealRivalryGames() just brought back below it.
    const done = !!d.scheduleComplete;
    const title = done ? 'Final Matchups' : "This Week's Matchups";
    const note = done
        ? `Regular season complete — all matchup bonuses are locked in. Postseason points still count toward the title.`
        : `Win your weekly matchup for <b>+${d.winBonus}</b>${d.tieBonus > 0 ? ` · ties earn <b>+${d.tieBonus}</b> each` : ''}. Bonuses count toward your <b>Total</b> above.`;
    el.innerHTML = `<h2 class="h2h-panel-title">${window.ccIcon ? window.ccIcon('swords', { size: 22 }) : ''}${title}${preview}</h2>
        <p class="h2h-panel-note">${note}</p>
        <div class="h2h-week-bar"><span class="h2h-week-cap">${done ? 'Final week' : 'Matchups'}</span><select h2h-week aria-label="Matchup week">${weekOpts}</select></div>
        <div class="h2h-matches" h2h-matches></div>`;
    el.hidden = false;

    const matchesEl = el.querySelector('[h2h-matches]');
    const paintWeek = (w) => {
        const s = (d.schedule || []).find(x => x.week === Number(w));
        matchesEl.innerHTML = (s && s.games.length)
            ? s.games.map(g => window.ccH2H.matchupCard(g, { byId })).join('')
            : '<p class="h2h-empty">No matchups this week.</p>';
        window.ccH2H.wire(matchesEl);
    };
    const sel = el.querySelector('[h2h-week]');
    sel.addEventListener('change', () => paintWeek(sel.value));
    paintWeek(d.featuredWeek);
}

// Reserved celebration: if the logged-in manager posted the top score in the
// most recent week, bounce the Big Winner trophy and throw confetti — once per
// week (localStorage-guarded) and never under reduced-motion.
function maybeCelebrateWeeklyWin(users) {
    try {
        const myId = (userState.user_metadata && userState.user_metadata.metadata && userState.user_metadata.metadata.userId)
            || window.localStorage.getItem('userId');
        if (!myId || !Array.isArray(users) || !users.length) return;

        const weekOf = (u) => ((u.seasons && u.seasons[0] && u.seasons[0].weeklyScore) || []);
        const weeks = weekOf(users[0]).length;
        if (!weeks) return;
        const lastIdx = weeks - 1;

        const scored = users.map(u => {
            const wk = weekOf(u)[lastIdx];
            return { id: String(u._id), score: (wk && wk.score) || 0, wk };
        });
        const max = Math.max(...scored.map(s => s.score));
        if (max <= 0) return;

        const mine = scored.find(s => s.id === String(myId));
        if (!mine || mine.score !== max) return;   // you didn't (co-)win the week

        // Once per week: key by season + week so it fires the first time only.
        const season = (users[0].seasons[0].season) || '';
        const wkLabel = (mine.wk && mine.wk.season === 'postseason') ? 'post' : (mine.wk && mine.wk.week);
        const key = `weekWin-${season}-${wkLabel}`;
        if (window.localStorage.getItem(key)) return;
        window.localStorage.setItem(key, '1');

        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        // Big Winner is the first highlight card; bounce its trophy + confetti.
        const icon = document.querySelector('.highlights-container .sub-highlight-container:first-child .hl-icon');
        if (icon) icon.classList.add('celebrate');
        if (typeof startConfetti === 'function') {
            startConfetti();
            setTimeout(() => { if (typeof stopConfetti === 'function') stopConfetti(); }, 3500);
        }
    } catch (e) { /* celebration is best-effort */ }
}

// First-login nudge: if the logged-in manager hasn't been prompted yet, invite
// them to name their team + add a photo. Either choice marks them prompted so
// it never shows again; "Set up" sends them to their profile with the editor
// auto-opened.
function maybePromptProfileSetup(data) {
    try {
        const myId = (userState.user_metadata.metadata.userId) || window.localStorage.getItem('userId');
        if (!myId) return;
        const me = data.find(u => String(u._id) === String(myId));
        if (!me || me.profilePrompted) return;
        const modal = document.querySelector('[welcome-modal]');
        if (!modal || modal.dataset.wired) return;
        modal.dataset.wired = '1';

        const dismiss = async (navigate) => {
            modal.hidden = true;
            try {
                await fetch('/users/me/profile', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompted: true })
                });
            } catch (e) { /* non-blocking */ }
            if (navigate) window.location.href = `/userHome?user=${myId}&setup=1`;
        };

        modal.querySelector('[welcome-later]').addEventListener('click', () => dismiss(false));
        modal.querySelector('[welcome-setup]').addEventListener('click', () => dismiss(true));
        modal.hidden = false;
    } catch (e) { /* onboarding is best-effort */ }
}

// Toggles the "+N" tie popover on the Top Single Game card. Wired once via
// delegation so it survives re-renders; closes on outside click or Escape.
function setupTiePopovers() {
    const container = document.querySelector('.highlights-container');
    if (!container) return;
    const closeAll = (except) => container.querySelectorAll('.hl-popover:not([hidden])').forEach(p => {
        if (p === except) return;
        p.hidden = true;
        const btn = p.previousElementSibling;
        if (btn && btn.classList.contains('hl-more')) btn.setAttribute('aria-expanded', 'false');
    });
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.hl-more');
        if (!btn || !container.contains(btn)) { closeAll(); return; }
        const pop = btn.nextElementSibling;
        if (!pop || !pop.classList.contains('hl-popover')) return;
        const willOpen = pop.hidden;
        closeAll(pop);
        pop.hidden = !willOpen;
        btn.setAttribute('aria-expanded', String(willOpen));
        e.stopPropagation();
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.hl-popover, .hl-more')) closeAll(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
}
setupTiePopovers();

async function getGame(season, week, team) {

    var gamePromise = await fetch(`/games/seasonType/${season}/week/${week}/team/${team.id}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json'
        }
    });

    var game = await gamePromise;
    var response = await game.json();

    // The route answers "no game this week" with 200 + [], so a non-200 here is
    // a real failure (500 / network) rather than an empty slate — log it as one.
    if (game.status == 200) {
        return response;
    }

    console.error(`Could not load games for ${team.school}: ${response.message}`);
    return [];
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
            awayTeamLogo = '<img src="' + ccLogo(awayTeamLogo.logos) + '" style="padding-right: 5px;">';
        }

        if (homeTeamLogo == null) {
            homeTeamLogo = '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';
        } else {
            homeTeamLogo = '<img src="' + ccLogo(homeTeamLogo.logos) + '" style="padding-right: 5px;">';
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

// A rostered team's per-game points as a tappable "+N" badge — tap to reveal
// which scoring rule earned them (see the delegated handler below). '' at 0.
function scoreBadge(teamId, gameId, pts) {
    return pts > 0
        ? '<button type="button" class="score-explain" data-team="' + teamId + '" data-game="' + gameId + '" data-pts="' + pts + '" title="Why these points?"><strong style="color: #22C37A;">+' + pts + '</strong></button>'
        : '';
}

// Tap a "+N" badge to reveal which scoring rule earned the points. Standings
// game cards are <table class="game-table"> (no .game-card wrapper), so the
// breakdown is appended as a row on that table. Toggles off on a second tap.
document.addEventListener('click', async function (e) {
    var btn = e.target && e.target.closest && e.target.closest('.score-explain');
    if (!btn) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    var table = btn.closest('table.game-table');
    if (!table) return;
    var open = table.querySelector('.gc-breakdown-row');
    if (open) { open.remove(); btn.classList.remove('is-open'); return; }
    var league = window.localStorage.getItem('leagueCode');
    if (!league || league === 'undefined') {
        league = (userState && userState.user_metadata.metadata.league == 'gg') ? 'graham-league' : 'claunts-league';
    }
    var teamId = btn.getAttribute('data-team');
    var gameId = btn.getAttribute('data-game');
    var banked = Number(btn.getAttribute('data-pts'));
    var row = document.createElement('tr');
    row.className = 'gc-breakdown-row';
    row.innerHTML = '<td colspan="3"><div class="gc-breakdown">Loading…</div></td>';
    (table.querySelector('tbody') || table).appendChild(row);
    btn.classList.add('is-open');
    var box = row.querySelector('.gc-breakdown');
    try {
        var res = await fetch('/scoring-config/' + encodeURIComponent(league) + '/explain?teamId='
            + encodeURIComponent(teamId) + '&gameId=' + encodeURIComponent(gameId), { headers: { Accept: 'application/json' } });
        var data = await res.json();
        if (!res.ok || !data || !Array.isArray(data.matched) || !data.matched.length) { box.textContent = 'Breakdown unavailable.'; return; }
        var rows = data.matched.map(function (m) {
            return '<div class="bd-row"><span class="bd-pts">+' + m.points + '</span><span class="bd-label">' + m.label + '</span></div>';
        }).join('');
        var note = (typeof data.total === 'number' && data.total !== banked)
            ? '<div class="bd-note">Scoring rules or rankings changed since this game was scored, so this differs from the banked +' + banked + '.</div>'
            : '';
        box.innerHTML = rows + note;
    } catch (err) {
        box.textContent = 'Breakdown unavailable.';
    }
});

document.addEventListener('click', function (e) {
    var card = e.target.closest('.gc-clickable[data-game-id]');
    if (card) window.location.href = '/game/' + card.getAttribute('data-game-id');
});

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

    // Points a team earned in a game, resolved against that team's ROSTER OWNER.
    // scoreByTeam entries live only in the owning manager's weeklyScore, so
    // looking them up in whichever manager is currently being iterated returns 0
    // for the opponent — which is why a head-to-head card used to carry a badge
    // for only one of its two teams.
    const weeklyByTeamId = {};
    data.forEach(u => {
        const season = u.seasons.at(-1);
        (season.teams || []).forEach(t => { weeklyByTeamId[t.id] = season.weeklyScore; });
    });
    const pointsFor = (teamId, gameId) => teamGameScoreById(weeklyByTeamId[teamId], teamId, gameId);

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
                    var scoreAdded = ''; // no badge unless the winning team earned points
                    var awayTeam = '';
                    var homeTeam = '';
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
                            // Both sides of a playoff game bank points, and each is
                            // resolved against its own owner. scoreBadge renders
                            // nothing at 0, so an unrostered or scoreless team still
                            // gets no badge rather than a spurious "+0".
                            var awayPts = pointsFor(game.awayId, game.id);
                            var homePts = pointsFor(game.homeId, game.id);
                            var awayScoreAdded = scoreBadge(game.awayId, game.id, awayPts);
                            var homeScoreAdded = scoreBadge(game.homeId, game.id, homePts);

                            if (game.awayPoints > game.homePoints) {
                                topData = (game.awayPoints != null ? game.awayPoints : '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints != null ? game.homePoints : '-') + '<td class="score-added">' + homeScoreAdded + '</td>';
                            } else {
                                topData = (game.awayPoints != null ? game.awayPoints : '-') + '<td class="score-added">' + awayScoreAdded + '</td>';
                                bottomData = (game.homePoints != null ? game.homePoints : '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + homeScoreAdded + '</td>';
                            }

                        } else if ( game.awayPoints > game.homePoints ) {
                            scoreAdded = scoreBadge(game.awayId, game.id, pointsFor(game.awayId, game.id));
                            topData = (game.awayPoints != null ? game.awayPoints : '-') + '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                            bottomData = (game.homePoints != null ? game.homePoints : '-');
                        } else if (game.homePoints > game.awayPoints) {
                            scoreAdded = scoreBadge(game.homeId, game.id, pointsFor(game.homeId, game.id));

                            topData = (game.awayPoints != null ? game.awayPoints : '-');
                            bottomData = (game.homePoints != null ? game.homePoints : '-')+ '<i class="fa-solid fa-caret-left" style="padding-left: 2px;"></i></td>' + '<td class="score-added">' + scoreAdded + '</td>';
                        } else {
                            // Tie: no winner caret and no badge cell on either row.
                            topData = (game.awayPoints != null ? game.awayPoints : '-');
                            bottomData = (game.homePoints != null ? game.homePoints : '-');
                        }
                    } else {
        
                        var centralDate = new Date(game.startDate);
                        var dayAbbr = ['SUN','MON','TUE','WED','THU','FRI','SAT'][centralDate.getDay()];
                        var h = centralDate.getHours(), min = centralDate.getMinutes().toString().padStart(2, '0');
                        var standardTime = h === 0 ? '12:' + min + 'AM' : h < 12 ? h + ':' + min + 'AM' : h === 12 ? '12:' + min + 'PM' : (h - 12) + ':' + min + 'PM';

                        topData = '<span class="gc-date">' + dayAbbr + ' ' + (centralDate.getMonth() + 1) + '/' + centralDate.getDate() + '</span>';
                        bottomData = '<span class="gc-time">' + standardTime + '</span>';
                    }
        
                    var teamTable = '<td><table class="schedule-table game-table' + (game.id ? ' gc-clickable' : '') + '"' + (game.id ? ' data-game-id="' + game.id + '"' : '') + '><tbody><tr firstRow></tr>';
                    teamTable += `<tr id="awayUserRow"><td><strong>${awayUser}</strong></td></tr>`;

                    teamTable += '<tr><td style="width: 250px;">';
        
                    teamTable += awayTeam.replace('>', '>' + awayImg + awayRank);
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 70px;">' + topData;
                    teamTable += '</tr>';

                    teamTable += '<tr><td style="width: 250px;">';
                    teamTable += homeTeam.replace('>', '>' + homeImg + homeRank);
                    teamTable += '</td><td align="center" style="width: 20px; border-left: 1px solid #A4A9C2;"></td><td style="width: 100px;">' + bottomData;
                    teamTable += '</tr>';
                    teamTable += `<tr><td><strong>${homeUser}</strong></td></tr>`;
                    var wxEmoji = game.weather && game.weather.emoji ? (window.ccWeatherEmoji && window.ccWeatherEmoji[game.weather.emoji] || '') : '';
                    var wxTip = game.weather ? (game.weather.condition || '') + (game.weather.temp != null ? ' · ' + game.weather.temp + '°F' : '') : '';
                    var wxSpan = wxEmoji ? `<span class="game-weather" title="${wxTip}">${wxEmoji}</span>` : '';
                    teamTable += `</tr>${game.outlet || wxEmoji ? `<tr><td class="game-broadcast">${game.outlet ? (window.ccIcon ? window.ccIcon('broadcast', { size: 15 }) : '') + ' ' + game.outlet : ''}${wxEmoji ? ' ' + wxSpan : ''}</td></tr>` : ''}<tr><td class="game-notes">`;
                    teamTable += game.notes || '';
                    teamTable += '</td></tr>';
                    teamTable += '<tbody></table></td>';

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
                }
                // A game already in gameIds was built on its first sighting, by
                // whichever manager rosters a team in it. That card resolves both
                // teams through pointsFor, so a second pass has nothing to correct
                // — it used to rebuild and swap the whole card just to attach the
                // other manager's badge.
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

var _rivalryWeekEl = document.querySelector('[rivalry-week]');
if (_rivalryWeekEl) {
    _rivalryWeekEl.addEventListener('change', function () {
        var sel = this.options[this.selectedIndex];
        window.localStorage.setItem("week", sel.text);
        window.localStorage.setItem("weekCode", sel.value);
        document.querySelector('.football-loader').style.display = "flex";
        document.querySelector('.schedule-table').style.display = "none";
        displaySchedule(usersData);
    });
}

setTimeout(() => {
    var leagueSel = document.querySelector('[league-select]');
    if (leagueSel) {
        leagueSel.addEventListener('change', function () {
            var opt = this.options[this.selectedIndex];
            window.sessionStorage.setItem("league", opt.text);
            window.localStorage.setItem("leagueCode", opt.value);
            window.location.reload();
        });
    }
}, 200);


const noGamesMessages = [
  `
    <div class="no-matchups-message trash-talk">
        <div class="emoji wiggle">🧢</div>
        <h3>Trash Talk Saturday Canceled</h3>
        <p>No rivalry games this week. The group chat is unusually calm.</p>
        <p class="suggestion">Use this time to cook up excuses for next week.</p>
    </div>
  `,
  `
    <div class="no-matchups-message no-smoke">
        <div class="emoji fade-pulse">🫥</div>
        <h3>Nobody Wanted the Smoke</h3>
        <p>No rivalry games on the board. Everyone’s ducking this week.</p>
        <p class="suggestion">Feel free to flex your record anyway.</p>
    </div>
  `,
  `
    <div class="no-matchups-message gods-away">
        <div class="emoji blink">👀</div>
        <h3>The Rivalry Gods Looked Away</h3>
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

// Legacy-account fallback: the navbar seeds the "My team" link + caches userId
// from the Auth0 metadata. But some older accounts have no metadata.userId — for
// those, derive the id from the email against the fetched user list and cache it,
// so the localStorage-based lookups on this page (myId, highlights) still work.
function seedUserIdFromEmail(metaData, usersData) {
    if (userState.user_metadata.metadata.userId) return; // navbar already cached it
    if (!metaData || !metaData.email || !Array.isArray(usersData)) return;

    const email = metaData.email.toLowerCase();
    const user = usersData.find(u => u.email && u.email.toLowerCase() == email);
    if (user && user._id) {
        window.localStorage.setItem("userId", user._id);
        const myLink = document.querySelector('[user-home]');
        if (myLink) myLink.href = `/userHome?user=${user._id}`;
    }
}