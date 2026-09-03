// Harness for public/standings.js.
//
// That module exports nothing and runs side effects the moment it's imported
// (delegated click handlers, jQuery bindings, a window.onload assignment), so
// the only way to exercise it is to stand up the page it expects and load it.
// This builds that page: the DOM hooks from views/standings.ejs, the globals the
// view supplies via CDN/partials (jQuery, Chart, ccIcon, ccH2H, ccLogo,
// userState), and a routing fetch mock for the dozen endpoints it calls.
//
// Usage:
//   const page = await loadStandingsPage({ users: [...] });   // runs window.onload
//   page.tableBody().innerHTML  →  assert on what rendered

const DEFAULT_SEASON = 2025;

// Mirrors the structural hooks standings.js queries in views/standings.ejs.
// Element order matters: displayHighlights and hideLegacyH2HSchedule both reach
// for a `.hr-subtle` via previousElementSibling.
const FIXTURE = `
<a user-home href="/userHome?user=stale"></a>
<div class="welcome-backdrop" welcome-modal hidden>
    <button type="button" welcome-later>Maybe later</button>
    <button type="button" welcome-setup>Set up my profile</button>
</div>
<div class="header"><p last-updated class="last-updated"></p></div>
<div class="no-data-message" style="display: none;"></div>
<div class="get-users-container" get-users-container>
    <p class="standings-rank-note" standings-rank-note hidden></p>
    <table class="fl-table">
        <thead user-table-head></thead>
        <tbody user-table-body></tbody>
    </table>
</div>
<section class="h2h-panel" id="h2h-panel" hidden></section>
<section class="proj-panel" id="proj-panel" hidden></section>
<hr class="hr-subtle">
<h2 class="highlights-header">League Highlights</h2>
<div class="highlights-container"></div>
<hr class="hr-subtle">
<div class="header"><div class="header-title" poll-name>Rivalry Games</div></div>
<p class="section-note" schedule-note hidden></p>
<select class="rivalry-week-select" rivalry-week aria-label="Rivalry week">
    <option value="week-1">Week 1</option>
    <option value="week-2">Week 2</option>
    <option value="week-3">Week 3</option>
    <option value="week-4">Week 4</option>
    <option value="week-5">Week 5</option>
    <option value="week-6">Week 6</option>
    <option value="week-7">Week 7</option>
    <option value="week-8">Week 8</option>
    <option value="week-9">Week 9</option>
    <option value="week-10">Week 10</option>
    <option value="week-11">Week 11</option>
    <option value="week-12">Week 12</option>
    <option value="week-13">Week 13</option>
    <option value="week-14">Week 14</option>
    <option value="week-15">Week 15</option>
    <option value="week-16">Week 16</option>
    <option value="week-17">Postseason</option>
</select>
<div class="game-content">
    <div class="football-loader"></div>
    <div class="get-users-container">
        <table class="schedule-table"><tbody schedule-body></tbody></table>
        <div id="no-games-container"></div>
    </div>
</div>
<div class="chart-container" chart-container style="display: none;">
    <div class="chart-mode-toggle" chart-mode-toggle>
        <button data-mode="points" class="active"></button>
        <button data-mode="rank"></button>
    </div>
    <canvas id="week-by-week"></canvas>
</div>`;

// --- fixtures ----------------------------------------------------------------

// A league manager in the shape /users/league/:code returns.
function makeUser(over = {}) {
    const weekly = (over.weeklyScore || []).map((w, i) => Object.assign(
        { week: i + 1, season: 'regular', score: 0 },
        typeof w === 'number' ? { score: w } : w
    ));
    return Object.assign({
        _id: 'u1',
        firstName: 'Alice',
        lastName: 'Adams',
        email: 'alice@example.com',
        color: '#3355ff',
        lastUpdated: '2025-09-01T12:00:00Z'
    }, over.top || {}, {
        avatarUrl: over.avatarUrl,
        profilePrompted: over.profilePrompted !== false,
        seasons: [{
            season: over.season || DEFAULT_SEASON,
            franchiseName: over.franchiseName,
            teams: over.teams || [],
            weeklyScore: weekly,
            cumulativeScore: weekly.reduce((s, w) => s + (w.score || 0), 0)
        }]
    });
}

// --- fetch mock --------------------------------------------------------------

const RESPONSE = Symbol('response');

// Wrap a body to control the HTTP status (routes return bare bodies otherwise).
function respond(status, body) {
    return { [RESPONSE]: true, status, body };
}

function toResponse(value) {
    const wrapped = value && value[RESPONSE];
    const status = wrapped ? value.status : 200;
    const body = wrapped ? value.body : value;
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => {
            if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
            return body;
        }
    };
}

// Routes are [matcher, handler] pairs checked in order, so the more specific
// H2H paths must come before the general one. A handler that throws simulates a
// network failure; the module treats that as "fall back".
function makeFetch(routes) {
    const calls = [];
    const fetchMock = jest.fn(async (url, init) => {
        const href = String(url);
        calls.push({ url: href, init: init || {} });
        for (const [matcher, handler] of routes) {
            const hit = matcher instanceof RegExp ? matcher.test(href) : href.startsWith(matcher);
            if (hit) return toResponse(typeof handler === 'function' ? await handler(href, init) : handler);
        }
        return toResponse(respond(404, { message: `unrouted: ${href}` }));
    });
    fetchMock.calls = calls;
    return fetchMock;
}

// --- jQuery stub -------------------------------------------------------------

// standings.js uses jQuery only for the week / league dropdown buttons. This
// records .text()/.val() per selector and captures .click() handlers so a test
// can fire them.
function makeJquery() {
    const store = {};
    const handlers = {};
    const $ = (selector) => {
        const key = typeof selector === 'string' ? selector : '(node)';
        store[key] = store[key] || {};
        const chain = {
            text: (v) => (v === undefined ? (store[key].text || '') : ((store[key].text = v), chain)),
            val: (v) => (v === undefined ? (store[key].val || '') : ((store[key].val = v), chain)),
            html: () => chain,
            attr: () => undefined,
            parents: () => chain,
            find: () => chain,
            click: (fn) => { (handlers[key] = handlers[key] || []).push(fn); return chain; }
        };
        return chain;
    };
    $.store = store;
    $.handlers = handlers;
    $.fire = (selector) => (handlers[selector] || []).forEach(fn => fn.call({}));
    return $;
}

// --- page loader -------------------------------------------------------------

// Document-level listeners survive a body reset, so they're tracked and removed
// between tests — otherwise each re-import stacks another copy of the
// score-explain and tie-popover handlers.
let trackedListeners = [];
let originalAddEventListener = null;

function trackDocumentListeners() {
    if (originalAddEventListener) return;
    originalAddEventListener = document.addEventListener.bind(document);
    document.addEventListener = (type, fn, opts) => {
        trackedListeners.push([type, fn, opts]);
        originalAddEventListener(type, fn, opts);
    };
}

function resetStandingsPage() {
    trackedListeners.forEach(([type, fn, opts]) => document.removeEventListener(type, fn, opts));
    trackedListeners = [];
    window.onload = null;
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.restoreAllMocks();
}

// Settles the promise chain kicked off by window.onload. The module nests
// several `await`s inside `.then()` callbacks, so a handful of macrotask turns
// is the reliable way to let it finish.
async function flush(turns = 40) {
    for (let i = 0; i < turns; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Builds the page, installs globals, imports standings.js, and (unless
 * `autoLoad: false`) runs window.onload to completion.
 */
async function loadStandingsPage(opts = {}) {
    const {
        users = [makeUser()],
        profile = { email: 'alice@example.com', user_metadata: { metadata: { league: 'gg' } } },
        season = DEFAULT_SEASON,
        h2hEnabled = false,
        h2hStandings,
        h2hMatchups,
        projections = { managers: [] },
        advancedCards = [],
        lastUpdated,
        rankings = [],
        teamLogos = [],
        bettingLines = [],
        games = [],
        routes = [],
        userState = { user_metadata: { roles: ['Manager'], metadata: { league: 'gg', userId: 'u1' } } },
        reducedMotion = true,
        search = '',
        userAgent,
        localStorage: seedStorage = {},
        autoLoad = true
    } = opts;

    document.body.innerHTML = FIXTURE;
    trackDocumentListeners();

    // detectMobile() sniffs the UA to decide the schedule's grid wrapping.
    if (userAgent) {
        Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
    }

    Object.entries(seedStorage).forEach(([k, v]) => window.localStorage.setItem(k, v));

    // Query string drives the ?h2h=1 / ?h2hSim preview branches.
    window.history.replaceState({}, '', `/standings${search}`);

    const defaultRoutes = [
        ['/profile', profile],
        [/^\/users\/league\//, users],
        [/\/standings\/h2h\/[^/]+\/[^/]+\/enabled/, { enabled: h2hEnabled }],
        [/\/standings\/h2h\/[^/?]+\/[^/?]+\?.*standingsOnly=1/, h2hStandings || { enabled: h2hEnabled, managers: [] }],
        [/\/standings\/h2h\//, h2hMatchups || { enabled: h2hEnabled, managers: [], schedule: [] }],
        ['/standings/last-updated', lastUpdated === undefined ? respond(404, undefined) : lastUpdated],
        [/\/standings\/highlights\//, advancedCards],
        [/\/standings\/projections\//, projections],
        [/^\/rankings\//, rankings],
        ['/teams/teamLogos/all', teamLogos],
        [/^\/betting\//, bettingLines],
        [/^\/games\/seasonType\//, games],
        [/\/scoring-config\//, { matched: [], total: 0 }],
        ['/users/me/profile', { ok: true }]
    ];

    const fetchMock = makeFetch([...routes, ...defaultRoutes]);
    const jquery = makeJquery();
    const charts = [];

    global.fetch = fetchMock;
    global.$ = jquery;
    global.userState = userState;
    global.ccLogo = (logos) => (logos && logos[0]) || '';
    // The REAL shared season-underway helper, not a stub — the page's highlights
    // and chart gate on it, so the gate itself should be under test here too.
    // The navbar partial supplies it in the browser (views/partials/navbar.ejs).
    global.ccSeasonScoring = require('../../public/season-scoring.js');
    // Likewise the real ranking helper — rankedRows places the standings table
    // through it, so a stub would hide the tie behavior the rows are asserted on.
    global.ccLeagueRank = require('../../public/league-rank.js');
    global.Chart = class {
        constructor(canvas, config) { charts.push({ canvas, config }); this.destroyed = false; }
        destroy() { this.destroyed = true; }
    };
    window.ccIcon = (name, o) => `<svg data-icon="${name}" data-size="${(o || {}).size}"></svg>`;
    window.ccH2H = {
        matchupCard: (g) => `<div class="h2h-card" data-game="${g.id}"></div>`,
        wire: jest.fn()
    };
    window.matchMedia = (query) => ({ matches: reducedMotion && /reduce/.test(query), media: query });

    // displaySchedule logs a render timing; jsdom reports the unimplemented
    // navigation in the profile-setup flow. Neither is a test signal.
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    jest.resetModules();
    require('../../public/standings.js');

    // Detach the handler before jsdom's own load event fires, or the whole
    // bootstrap runs a second time and append-style renders double up.
    const onload = window.onload;
    window.onload = null;

    if (autoLoad) {
        await onload();
        await flush();
    }

    const q = (sel) => document.querySelector(sel);
    return {
        fetchMock,
        jquery,
        charts,
        season,
        flush,
        onload,
        urls: () => fetchMock.calls.map(c => c.url),
        tableHead: () => q('[user-table-head]'),
        tableBody: () => q('[user-table-body]'),
        rankNote: () => q('[standings-rank-note]'),
        highlights: () => q('.highlights-container'),
        highlightsHeader: () => q('.highlights-header'),
        projPanel: () => q('#proj-panel'),
        h2hPanel: () => q('#h2h-panel'),
        lastUpdated: () => q('[last-updated]'),
        welcomeModal: () => q('[welcome-modal]'),
        scheduleBody: () => q('[schedule-body]'),
        chartContainer: () => q('[chart-container]'),
        q
    };
}

module.exports = { loadStandingsPage, resetStandingsPage, makeUser, respond, flush, FIXTURE };
