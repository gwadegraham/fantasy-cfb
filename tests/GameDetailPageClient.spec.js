/**
 * @jest-environment jsdom
 *
 * views/gameDetail.ejs — the football game page on the shared kit (#506
 * Phase 3). Runs the page's own inline script against stubbed responses and
 * asserts what a manager reads: the tabs that cut the long final page into
 * three, the gamecast staying on top while the game is live, the fantasy
 * read football never had (who banked what; before kickoff, what a win
 * pays), and the league in the tab title.
 */

const fs = require('fs');
const path = require('path');

window.ccKickoff = require('../public/kickoff-day.js');
window.ccLogo = require('../public/logo.js').pickLogo;
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8'));

// The page's script, as the server would render it for one game id.
const EJS = fs.readFileSync(path.join(__dirname, '..', 'views', 'gameDetail.ejs'), 'utf8');
const start = EJS.indexOf('    <script>\n    (function () {');
const SCRIPT = EJS.slice(start + '    <script>'.length, EJS.indexOf('</script>', start));

const BSU = 68, WMU = 2711;
const HOUR = 3600 * 1000;

function gameOf(kind) {
    const base = {
        id: 901, season: 2026, week: 4, seasonType: 'regular', startTimeTbd: false,
        awayId: BSU, awayTeam: 'Boise State', homeId: WMU, homeTeam: 'Western Michigan',
        awayRecord: '3-1', homeRecord: '2-2', venue: 'Waldo Stadium', pregameWinProb: 0.352
    };
    if (kind === 'pre') return Object.assign(base, { startDate: new Date(Date.now() + 48 * HOUR).toISOString(), completed: false });
    const played = Object.assign(base, {
        startDate: new Date(Date.now() - 2 * HOUR).toISOString(),
        awayPoints: 32, homePoints: 7, awayLineScores: [8, 7, 10, 7], homeLineScores: [0, 0, 0, 7],
        teamStats: { away: { totalYards: 377, turnovers: 0 }, home: { totalYards: 223, turnovers: 2 } },
        playerStats: {
            away: { passing: [{ name: 'Maddux Madsen', c: 20, att: 30, yds: 204, td: 3, int: 0 }] },
            home: { passing: [{ name: 'Broc Lowry', c: 10, att: 22, yds: 110, td: 0, int: 1 }] }
        }
    });
    if (kind === 'live') return Object.assign(played, { completed: false, period: 3, clock: '7:41', situation: '2nd & 7 at WMU 34' });
    return Object.assign(played, { completed: true });
}

const owner = (franchise) => ({ userId: 'u-' + franchise, firstName: 'F', name: 'F L', franchise });
function fantasyOf(kind) {
    if (kind === 'pre') {
        return { league: 'graham-league', final: false,
            away: { teamId: BSU, owner: owner('Always Next Year'), banked: null, ifWin: 2, ifLoss: 0 },
            home: { teamId: WMU, owner: owner('Hogs Gone Wild'), banked: null, ifWin: 3, ifLoss: 1 } };
    }
    return { league: 'graham-league', final: kind === 'final',
        away: { teamId: BSU, owner: owner('Always Next Year'), banked: 1 },
        home: { teamId: WMU, owner: null, banked: null } };
}

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
const tick = () => new Promise(r => setTimeout(r, 0));

// Boots the page for one kind of game. `fantasy` may be a promise the test
// resolves itself, to control when the read lands.
async function boot(kind, opts = {}) {
    window.history.replaceState(null, '', '/game/901' + (opts.hash ? '#' + opts.hash : ''));
    document.head.innerHTML = '<title data-league-title="Game">Game</title>';
    document.body.innerHTML = '<main id="game-detail" class="sp-page fg"></main>';
    window.ccLeague = Object.assign({ sport: () => 'football', title: (p) => p + ' · The Polar Depressed · Campus Clash' }, opts.league || {});
    window.ccLeagueCode = () => (opts.code || 'graham-league');
    global.fetch = jest.fn((url) => {
        if (/\/games\/detail\//.test(url)) return ok(gameOf(kind));
        if (/\/teams\/teamLogos/.test(url)) return ok([{ id: BSU, abbreviation: 'BOIS', school: 'Boise State', color: '#0033a0', logos: [] },
            { id: WMU, abbreviation: 'WMU', school: 'Western Michigan', color: '#6c4023', logos: [] }]);
        if (/\/games\/plays\//.test(url)) return ok({ plays: [], drives: [], status: kind === 'pre' ? 'none' : 'final', source: 'db' });
        if (/\/games\/fantasy\//.test(url)) return opts.fantasy ? opts.fantasy.then(ok) : ok(fantasyOf(kind));
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
    (0, eval)(SCRIPT.replace('<%= gameId %>', '901'));
    for (let i = 0; i < 8; i++) await tick();
    return document.getElementById('game-detail');
}
const txt = (sel) => Array.from(document.querySelectorAll(sel)).map(n => n.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
const fantasyCalls = () => global.fetch.mock.calls.filter(c => /\/games\/fantasy\//.test(c[0]));
const visiblePanels = () => Array.from(document.querySelectorAll('.fg-panel')).filter(p => !p.hidden).map(p => p.getAttribute('data-panel'));

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { jest.restoreAllMocks(); delete window.ccLeague; delete window.ccLeagueCode; });

describe('the frame', () => {
    test('the kit’s two-colour hero holds the scoreboard and the line score', async () => {
        await boot('final');
        const hero = document.querySelector('.sp-hero.match.fg-hero');
        expect(hero.getAttribute('style')).toMatch(/--left:#[0-9a-f]{6};--right:#[0-9a-f]{6}/);
        expect(hero.querySelectorAll('.gd-mu-score')).toHaveLength(2);
        const lines = Array.from(document.querySelectorAll('.fg-hero .sp-lines tr'))
            .map(tr => Array.from(tr.children).map(c => c.textContent).join(' ').trim());
        expect(lines).toEqual(['Q1 Q2 Q3 Q4 T', 'BOIS 8 7 10 7 32', 'WMU 0 0 0 7 7']);
    });

    test('the tab title carries the game and the league', async () => {
        await boot('final');
        expect(document.title).toBe('Boise State at Western Michigan · The Polar Depressed · Campus Clash');
        expect(document.querySelector('title').getAttribute('data-league-title')).toBe('Boise State at Western Michigan');
    });
});

describe('a final: Summary · Play-by-play · Box score', () => {
    test('three tabs, Summary showing, the others in the page but hidden', async () => {
        await boot('final');
        expect(txt('.sp-tabs .sp-tab')).toBe('Summary | Play-by-play | Box score');
        expect(visiblePanels()).toEqual(['summary']);
        // Hidden, not absent: the plays' in-place repaint has to find them.
        expect(document.querySelector('[data-panel="plays"] #gd-pbp')).not.toBeNull();
        expect(document.querySelectorAll('[data-panel="box"] .gd-player-table')).toHaveLength(2);
    });

    test('a tab shows its panel and rides in the hash', async () => {
        await boot('final');
        document.querySelector('.sp-tab[data-tab="box"]').click();
        expect(visiblePanels()).toEqual(['box']);
        expect(window.location.hash).toBe('#box');
        expect(document.querySelector('.sp-tab.on').getAttribute('data-tab')).toBe('box');
    });

    test('a shared link opens on its tab', async () => {
        await boot('final', { hash: 'plays' });
        expect(visiblePanels()).toEqual(['plays']);
    });

    test('the reader’s tab survives a re-render', async () => {
        let land;
        await boot('final', { fantasy: new Promise(r => { land = r; }) });
        document.querySelector('.sp-tab[data-tab="box"]').click();
        land(fantasyOf('final'));                    // the read lands → the page re-renders
        for (let i = 0; i < 4; i++) await tick();
        expect(txt('.sp-fan')).toContain('+1 for Always Next Year');
        expect(visiblePanels()).toEqual(['box']);
    });

    test('team stats are the kit’s comparison rows; lower is better for turnovers', async () => {
        await boot('final');
        const rows = Array.from(document.querySelectorAll('[data-panel="summary"] .sp-vs'));
        const by = (label) => rows.find(r => r.querySelector('.mid').textContent.indexOf(label) === 0);
        expect(by('Total Yards').querySelector('.l').classList.contains('edge')).toBe(true);
        expect(by('Turnovers').querySelector('.l').classList.contains('edge')).toBe(true);
        expect(by('Turnovers').querySelector('.r').classList.contains('edge')).toBe(false);
        expect(by('Total Yards').querySelectorAll('.bars i')).toHaveLength(2);
    });

    test('the fantasy read: each side’s points banked, and whose', async () => {
        await boot('final');
        expect(txt('.sp-fan > div')).toBe('Boise State · win+1 for Always Next Year | Western Michigan · lossNot on a roster');
    });

    test('banked null is “not scored yet”, not zero', async () => {
        const f = fantasyOf('final');
        f.home = { teamId: WMU, owner: owner('Hogs Gone Wild'), banked: null };
        await boot('final', { fantasy: Promise.resolve(f) });
        expect(txt('.sp-fan > div')).toContain('Hogs Gone Wild · points post after scoring');
    });
});

describe('live: the gamecast and win probability stay on top', () => {
    test('above the tabs, and Play-by-play is not a tab while it is up there', async () => {
        await boot('live');
        const root = document.getElementById('game-detail');
        const order = Array.from(root.children).map(e => e.id || e.className.split(' ')[0]);
        const tabsAt = order.indexOf('sp-tabs');
        expect(order.indexOf('gd-pbp')).toBeGreaterThan(-1);
        expect(order.indexOf('gd-pbp')).toBeLessThan(tabsAt);
        // The situation stands in for the field, above the tabs too.
        expect(root.querySelector('.gd-livestrip').compareDocumentPosition(root.querySelector('.sp-tabs')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(txt('.sp-tabs .sp-tab')).toBe('Summary | Box score');
    });

    test('the fantasy read says what is banked so far', async () => {
        await boot('live');
        expect(txt('.sp-fan > div')).toContain('Boise State · leading+1 so far for Always Next Year');
    });
});

describe('before kickoff: the stakes', () => {
    test('one page, no tabs; the predictor, then the manager matchup', async () => {
        await boot('pre');
        expect(document.querySelector('.sp-tabs')).toBeNull();
        const heads = txt('.sp-h');
        expect(heads).toContain('Manager matchupPoints for a win');
        expect(document.querySelector('.gd-predictor').compareDocumentPosition(document.querySelector('.fg-stakes')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test('what a win pays each manager, and what to expect from it', async () => {
        await boot('pre');
        const rows = txt('.fg-stakes .sp-stake');
        // Away wins 64.8% of the time: 2 × .648 = 1.3. Home: 3 × .352 + 1 × .648 = 1.7.
        expect(rows).toBe('Always Next Year · Boise State+2expected +1.3 | Hogs Gone Wild · Western Michigan+3+1 even in a loss · expected +1.7');
        expect(document.querySelector('.sp-fan')).toBeNull();
    });

    test('one rostered side is “fantasy stakes”; the other says it is not on a roster', async () => {
        const f = fantasyOf('pre');
        f.home = { teamId: WMU, owner: null, banked: null };
        await boot('pre', { fantasy: Promise.resolve(f) });
        expect(txt('.sp-h')).toContain('Fantasy stakesPoints for a win');
        expect(txt('.fg-stakes')).toContain('Western Michigan · not on a roster');
    });
});

describe('which league', () => {
    test('asks for the league being viewed', async () => {
        await boot('final', { code: 'claunts-league' });
        expect(fantasyCalls().map(c => c[0])).toEqual(['/games/fantasy/claunts-league/901']);
    });

    test('a basketball league is not asked at all — it drafts no football teams', async () => {
        await boot('final', { league: { sport: () => 'basketball' } });
        expect(fantasyCalls()).toHaveLength(0);
        expect(document.querySelector('.sp-fan')).toBeNull();
    });

    test('a read that fails leaves the page whole', async () => {
        await boot('final', { fantasy: Promise.reject(new Error('down')) });
        expect(document.querySelector('.sp-fan')).toBeNull();
        expect(txt('.sp-tabs .sp-tab')).toBe('Summary | Play-by-play | Box score');
    });
});

describe('the read lands without re-rendering the page (#506 QA)', () => {
    const playsCalls = () => global.fetch.mock.calls.filter(c => /\/games\/plays\//.test(c[0])).length;

    test('live: no second plays fetch, and the field is not rebuilt mid-animation', async () => {
        let land;
        await boot('live', { fantasy: new Promise(r => { land = r; }) });
        const before = playsCalls();
        const strip = document.querySelector('.gd-livestrip');
        land(fantasyOf('live'));
        for (let i = 0; i < 4; i++) await tick();
        expect(txt('.sp-fan')).toContain('+1 so far for Always Next Year');
        expect(playsCalls()).toBe(before);
        expect(document.querySelector('.gd-livestrip')).toBe(strip);    // same node: not re-rendered
    });

    test('before kickoff the stakes fill their slot in place', async () => {
        let land;
        await boot('pre', { fantasy: new Promise(r => { land = r; }) });
        const predictor = document.querySelector('.gd-predictor');
        expect(document.querySelector('.fg-stakes')).toBeNull();
        land(fantasyOf('pre'));
        for (let i = 0; i < 4; i++) await tick();
        expect(document.querySelector('.fg-stakes')).not.toBeNull();
        expect(document.querySelector('.gd-predictor')).toBe(predictor);
    });

    test('a final whose points have not posted reads again a minute later', async () => {
        const f = fantasyOf('final');
        f.away.banked = null;
        const later = [];
        const realTimeout = window.setTimeout;
        jest.spyOn(window, 'setTimeout').mockImplementation((fn, ms) => {
            if (ms === 60000) { later.push(fn); return 0; }
            return realTimeout(fn, ms);
        });
        await boot('final', { fantasy: Promise.resolve(f) });
        expect(fantasyCalls()).toHaveLength(1);
        expect(later).toHaveLength(1);
        later[0]();
        for (let i = 0; i < 4; i++) await tick();
        expect(fantasyCalls()).toHaveLength(2);
    });

    test('a final with its points posted does not', async () => {
        const later = [];
        const realTimeout = window.setTimeout;
        jest.spyOn(window, 'setTimeout').mockImplementation((fn, ms) => {
            if (ms === 60000) { later.push(fn); return 0; }
            return realTimeout(fn, ms);
        });
        await boot('final');
        expect(later).toHaveLength(0);
    });
});
