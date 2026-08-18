var weekCode;
var userData;
var isMobile;
// The one active season (process.env.YEAR via window.APP_YEAR), set by
// renderBento. Reused renderers (displayTeams/renderProfileChart/
// displaySchedule/ensureWeekSelected) read it instead of guessing with
// seasons.at(-1), so every part of the page keys off the same season.
var uhActiveYear;

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

// The active season for the whole page: the user's entry matching the server's
// current season (window.APP_YEAR = process.env.YEAR), else the latest season on
// the doc. Every tile keys off this ONE value so they never show different
// seasons at a flip.
function uhSeasonFor(user, year) {
    const seasons = (user && user.seasons) || [];
    return seasons.find(s => String(s.season) === String(year)) || seasons[seasons.length - 1] || {};
}

// ---------- My Team bento (#230 redesign, feat/my-team-redesign) ----------
// Renders the tile grid; each tile is a glance that opens a slide-over drawer,
// all keyed off the one active season (uhSeasonFor).
async function renderBento(data) {
    const bento = document.getElementById('uh-bento');
    if (!bento || !data) return;
    const activeYear = (window.APP_YEAR && String(window.APP_YEAR))
        || (data.seasons && data.seasons.length ? String(data.seasons[data.seasons.length - 1].season) : String(new Date().getFullYear()));
    uhActiveYear = activeYear;   // reused renderers read this (see var decl)
    const season = uhSeasonFor(data, activeYear);
    const manager = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    const franchise = season.franchiseName || `${data.firstName || 'Unnamed'}'s Team`;
    document.title = ccLeague.title(franchise || manager);
    const own = currentUserId() && String(currentUserId()) === String(data._id);
    const pencil = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

    // Preseason: the active season (APP_YEAR) hasn't been *drafted* for this
    // manager yet — either there's no season entry at all, or the Season Roster
    // created one with an empty roster. Either way there's no roster or scoring to
    // key the live tiles off, so render a dedicated preseason grid (draft
    // countdown, get-ready checklist, last season, new game modes, franchise
    // history) instead of a bento that silently empties itself.
    const activeEntry = (data.seasons || []).find(s => String(s.season) === String(activeYear));
    const isPreseason = !activeEntry || !((activeEntry.teams || []).length);
    if (isPreseason) {
        renderPreseason(bento, data, activeYear, { manager, own, pencil, activeEntry });
        return;
    }

    const tile = (k, label, glance, span, affordance) => `<button class="uh-tile${span === 2 ? ' span2' : ''}" id="uh-tile-${k}" data-tile="${k}"><span class="uh-tlabel">${label}<span class="uh-chev">${affordance || '›'}</span></span><span class="uh-glance" id="uh-glance-${k}">${glance}</span></button>`;

    bento.innerHTML =
        `<div class="uh-tile span2 uh-hero">
            <div class="uh-hero-av avatar avatar-lg" id="uh-hero-av"></div>
            <div class="uh-hero-meta">
                ${heroLeagueHtml()}
                <div class="uh-hero-name">${escapeHtml(franchise)}</div>
                <div class="uh-hero-sub">${escapeHtml(franchise ? ('Managed by ' + manager) : manager)}</div>
                <div class="uh-hero-stats" id="uh-hero-stats"></div>
            </div>
            ${own ? `<button class="uh-edit" edit-profile-btn type="button" aria-label="Edit profile" hidden>${pencil}</button>` : ''}
        </div>`
        + tile('matchup', 'This week · matchup', uhPoss(own, true) + ' current H2H matchup', 2, 'Lineups ›')
        + tile('roster', 'Roster · top performers', uhPoss(own, true) + ' 10 teams', 2, 'All 10 teams ›')
        + tile('captain', 'Captain', 'Double a team each week', 1)
        + tile('recap', own ? 'Your week' : 'Their week', 'Latest recap', 1)
        + tile('schedule', 'Schedule', 'Up next', 1, 'Full schedule ›')
        + tile('games', 'Games', 'This week’s games', 1, 'This week ›')
        + tile('trajectory', 'Trajectory', 'Season points', 1)
        + tile('draft', 'Draft grade', 'Preseason projection', 1);

    renderAvatar(document.getElementById('uh-hero-av'), data);
    const statsEl = document.getElementById('uh-hero-stats');
    let sh = '';
    // Rank only once the season has really been played, and share a placement on
    // a tie ("T-3rd") — computeRank owns both calls, since both need the league.
    try {
        const rank = await computeRank(data);
        if (rank) sh += statTile(escapeHtml((rank.tie ? 'T-' : '') + ordinal(rank.rank)), `of ${rank.total} teams`);
    } catch (e) { /* rank optional */ }
    sh += statTile(String(season.cumulativeScore || 0), 'Total points');
    const bt = bestTeam(season);
    if (bt && bt.total > 0) sh += statTile(`<img src="${ccLogo(bt.team.logos)}" alt="">${bt.total}`, `Best: ${bt.team.school}`);
    statsEl.innerHTML = sh;

    if (own) setupEditModal(data, season, true);

    bento.querySelectorAll('[data-tile]').forEach(t => t.addEventListener('click', () => openDrawer(t.getAttribute('data-tile'))));
    setupDrawer();

    // Recap drawer title tracks whose profile this is (the tile itself is
    // hidden on other managers' profiles — see hydrateRecap).
    UH_DRAWERS.recap = own ? 'Your week' : 'Their week';

    // Hydrate each tile's glance + drawer from the one active season.
    hydrateH2H(data, activeYear);
    hydrateCaptain(data, activeYear);
    hydrateRecap(data, activeYear);
    hydrateDraft(data, activeYear);
    hydrateRoster(data, activeYear);
    hydrateTrajectory(data, activeYear);
    hydrateGames(data, activeYear);

    // Preview only: ?win=win|loss|tie plays a sample Win reveal so the moment
    // can be previewed anytime. The real trigger lives in hydrateH2H (fires once
    // when your weekly matchup goes final).
    maybePreviewWinReveal();
}

function maybePreviewWinReveal() {
    const r = new URLSearchParams(location.search).get('win');
    if (!r || typeof window.ccWinReveal !== 'function') return;
    const result = r === 'loss' ? 'loss' : r === 'tie' ? 'tie' : 'win';
    const samples = {
        win:  { oppLabel: 'Treyce W.', myScore: 142, oppScore: 130, bonus: 3 },
        loss: { oppLabel: 'Brock M.',  myScore: 118, oppScore: 141 },
        tie:  { oppLabel: 'Cole W.',   myScore: 126, oppScore: 126, bonus: 1 }
    };
    setTimeout(() => window.ccWinReveal(Object.assign({ result }, samples[result])), 500);
}

// ---------- Preseason My Team ----------
// The active season exists but hasn't been drafted (empty roster) — or doesn't
// exist yet. Instead of a self-emptying live grid, build a purposeful preseason
// page from data we already have: a draft countdown, a get-ready checklist, last
// season's recap, the league's new game modes (if any), and franchise history.
var uhCountdownTimer = null;

function renderPreseason(bento, data, activeYear, ctx) {
    const { manager, own, pencil, activeEntry } = ctx;
    const name = data.firstName || 'This manager';
    const franchise = (activeEntry && activeEntry.franchiseName) || `${data.firstName || 'Unnamed'}'s Team`;
    const hasName = !!(activeEntry && activeEntry.franchiseName);
    const hasPhoto = !!(data.avatarUrl);

    // Last completed season (with scores) for the recap tile.
    const prior = (data.seasons || [])
        .filter(s => String(s.season) !== String(activeYear) && (s.weeklyScore || []).length)
        .sort((a, b) => Number(b.season) - Number(a.season))[0];

    bento.innerHTML =
        // identity
        `<div class="uh-tile span2 uh-hero">
            <div class="uh-hero-av avatar avatar-lg" id="uh-hero-av"></div>
            <div class="uh-hero-meta">
                ${heroLeagueHtml()}
                <div class="uh-hero-name">${escapeHtml(franchise)}</div>
                <div class="uh-hero-sub">Managed by ${escapeHtml(manager)}</div>
                <div class="uh-hero-stats"><span class="uh-preseason-pill">${escapeHtml(activeYear)} preseason</span></div>
            </div>
            ${own ? `<button class="uh-edit" edit-profile-btn type="button" aria-label="Edit profile" hidden>${pencil}</button>` : ''}
        </div>`
        // draft countdown (hydrated async)
        + `<div class="uh-tile span2 uh-pre-draft" id="uh-pre-draft">
                <span class="uh-tlabel">${uhPoss(own, true)} draft</span>
                <div class="uh-pd-body"><p class="uh-stub">Checking the draft schedule…</p></div>
            </div>`
        // get draft-ready checklist — a personal to-do, so own profile only
        + (own ? preChecklistHtml(hasName, hasPhoto, activeYear) : '')
        // last season recap
        + preRecapHtml(prior, own, name)
        // new game modes (hydrated async; hidden until confirmed on)
        + `<div class="uh-tile span2 uh-pre-modes" id="uh-pre-modes" hidden></div>`
        // franchise history
        + preHistoryHtml(data, activeYear, own);

    renderAvatar(document.getElementById('uh-hero-av'), data);
    // Name is editable only once the manager has an active-season entry to write
    // it onto; before that only the photo can be set.
    if (own) setupEditModal(data, activeEntry || {}, !!activeEntry);

    // Mark the scoring rules as reviewed (per season) when the manager opens them
    // — flips the checklist item to done on their next visit.
    const rulesLink = document.getElementById('uh-rules-link');
    if (rulesLink) rulesLink.addEventListener('click', () => {
        try { window.localStorage.setItem('cc_seen_rules_' + activeYear, '1'); } catch (e) { /* private mode */ }
    });

    // Franchise history: expand/collapse the teams beyond the first four.
    bento.querySelectorAll('.uh-hist-more').forEach(btn => btn.addEventListener('click', () => {
        const teams = btn.closest('.uh-hist-teams');
        if (!teams) return;
        const open = teams.classList.toggle('is-open');
        btn.textContent = open ? 'Show less' : btn.getAttribute('data-more');
    }));

    hydratePreseasonDraft(data, activeYear);
    hydratePreseasonModes(data, activeYear);
}

function preChecklistHtml(hasName, hasPhoto, activeYear) {
    // "Reviewed the rules" is tracked per-season in localStorage, flipped on when
    // the manager opens /rules from the Read link (wired in renderPreseason).
    let seenRules = false;
    try { seenRules = window.localStorage.getItem('cc_seen_rules_' + activeYear) === '1'; } catch (e) { /* private mode */ }
    const done = (hasName ? 1 : 0) + (hasPhoto ? 1 : 0) + (seenRules ? 1 : 0);
    const pct = Math.round((done / 3) * 100);
    const row = (isDone, title, desc, go) =>
        `<li class="${isDone ? 'is-done' : ''}"><span class="uh-box ${isDone ? 'done' : 'todo'}">${isDone ? '✓' : '○'}</span>`
        + `<span class="uh-ci"><span class="uh-ci-t">${title}</span><span class="uh-ci-d">${desc}</span></span>${go || ''}</li>`;
    return `<div class="uh-tile uh-pre-check">
        <span class="uh-tlabel">Get draft-ready</span>
        <div class="uh-check-prog"><span class="uh-bar"><i style="width:${pct}%"></i></span><b>${done} / 3</b></div>
        <ul class="uh-checks">
            ${row(hasName, 'Name your franchise', hasName ? 'Set — you’re on the board.' : 'Stand out in the standings.')}
            ${row(hasPhoto, 'Add a profile photo', hasPhoto ? 'Looking sharp.' : 'Put a face to the trash talk.')}
            ${row(seenRules, 'Review the scoring rules', seenRules ? 'Reviewed — you know how bonuses stack.' : 'Know how bonuses stack before you pick.', seenRules ? '' : '<a class="uh-ci-go" id="uh-rules-link" href="/rules">Read ›</a>')}
        </ul>
    </div>`;
}

function preRecapHtml(prior, own, name) {
    if (!prior) {
        const firstNote = own
            ? 'This is your first Campus Clash season — welcome. Your story starts at the draft.'
            : `This is ${escapeHtml(name)}’s first Campus Clash season. Their story starts at the draft.`;
        return `<div class="uh-tile uh-pre-recap">
            <span class="uh-tlabel">${uhPoss(own, true)} history</span>
            <p class="uh-stub">${firstNote}</p>
        </div>`;
    }
    const bt = bestTeam(prior);
    let cum = 0; const series = [];
    weeklyColumns(prior).forEach(c => { if (!c.entry) return; cum += c.entry.score || 0; series.push(cum); });
    const spark = series.length >= 2 ? `<div class="uh-pre-spark">${uhSpark(series, 240, 40, '#5BD08D')}</div>` : '';
    const bestStat = (bt && bt.total > 0)
        ? `<div class="uh-pre-stat"><span class="uh-pre-stat-v"><img src="${ccLogo(bt.team.logos)}" alt="">${bt.total}</span><span class="uh-pre-stat-k">Best: ${escapeHtml(bt.team.school)}</span></div>`
        : '';
    return `<div class="uh-tile uh-pre-recap">
        <span class="uh-tlabel">${uhPoss(own, true)} ${escapeHtml(prior.season)} season</span>
        <div class="uh-pre-recap-stats">
            <div class="uh-pre-stat"><span class="uh-pre-stat-v num">${prior.cumulativeScore || 0}</span><span class="uh-pre-stat-k">Total points</span></div>
            ${bestStat}
        </div>
        ${spark}
    </div>`;
}

function preHistoryHtml(data, activeYear, own) {
    const past = (data.seasons || [])
        .filter(s => String(s.season) !== String(activeYear) && (s.teams || []).length)
        .sort((a, b) => Number(b.season) - Number(a.season));
    if (!past.length) return '';
    const rows = past.map(s => {
        const teams = s.teams || [];
        // Star the season's top scorer (not the draft-order first pick). Lead with
        // it (starred, with its points), then the rest in draft order.
        const best = bestTeam(s);
        const bestId = (best && best.total > 0) ? best.team.id : null;
        const ordered = (bestId != null ? [best.team] : [])
            .concat(teams.filter(t => bestId == null || Number(t.id) !== Number(bestId)));
        // Render every team; chips past the first 4 are hidden until the manager
        // taps "+N more" (wired in renderPreseason to toggle the row open).
        const chips = ordered.map((t, i) => {
            const isBest = bestId != null && Number(t.id) === Number(bestId);
            const pts = isBest ? ` <span class="uh-hist-pts num">${best.total}</span>` : '';
            return `<span class="uh-hist-chip${isBest ? ' r1' : ''}${i >= 4 ? ' uh-hist-extra' : ''}">${isBest ? '<span class="uh-hist-star">★</span>' : ''}${escapeHtml(t.school)}${pts}</span>`;
        }).join('');
        const moreN = ordered.length - 4;
        const more = moreN > 0 ? `<button type="button" class="uh-hist-more" data-more="+${moreN} more">+${moreN} more</button>` : '';
        // Seasons before franchise naming existed have no name — show nothing
        // rather than a hollow "Unnamed franchise" label.
        const franHtml = s.franchiseName ? `<div class="uh-hist-fran">${escapeHtml(s.franchiseName)}</div>` : '';
        return `<div class="uh-hist-row">
            <div class="uh-hist-year num">’${String(s.season).slice(2)}</div>
            <div class="uh-hist-body">${franHtml}<div class="uh-hist-teams">${chips}${more}</div></div>
        </div>`;
    }).join('');
    return `<div class="uh-tile span2 uh-pre-hist">
        <span class="uh-tlabel">${uhPoss(own, true)} franchise history</span>
        <div class="uh-hist">${rows}</div>
        <p class="uh-hist-note">★ marks ${uhPoss(own)} top scorer that year</p>
    </div>`;
}

// The commissioner's draft-night call link, re-checked before it becomes an
// href (server-side validation lives in modules/draft-call-link.js — this is the
// belt-and-braces pass, so a `javascript:` value can never render as a link).
// Returns a safe URL string, or null when there's no usable link.
function draftCallLink(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    let u;
    try { u = new URL(raw.trim()); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
}

// Draft countdown tile: fetch the league's draft for the active season, then
// show a live countdown + format/pick meta + a Draft Room CTA and the
// commissioner's video call link (or a graceful "not scheduled yet" state).
async function hydratePreseasonDraft(user, activeYear) {
    const wrap = document.getElementById('uh-pre-draft');
    if (!wrap) return;
    const own = uhOwns(user);
    const name = user.firstName || 'This manager';
    const body = wrap.querySelector('.uh-pd-body');
    let draft = null;
    try {
        const r = await fetch(`/draft/${encodeURIComponent(user.league)}/${encodeURIComponent(activeYear)}`, { headers: { Accept: 'application/json' } });
        if (r.ok) draft = await r.json();
    } catch (e) { /* fall through to the not-scheduled state */ }

    if (!draft || !draft._id) {
        body.innerHTML = `<h2 class="uh-pd-h">Draft not scheduled yet</h2>
            <p class="uh-pd-sub">${own ? 'Your' : 'The'} commissioner hasn’t set the ${escapeHtml(activeYear)} draft date. Hang tight — it’ll show up here.</p>`;
        return;
    }

    const order = (draft.draftOrder || []).map(String);
    const myPick = order.indexOf(String(user._id));
    const managers = order.length;
    const when = draft.scheduledAt ? new Date(draft.scheduledAt) : null;
    // Central, and said so — the league spans time zones and every other date
    // in the app is Central too.
    const fmtDate = when ? when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CT' : null;
    const meta = [
        fmtDate ? `<span>📅 <b>${escapeHtml(fmtDate)}</b></span>` : '',
        `<span>${draft.snake ? '🐍 <b>Snake</b>' : '<b>Linear</b>'} · ${draft.totalRounds || 10} rounds</span>`,
        managers ? `<span>👥 <b>${managers}</b> managers</span>` : '',
        myPick >= 0 ? `<span>🎯 ${own ? 'You pick' : escapeHtml(name) + ' picks'} <b>${escapeHtml(ordinal(myPick + 1))}</b></span>` : ''
    ].filter(Boolean).join('');
    const call = draftCallLink(draft.callUrl);
    const cta = `<div class="uh-pd-ctas">
            <a class="uh-pd-cta" href="/draft-room">Enter the Draft Room →</a>
            ${call ? `<a class="uh-pd-cta alt" href="${escapeHtml(call)}" target="_blank" rel="noopener noreferrer">${window.ccIcon ? window.ccIcon('video', { size: 17 }) : ''}Join the call</a>` : ''}
        </div>`;

    if (when && when.getTime() > Date.now()) {
        body.innerHTML = `<h2 class="uh-pd-h">Draft night is almost here</h2>
            <div class="uh-clock">
                ${['Days', 'Hrs', 'Min', 'Sec'].map((l, i) => `<div class="uh-unit"><div class="uh-unit-n num" data-u="${i}">–</div><div class="uh-unit-l">${l}</div></div>`).join('')}
            </div>
            <div class="uh-pd-meta">${meta}</div>${cta}`;
        startCountdown(when.getTime(), wrap);
    } else {
        body.innerHTML = `<h2 class="uh-pd-h">${uhPoss(own, true)} draft is set up</h2>
            <div class="uh-pd-meta">${meta}</div>${cta}`;
    }
}

function startCountdown(targetMs, wrap) {
    if (uhCountdownTimer) { clearInterval(uhCountdownTimer); uhCountdownTimer = null; }
    const set = (i, v) => { const el = wrap.querySelector(`[data-u="${i}"]`); if (el) el.textContent = v; };
    const p2 = n => String(n).padStart(2, '0');
    const tick = () => {
        let s = Math.max(0, Math.floor((targetMs - Date.now()) / 1000));
        set(0, Math.floor(s / 86400)); s %= 86400;
        set(1, p2(Math.floor(s / 3600))); s %= 3600;
        set(2, p2(Math.floor(s / 60)));
        set(3, p2(s % 60));
        if (targetMs - Date.now() <= 0 && uhCountdownTimer) { clearInterval(uhCountdownTimer); uhCountdownTimer = null; }
    };
    tick();
    uhCountdownTimer = setInterval(tick, 1000);
}

// New game modes tile: only for leagues that have H2H and/or Captain on for the
// active season. Reads the same per-season engagement config the scoring job and
// standings use, so it stays in lockstep (and never shows for a classic league).
async function hydratePreseasonModes(user, activeYear) {
    const tile = document.getElementById('uh-pre-modes');
    if (!tile || !user.league) return;
    let eng = null;
    try {
        const r = await fetch(`/scoring-config/${encodeURIComponent(user.league)}?season=${encodeURIComponent(activeYear)}`, { headers: { Accept: 'application/json' } });
        if (r.ok) { const c = await r.json(); eng = c.engagement || null; }
    } catch (e) { /* stays hidden */ }
    if (!eng || !(eng.h2hEnabled || eng.captainEnabled)) return;

    const own = uhOwns(user);
    const cards = [];
    if (eng.captainEnabled) cards.push(`<div class="uh-mode">
        <div class="uh-mode-h"><span class="uh-mode-i cap">©</span>Captain pick<span class="uh-mode-b cap">×${eng.captainMultiplier || 2}</span></div>
        <div class="uh-mode-d">Each week, ${own ? 'name one of your teams' : 'a manager names one team'} captain — its points count <b>double</b>. A boom-or-bust roster swings games.</div>
    </div>`);
    if (eng.h2hEnabled) cards.push(`<div class="uh-mode">
        <div class="uh-mode-h"><span class="uh-mode-i h2h">${window.ccIcon ? window.ccIcon('swords', { size: 16 }) : '⚔'}</span>Head-to-head<span class="uh-mode-b h2h">+${eng.h2hWinBonus || 3}</span></div>
        <div class="uh-mode-d">${own ? 'You’re' : 'Each manager is'} matched against a different manager every week. Outscore them for a <b>+${eng.h2hWinBonus || 3}</b> win bonus${own ? ' on top of your points' : ''}.${eng.h2hTieBonus > 0 ? ` A tie earns <b>+${eng.h2hTieBonus}</b> each.` : ''}</div>
    </div>`);

    tile.innerHTML = `<span class="uh-tlabel">New in ${escapeHtml(activeYear)}<span class="uh-mode-only">This league</span></span>
        <p class="uh-modes-intro">${cards.length > 1 ? 'Two new ways' : 'A new way'} to score this season — worth knowing before the draft.</p>
        <div class="uh-modes">${cards.join('')}</div>`;
    tile.hidden = false;
}

// Roster → Roster tile. Glance shows your top performer; drawer lists all teams
// as cards (points + share bar) then the full week-by-week grid (reused
// displayTeams). Sums per-team points from this season's weekly scoreByTeam.
function hydrateRoster(user, activeYear) {
    const tile = document.getElementById('uh-tile-roster');
    const season = uhSeasonFor(user, activeYear);
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
            ? `<span class="uh-rg">${cards.slice(0, 4).map((c, i) => `<span class="uh-rg-row"><img src="${ccLogo(c.t.logos)}" alt=""><span class="uh-rg-nm">${escapeHtml(c.t.school)}${i === 0 ? ' <span class="uh-rg-star">★</span>' : ''}</span><span class="uh-rg-pts num">${c.pts}</span></span>`).join('')}</span>`
            : (uhOwns(user) ? 'Your 10 teams' : 'Their 10 teams');
    }

    uhDrawer.roster = (body) => {
        const max = (cards[0] && cards[0].pts) || 1;
        const list = cards.map(c => `<a class="uh-rc" href="/team?team=${c.t.id}">
            <img src="${ccLogo(c.t.logos)}" alt="">
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
function hydrateTrajectory(user, activeYear) {
    const tile = document.getElementById('uh-tile-trajectory');
    const season = uhSeasonFor(user, activeYear);
    if (!(season.weeklyScore || []).length) { if (tile) tile.hidden = true; return; }

    const g = document.getElementById('uh-glance-trajectory');
    if (g) {
        let cum = 0; const series = [];
        (typeof weeklyColumns === 'function' ? weeklyColumns(season) : []).forEach(c => { if (!c.entry) return; cum += c.entry.score || 0; series.push(cum); });
        g.innerHTML = `<span class="uh-traj-g"><b class="uh-traj-num num">${season.cumulativeScore || 0}</b><span class="uh-glance-sub">total points</span></span>${series.length >= 2 ? `<span class="uh-traj-spark">${uhSpark(series, 260, 34, '#5BD08D')}</span>` : ''}`;
    }

    uhDrawer.trajectory = async (body) => {
        body.innerHTML = `<div class="uh-drawer-stats" id="uh-traj-stats"></div>
            <div class="profile-chart-section" profile-chart-section hidden><div class="profile-chart-wrap"><canvas id="profile-chart"></canvas></div></div>
            <p class="uh-stub" id="uh-traj-empty" hidden>Not enough scored weeks yet to chart a trend.</p>`;
        renderProfileChart(user);
        const section = body.querySelector('[profile-chart-section]');
        if (section && section.hidden) { const e = body.querySelector('#uh-traj-empty'); if (e) e.hidden = false; }

        // Summary row: total points, best single week, finish + gap to the
        // rest of the league (fetched from the same league standings the hero
        // rank uses, so it stays scoped to the active season).
        const statsEl = body.querySelector('#uh-traj-stats');
        if (!statsEl) return;
        let bestWk = 0;
        (season.weeklyScore || []).forEach(w => { if ((w.score || 0) > bestWk) bestWk = w.score || 0; });
        let html = statTile(String(season.cumulativeScore || 0), 'Total points');
        if (bestWk > 0) html += statTile(String(bestWk), 'Best week');
        try {
            const res = await fetch(`/users/league/${encodeURIComponent(user.league)}`, { headers: { Accept: 'application/json' } });
            if (res.ok) {
                const ranked = (await res.json())
                    .map(u => ({ id: u._id, score: (u.seasons && u.seasons[0] && u.seasons[0].cumulativeScore) || 0 }))
                    .sort((a, b) => b.score - a.score);
                const idx = ranked.findIndex(r => r.id === user._id);
                if (idx >= 0) {
                    html += statTile(`${escapeHtml(ordinal(idx + 1))} of ${ranked.length}`, 'Finish');
                    if (idx === 0 && ranked[1]) html += statTile(`+${ranked[0].score - ranked[1].score}`, 'Lead over 2nd');
                    else if (idx > 0) html += statTile(`−${ranked[0].score - ranked[idx].score}`, 'Behind leader');
                }
            }
        } catch (e) { /* stats degrade to points-only */ }
        statsEl.innerHTML = html;
    };
}

// Games → Games tile. Glance names the selected week; drawer hosts a week picker
// + this week's game cards for your rostered teams (reused displaySchedule).
async function hydrateGames(user, activeYear) {
    const tile = document.getElementById('uh-tile-games');
    const season = uhSeasonFor(user, activeYear);
    if (!(season.teams || []).length) { if (tile) tile.hidden = true; return; }
    // weekCode isn't season-scoped — reset it when the active season changes so a
    // new season doesn't inherit last season's selected week (e.g. Postseason).
    if (window.localStorage.getItem('weekSeason') !== String(activeYear)) {
        window.localStorage.removeItem('weekCode');
        window.localStorage.removeItem('week');
        window.localStorage.setItem('weekSeason', String(activeYear));
    }
    ensureWeekSelected(user);

    // Resting state: only the logos of your teams that actually play this week.
    const g = document.getElementById('uh-glance-games');
    const label = window.localStorage.getItem('week') || 'This week';
    if (g) g.innerHTML = `<span class="uh-glance-sub uh-games-wk">${escapeHtml(label)}</span>`;
    if (g) {
        try {
            let week = (window.localStorage.getItem('weekCode') || 'week-1').substring(5);
            let seasonType = 'regular';
            if (week === '17') { seasonType = 'postseason'; week = 1; }
            const per = await Promise.all((season.teams || []).map(t =>
                getGame(seasonType, week, t).then(gs => ({ t, plays: !!(gs && gs.length) })).catch(() => ({ t, plays: false }))));
            const playing = per.filter(x => x.plays).map(x => x.t);
            if (playing.length) {
                const logos = playing.map(t => `<img src="${ccLogo(t.logos)}" alt="">`).join('');
                g.innerHTML = `<span class="uh-games-logos">${logos}</span><span class="uh-glance-sub uh-games-wk">${playing.length} of ${uhPoss(uhOwns(user))} teams · ${escapeHtml(label)}</span>`;
            } else {
                g.innerHTML = `<span class="uh-glance-sub">No games for ${uhPoss(uhOwns(user))} teams · ${escapeHtml(label)}</span>`;
            }
        } catch (e) { /* keep the week label */ }
    }

    uhDrawer.games = (body) => {
        const weeks = [];
        for (let w = 1; w <= 16; w++) weeks.push(['week-' + w, 'Week ' + w]);
        weeks.push(['week-17', 'Postseason']);
        const cur = window.localStorage.getItem('weekCode') || 'week-1';
        body.innerHTML = `<label class="uh-games-pick"><select uh-games-week aria-label="Week">${weeks.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
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
            const wk = g && g.querySelector('.uh-games-wk'); if (wk) wk.textContent = label;
            run();
        });
        run();
    };
}

// Second-person copy ("Your", "You") only fits the viewer's own profile. When
// viewing another manager, fall back to neutral third-person ("Their"). These
// are function declarations so they hoist for use by the render/hydrate fns
// defined above. Ownership is resolved from the profile user's _id vs. session.
function uhOwns(user) { return !!(user && currentUserId() && String(currentUserId()) === String(user._id)); }
function uhPoss(own, cap) { return own ? (cap ? 'Your' : 'your') : (cap ? 'Their' : 'their'); }

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
// The tile that opened the drawer, so focus can return to it on close.
var uhDrawerOpener = null;
function openDrawer(key) {
    const title = UH_DRAWERS[key];
    if (title == null) return;
    uhDrawerOpener = document.getElementById('uh-tile-' + key) || document.activeElement;
    document.getElementById('uh-drawer-title').textContent = title;
    const body = document.getElementById('uh-drawer-body');
    if (uhDrawer[key]) { body.innerHTML = ''; uhDrawer[key](body); }
    else body.innerHTML = '<p class="uh-stub">This opens the “' + title + '” detail — wired to real data in the next step.</p>';
    const d = document.getElementById('uh-drawer');
    d.hidden = false;
    document.getElementById('uh-scrim').classList.add('open');
    document.body.classList.add('uh-drawer-open');   // lock background scroll
    requestAnimationFrame(() => d.classList.add('open'));
    document.getElementById('uh-drawer-close').focus();
}
function closeDrawer() {
    const d = document.getElementById('uh-drawer');
    if (!d || d.hidden) return;
    d.classList.remove('open');
    document.getElementById('uh-scrim').classList.remove('open');
    document.body.classList.remove('uh-drawer-open');
    setTimeout(() => { d.hidden = true; }, 300);
    // Return focus to the tile that opened it (accessibility).
    if (uhDrawerOpener && typeof uhDrawerOpener.focus === 'function') uhDrawerOpener.focus();
    uhDrawerOpener = null;
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
async function hydrateH2H(user, activeYear) {
    const mTile = document.getElementById('uh-tile-matchup');
    const sTile = document.getElementById('uh-tile-schedule');
    const hide = () => { if (mTile) mTile.hidden = true; if (sTile) sTile.hidden = true; };
    if (!user || !user.league || !(user.seasons || []).length || !window.ccH2H) return hide();

    const season = activeYear;

    let enabled = false;
    try {
        const r = await fetch('/scoring-config/' + encodeURIComponent(user.league) + '?season=' + encodeURIComponent(season), { headers: { Accept: 'application/json' } });
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
    (data.schedule || []).forEach(s => { const g = s.games.find(x => x.aId === uid || x.bId === uid); if (g) mine.push({ week: s.week, final: s.final !== false, upcoming: !!s.upcoming, g }); });
    if (!mine.length) return hide();

    // Win reveal: play the moment once when your latest matchup goes final —
    // own profile only, skipped when a ?win= preview is already forcing it.
    try {
        if (uhOwns(user) && typeof window.ccWinReveal === 'function' && !new URLSearchParams(location.search).get('win')) {
            const finals = mine.filter(x => x.final);
            const latest = finals[finals.length - 1];
            if (latest) {
                const g = latest.g;
                const iAmA = String(g.aId) === uid;
                const res = g.winner === 'tie' ? 'tie' : ((g.winner === 'a') === iAmA ? 'win' : 'loss');
                const oppM = byId[iAmA ? g.bId : g.aId];
                const seenKey = 'cc_winreveal_' + season + '_wk' + latest.week;
                if (window.localStorage.getItem(seenKey) !== '1') {
                    window.localStorage.setItem(seenKey, '1');
                    setTimeout(() => window.ccWinReveal({
                        result: res,
                        oppLabel: (oppM && oppM.name) || 'your opponent',
                        myScore: iAmA ? g.aScore : g.bScore,
                        oppScore: iAmA ? g.bScore : g.aScore,
                        bonus: res === 'win' ? data.winBonus : res === 'tie' ? data.tieBonus : 0
                    }), 700);
                }
            }
        }
    } catch (e) { /* non-fatal — the reveal is a bonus */ }

    const me = byId[uid];
    // On your own profile your side reads "You"; on another manager's profile a
    // name fits better than "You", so label it with their first name.
    const youLabel = uhOwns(user) ? 'You' : (user.firstName || (me && me.name) || 'Manager');

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
    // The payload now carries weeks that haven't been played yet, so "latest"
    // has to mean the last PLAYED week — otherwise a manager sitting out the
    // current week (a bye, on an odd-sized league) would be featured with a
    // matchup that hasn't happened.
    const played = mine.filter(x => !x.upcoming);
    const featuredWk = liveWk != null ? liveWk
        : (played.length ? played[played.length - 1].week : mine[mine.length - 1].week);
    const featured = mine.find(x => x.week === featuredWk);
    const cardOf = (x, open) => window.ccH2H.matchupCard(x.g, { byId, youId: uid, youLabel, week: x.week, open });
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
                <span class="uh-mug-side">${av(me)}<span class="uh-mug-nm">${escapeHtml(youLabel)}</span><span class="uh-mug-sc num${wc}">${s.meScore}</span></span>
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
        // Two groups, each in the order you'd read it: what's still to come
        // ascending (next opponent first), what's already happened descending
        // (most recent result first). The live week is the lead card, so it's
        // left out of both; when there is no live week nothing is pulled out.
        const ahead = mine.filter(x => x.upcoming).sort((a, b) => a.week - b.week);
        const behind = mine.filter(x => !x.upcoming && x.week !== liveWk).sort((a, b) => b.week - a.week);
        const lead = liveWk != null ? `<div class="uh-drawer-lead">This week</div>` + cardOf(featured, true) : '';
        const group = (cap, list) => list.length
            ? `<div class="uh-drawer-cap">${cap}</div><div class="uh-h2h-log">${list.map(x => cardOf(x, false)).join('')}</div>` : '';
        body.innerHTML = lead + group('Upcoming · tap a week', ahead) + group('Results · tap a week', behind);
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
// Kickoff-lock display helpers (Central time, matching the app's schedule).
function uhFmtLock(iso, opts) {
    if (!iso) return '';
    const o = opts || {};
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-US', o.dated
        ? { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'America/Chicago' }
        : { weekday: 'short', timeZone: 'America/Chicago' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
    return `${day} ${time}${o.tz ? ' CT' : ''}`;
}
// A ranked opponent, tiered the way the scoring tiers it: rankValue pays double
// for a top-10 win and single for 11–25. Beating ranked teams is where much of
// the model's value sits, so the pick shouldn't be made blind to it.
function uhRankTag(rank) {
    const n = Number(rank);
    if (!n || n < 1) return '';
    return `<span class="cap-rk${n <= 10 ? ' top10' : ''}">#${n}</span> `;
}
// "NC State", "NC State and LSU", "NC State, LSU and Duke".
function uhAndList(names) {
    const a = (names || []).filter(Boolean);
    if (a.length <= 1) return a[0] || '';
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}
function uhTimeLeft(iso) {
    if (!iso) return '';
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return '';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return d ? `${d}d ${h}h` : (h ? `${h}h ${m}m` : `${m}m`);
}

async function hydrateCaptain(user, activeYear) {
    const tile = document.getElementById('uh-tile-captain');
    const hide = () => { if (tile) tile.hidden = true; };
    if (!user || !user.league || !(user.seasons || []).length) return hide();
    if (String(currentUserId()) !== String(user._id)) return hide();   // own profile only

    const preview = new URLSearchParams(location.search).get('captain') === '1';
    let enabled = false;
    try {
        const r = await fetch('/scoring-config/' + encodeURIComponent(user.league) + '?season=' + encodeURIComponent(activeYear), { headers: { Accept: 'application/json' } });
        if (r.ok) { const c = await r.json(); enabled = !!(c.engagement && c.engagement.captainEnabled); }
    } catch (e) { /* fall through to preview gate */ }
    if (!enabled && !preview) return hide();

    // The server owns the lock rule: which regular week is in focus, when it
    // locks (the manager's own first kickoff), the current pick, and whether it's
    // already locked. No focus week (season over / no schedule) → nothing to show.
    let state;
    try {
        const r = await fetch('/users/me/captain?season=' + encodeURIComponent(activeYear), { headers: { Accept: 'application/json' } });
        if (!r.ok) return hide();
        state = await r.json();
    } catch (e) { return hide(); }
    if (!state || state.week == null) return hide();

    const season = uhSeasonFor(user, activeYear);
    const teamById = {};
    (season.teams || []).forEach(t => { teamById[t.id] = t; });
    if (!(season.teams || []).length) return hide();
    if (tile) tile.hidden = false;

    const slateBy = {};
    (state.slate || []).forEach(x => { slateBy[x.teamId] = x.games || []; });
    // API week 1 folds in the opening weekend, so a manager can hold a team that
    // plays a full week before the rest — and then "Sat 2:30 PM" names two
    // different Saturdays. Date the times when this week's slate straddles more
    // than one weekend, the same rule the matchup card uses.
    const kicks = (state.slate || []).flatMap(x => (x.games || [])
        .map(gm => Date.parse(gm.kickoff)).filter(n => !Number.isNaN(n)));
    const datedSlate = kicks.length > 1 && (Math.max(...kicks) - Math.min(...kicks)) > 3 * 864e5;
    // Which team actually closes the pick. The lock is the manager's EARLIEST
    // kickoff, which on an opening-weekend roster is rarely the team they were
    // looking at — so name it rather than leaving "your first team" to be
    // guessed from a grid where every tile reads the same time.
    const lockMs = state.lockAt ? Date.parse(state.lockAt) : NaN;
    const lockNames = (state.slate || [])
        .filter(x => (x.games || []).some(gm => Date.parse(gm.kickoff) === lockMs))
        .map(x => (teamById[x.teamId] || {}).school)
        .filter(Boolean);
    const lockWho = lockNames.length
        ? `<b>${escapeHtml(uhAndList(lockNames))}</b> kick${lockNames.length === 1 ? 's' : ''} off`
        : 'your first team kicks off';

    const g = document.getElementById('uh-glance-captain');
    const setGlance = () => {
        if (!g) return;
        const t = state.teamId != null ? teamById[state.teamId] : null;
        const lead = t
            ? `<span class="uh-cap-glance"><img src="${ccLogo(t.logos)}" alt=""> ${escapeHtml(t.school)} <span class="uh-cap-2x">2×</span></span>`
            : `<span class="captain-unset">${state.locked ? 'No pick · Wk ' + state.week : 'Set for Wk ' + state.week}</span>`;
        let sub;
        if (state.locked) sub = 'Locked for this week';
        else if (state.lockAt) sub = `Locks ${uhFmtLock(state.lockAt, { tz: true, dated: datedSlate })}${uhTimeLeft(state.lockAt) ? ' · ' + uhTimeLeft(state.lockAt) + ' left' : ''}`;
        else sub = 'Doubles this week’s points';
        g.innerHTML = lead + `<span class="uh-cap-sub">${sub}</span>`;
    };
    // A team's slate for the focus week, drawn under its name in the picker.
    // Two games is the case worth flagging: CFBD folds the opening weekend into
    // week 1, so a few teams play twice — and the captain doubles BOTH of them,
    // which a grid of bare logos gives no way to see.
    const tileBody = (t) => {
        const games = slateBy[t.id] || [];
        const badge = games.length > 1 ? `<span class="cap-2g">${games.length} games</span>` : '';
        const lines = games.length
            ? games.map(g => `<span class="cap-tg">${escapeHtml(g.ha)} ${uhRankTag(g.oppRank)}${escapeHtml(g.opp)}${g.kickoff ? ' · ' + escapeHtml(uhFmtLock(g.kickoff, { dated: datedSlate })) : ' · TBD'}</span>`).join('')
            : `<span class="cap-tg">No game this week</span>`;
        return `<img src="${ccLogo(t.logos)}" alt="">
            <span class="cap-tid"><span class="cap-tnm"><span class="cap-nm">${escapeHtml(t.school)}</span>${badge}</span>${lines}</span>`;
    };
    const paint = (container) => {
        if (state.locked) {
            const t = state.teamId != null ? teamById[state.teamId] : null;
            container.innerHTML = `<p class="captain-note">Locked — your first team of Week ${state.week} has kicked off. `
                + (t ? `<b>${escapeHtml(t.school)}</b> is your 2× this week.` : `No captain was set (your best team auto-doubles).`)
                + ` All times Central.</p>`
                + `<div class="captain-grid">${(season.teams || []).map(tm => `
                    <div class="captain-team is-locked${Number(state.teamId) === Number(tm.id) ? ' is-captain' : ''}">${tileBody(tm)}</div>`).join('')}</div>`;
            return;
        }
        const lockLine = state.lockAt
            ? ` Locks ${uhFmtLock(state.lockAt, { dated: datedSlate })} — when ${lockWho}${uhTimeLeft(state.lockAt) ? ` (${uhTimeLeft(state.lockAt)} left)` : ''}.`
            : ' Locks when your first team kicks off.';
        const twoGamers = (season.teams || []).filter(t => (slateBy[t.id] || []).length > 1);
        const twoLine = twoGamers.length
            ? ` <b>${twoGamers.map(t => escapeHtml(t.school)).join('</b>, <b>')}</b> play twice this week — captaining one doubles both games.`
            : '';
        container.innerHTML = `<p class="captain-note">Pick one team to score <b>2×</b> in Week ${state.week}. Tap the current pick to clear.${lockLine}${twoLine} All times Central.</p>
            <div class="captain-grid">${(season.teams || []).map(t => `
                <button type="button" class="captain-team${Number(state.teamId) === Number(t.id) ? ' is-captain' : ''}" data-team="${t.id}" aria-pressed="${Number(state.teamId) === Number(t.id)}">${tileBody(t)}</button>`).join('')}</div>`;
        container.querySelectorAll('.captain-team').forEach(btn => btn.addEventListener('click', async () => {
            const teamId = Number(btn.getAttribute('data-team'));
            const next = Number(state.teamId) === teamId ? null : teamId;   // click current to clear
            try {
                const res = await fetch('/users/me/captain', {
                    method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ season: state.season, week: state.week, teamId: next })
                });
                const data = await res.json();
                if (res.status === 409) {
                    // Kicked off between load and click — re-sync to the locked state.
                    state.locked = true;
                    setGlance(); paint(container);
                    if (window.ccToast) ccToast.error(data.message || 'Captain is locked for this week.');
                    return;
                }
                if (!res.ok) throw new Error(data.message || 'Could not set captain');
                state.teamId = next;
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
async function hydrateRecap(user, activeYear) {
    const tile = document.getElementById('uh-tile-recap');
    const hide = () => { if (tile) tile.hidden = true; };
    if (!window.ccRecap || !user || !user.league || !(user.seasons || []).length) return hide();
    // The weekly recap is a personal, second-person "Your Week" story — it isn't
    // meaningful (or correctly voiced) for someone else's profile, so hide it.
    if (!uhOwns(user)) return hide();

    try {
        const data = await window.ccRecap.fetchRecap(user.league, activeYear, user._id);
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
async function hydrateDraft(user, activeYear) {
    const tile = document.getElementById('uh-tile-draft');
    const hide = () => { if (tile) tile.hidden = true; };
    if (!user || !user.league || !(user.seasons || []).length) return hide();
    const season = activeYear;
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

        uhDrawer.draft = (body) => {
            if (typeof renderDraftGradeCard === 'function') {
                // No currentUserId passed → no "you" tag / red highlight. This
                // hydrator also renders other managers' grades (not just your
                // own), so the note stays league-neutral rather than "your".
                const leagueRef = uhOwns(user) ? 'your league’s scoring' : 'this league’s scoring';
                renderDraftGradeCard(body, mine, {
                    note: season + ' preseason grade — projected fantasy points in ' + leagueRef + ' (schedule + SP+ win odds + market CFP odds). Each draft graded on its own merit.'
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
    const weekly = uhSeasonFor(data, uhActiveYear).weeklyScore || [];
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

// Larger, UNcropped delivery for the click-to-enlarge overlay: fit the whole
// photo within 720px (c_limit never upscales past the original) so the manager
// sees the full picture, not the tight face crop used inline.
function cloudinaryAvatarLarge(url) {
    if (typeof url === 'string' && url.indexOf('/upload/') !== -1) {
        return url.replace('/upload/', '/upload/c_limit,w_720,h_720,q_auto,f_auto/');
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
        // Only the profile hero photo is click/tap-to-enlarge.
        if (el.id === 'uh-hero-av') makeAvatarZoomable(el, data);
    } else {
        el.textContent = initials(data) || '?';
        el.style.background = colorFor(data);
        if (el.id === 'uh-hero-av') clearAvatarZoomable(el);
    }
}

// ---------- Click/tap-to-enlarge for the profile hero avatar ----------

// A lightweight image lightbox, built once and reused. Mirrors the edit
// modal's conventions: full-screen blurred backdrop, click-outside + Escape to
// close. Clicking the photo itself does nothing so it can be inspected.
let avatarZoomEls = null;
function ensureAvatarZoom() {
    if (avatarZoomEls) return avatarZoomEls;
    const backdrop = document.createElement('div');
    backdrop.className = 'avatar-zoom-backdrop';
    backdrop.hidden = true;
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Profile photo');

    const img = document.createElement('img');
    img.className = 'avatar-zoom-img';
    img.alt = '';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'avatar-zoom-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';

    backdrop.appendChild(img);
    backdrop.appendChild(closeBtn);
    document.body.appendChild(backdrop);

    const close = () => { backdrop.hidden = true; document.body.style.overflow = ''; };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target === closeBtn) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !backdrop.hidden) close(); });

    avatarZoomEls = { backdrop, img };
    return avatarZoomEls;
}
function openAvatarZoom(url, alt) {
    const { backdrop, img } = ensureAvatarZoom();
    img.src = url;
    img.alt = alt || '';
    backdrop.hidden = false;
    document.body.style.overflow = 'hidden';   // freeze background scroll while open
}

// Make the hero avatar an accessible, tap-to-enlarge control. Uses onclick/
// onkeydown (not addEventListener) so re-rendering the hero replaces the
// handler instead of stacking duplicates.
function makeAvatarZoomable(el, data) {
    const alt = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    const url = cloudinaryAvatarLarge(data.avatarUrl);
    el.classList.add('avatar-zoomable');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', alt ? `View ${alt}'s profile photo larger` : 'View profile photo larger');
    el.title = 'Tap to enlarge';
    el.onclick = () => openAvatarZoom(url, alt);
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAvatarZoom(url, alt); } };
}
function clearAvatarZoomable(el) {
    el.classList.remove('avatar-zoomable');
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-label');
    el.removeAttribute('title');
    el.onclick = null;
    el.onkeydown = null;
}

// Highest-scoring team on the roster this season (summed from scoreByTeam).
function bestTeam(season) {
    const weekly = season.weeklyScore || [];
    let best = null;
    (season.teams || []).forEach(t => {
        let total = 0;
        weekly.forEach(w => (w.scoreByTeam || []).forEach(st => { if (Number(st.teamId) === Number(t.id) || st.team === t.school) total += (st.score || 0); }));
        if (!best || total > best.total) best = { team: t, total };
    });
    return best;
}

// League rank for the profile user, by current-season cumulative score.
// { rank, tie, total } — or null when there's no honest answer.
//
// The season-underway gate lives here rather than at the call site because this
// is where the whole league is in hand, and the question is league-wide: a single
// manager's season entry can't tell you whether anyone has played. It has to be
// asked, too — before the season starts every cumulativeScore is 0, and any
// placement drawn from that is really just each manager's position in the DB
// result order wearing a rank's clothes.
async function computeRank(data) {
    try {
        if (!data.league) return null;
        const res = await fetch(`/users/league/${data.league}`, { headers: { 'Accept': 'application/json' } });
        if (!res.ok) return null;
        const users = await res.json();
        // Not "does this manager have a weekly entry" — the nightly scoring job
        // seeds zero-point weeks as soon as a week's games exist, so that fires
        // before kickoff. See public/season-scoring.js.
        if (!ccSeasonScoring.seasonHasScoring(users)) return null;
        // Competition ranking, so mid-season ties share a placement instead of
        // being split by document order. See public/league-rank.js.
        return ccLeagueRank.leagueRank(users, data._id);
    } catch (e) { return null; }
}

// League eyebrow over the franchise name. The league a manager plays in is
// otherwise invisible to them after their invite, and this is the one tile every
// manager looks at. Its own line rather than appended to the "Managed by" line,
// which wraps mid-name on a phone.
function heroLeagueHtml() {
    const league = ccLeague.name();
    return league ? `<div class="uh-hero-league">${escapeHtml(league)}</div>` : '';
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
    document.title = ccLeague.title(franchise || manager);
}

// ---------- Edit modal (franchise name + avatar upload) ----------

function setupEditModal(data, season, franchiseEditable) {
    // Franchise name is per-season — until the active season exists on the doc
    // (i.e. the league has drafted), there's nothing to name, so the field is
    // locked and only the avatar can be changed.
    franchiseEditable = franchiseEditable !== false;
    const btn = document.querySelector('[edit-profile-btn]');
    const modal = document.querySelector('[profile-modal]');
    const nameInput = document.querySelector('[profile-name-input]');
    const nameNote = document.querySelector('[profile-name-note]');
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
        if (franchiseEditable) {
            nameInput.value = season.franchiseName || '';
            nameInput.disabled = false;
            nameInput.placeholder = 'Name your team';
        } else {
            nameInput.value = '';
            nameInput.disabled = true;
            nameInput.placeholder = 'Available after the draft';
        }
        if (nameNote) { nameNote.textContent = franchiseEditable ? '' : 'You can name your team once your league drafts this season.'; nameNote.hidden = franchiseEditable; }
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
        const body = {};
        if (franchiseEditable) body.franchiseName = nameInput.value;
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
            if (franchiseEditable) season.franchiseName = out.franchiseName;
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
// Matches by stable teamId (rename-safe), falling back to the school string for
// any legacy entry stored without a teamId. `team` is the roster team {id, school}.
function columnTeamScore(entry, team) {
    if (!entry) return null;
    const games = (entry.scoreByTeam || []).filter(o => Number(o.teamId) === Number(team.id) || o.team === team.school);
    if (!games.length) return null;
    return games.reduce((s, g) => s + (g.score || 0), 0);
}

function displayTeams(data) {
    const head = document.querySelector('[user-table-head]');
    const body = document.querySelector('[user-table-body]');
    const season = uhSeasonFor(data, uhActiveYear);
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
    teams.forEach(t => columns.forEach(c => { const s = columnTeamScore(c.entry, t); if (s != null && s > bestGame) bestGame = s; }));
    let bestWeek = 0;
    columns.forEach(c => { if (c.entry && (c.entry.score || 0) > bestWeek) bestWeek = c.entry.score || 0; });

    let str = '';
    teams.forEach(team => {
        let totalScore = 0;
        let cells = '';
        columns.forEach(c => {
            const s = columnTeamScore(c.entry, team);
            if (!c.entry) { cells += '<td class="cell-future"></td>'; return; }   // week not played yet
            if (s == null) { cells += '<td class="cell-bye">–</td>'; return; }    // bye / no game
            totalScore += s;
            const best = (s === bestGame && s > 0) ? ' cell-best' : '';
            cells += `<td class="${best}">${s}</td>`;
        });
        const refLink = `/team?team=${team.id}`;
        str += '<tr><th class="team-header sticky-header" scope="row">'
            + '<a href="' + refLink + '"><img src="' + ccLogo(team.logos) + '" alt="' + escapeHtml(team.mascot) + '">'
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

    const season = uhSeasonFor(data, uhActiveYear);
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

    // The route answers "no game this week" with 200 + [], so a non-200 here is
    // a real failure (500 / network) rather than an empty slate — log it as one.
    if (game.status == 200) {
        return response;
    }

    console.error(`Could not load games for ${team.school}: ${response.message}`);
    return [];
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
            awayTeamLogo = '<img src="' + ccLogo(awayTeamLogo.logos) + '" style="padding-right: 5px;">';
        }

        if (homeTeamLogo == null) {
            homeTeamLogo = '<i class="fa-solid fa-helmet-un" style="padding-right: 5px;"></i>';
        } else {
            homeTeamLogo = '<img src="' + ccLogo(homeTeamLogo.logos) + '" style="padding-right: 5px;">';
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

// Tap a game card's "+N" badge to reveal WHICH scoring rule earned the points.
// Lazily fetches the breakdown (server reuses the real engine on the game's
// week rankings + the league's config) and shows it under the card; tapping
// again hides it. Delegated so it covers every game card on the page.
document.addEventListener('click', async function (e) {
    var btn = e.target && e.target.closest && e.target.closest('.score-explain');
    if (!btn) return;
    var card = btn.closest('.game-card');
    if (!card) return;
    var open = card.querySelector('.gc-breakdown');
    if (open) { open.remove(); btn.classList.remove('is-open'); return; }
    var league = (typeof userData !== 'undefined' && userData && userData.league) || '';
    var teamId = btn.getAttribute('data-team');
    var gameId = btn.getAttribute('data-game');
    var banked = Number(btn.getAttribute('data-pts'));
    var box = document.createElement('div');
    box.className = 'gc-breakdown';
    box.textContent = 'Loading…';
    card.appendChild(box);
    btn.classList.add('is-open');
    try {
        var res = await fetch('/scoring-config/' + encodeURIComponent(league) + '/explain?teamId='
            + encodeURIComponent(teamId) + '&gameId=' + encodeURIComponent(gameId), { headers: { Accept: 'application/json' } });
        var data = await res.json();
        if (!res.ok || !data || !Array.isArray(data.matched)) { box.textContent = 'Breakdown unavailable.'; return; }
        if (!data.matched.length) { box.textContent = 'No scoring rule applied to this game.'; return; }
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
                if (t && t.logos && t.logos.length) map[t.id] = '<img src="' + ccLogo(t.logos) + '" style="padding-right: 5px;">';
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
        const pts = teamGameScoreById(uhSeasonFor(userData, uhActiveYear).weeklyScore, id, game.id);
        // The badge is a button: tap to reveal WHY this team earned these points
        // (which scoring rule fired). See the delegated handler below.
        return pts > 0 ? `<td class="score-added"><button type="button" class="score-explain" data-team="${id}" data-game="${game.id}" data-pts="${pts}" title="Why these points?"><strong>+${pts}</strong></button></td>` : '';
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
    const seasonYear = uhSeasonFor(data, uhActiveYear).season;

    if (week == '17') {
        rankingsInfo = await getRankings((week - 1), seasonType, seasonYear);
        seasonType = 'postseason';
        week = 1;
    } else {
        rankingsInfo = await getRankings(week, seasonType, seasonYear);
    }

    const allBettingLines = await getAllBettingLines(seasonYear) || [];

    // Fetch each roster team's games in parallel, then all logos in one request.
    const teamsList = uhSeasonFor(data, uhActiveYear).teams || [];
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