/**
 * @jest-environment jsdom
 *
 * public/admin-clipboard-view.js — the Clipboard on football's /admin. The
 * rules are the model's (tests/AdminClipboard.spec.js); this pins what the
 * page fetches, for whom, what it draws, and where a tap goes.
 */

const fs = require('fs');
const path = require('path');

const MODEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-clipboard.js'), 'utf8');
const VIEW = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-clipboard-view.js'), 'utf8');

const json = (body, code = 200) => Promise.resolve({ ok: code < 400, status: code, json: () => Promise.resolve(body) });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)); };

// A slice of admin.ejs: the Clipboard slot and a Toolbox with two groups.
// `tools` lists which tool containers exist — a League Manager's page has
// no platform tools.
function page(tools) {
    const card = (attr) => `<div class="function-container"><div class="sub-container" ${attr}></div></div>`;
    document.body.innerHTML = `
        <section class="cb-wrap" admin-clipboard hidden></section>
        <details class="cb-toolbox" admin-toolbox>
            <summary><span admin-toolbox-meta></span></summary>
            ${tools.includes('scores') ? `<section class="admin-group"><div class="group-head"><h2>Scoring — force a run</h2></div>${card('scores-container')}${card('expected-wins-container')}</section>` : ''}
            <section class="admin-group"><div class="group-head"><h2>League setup</h2></div>
                ${tools.includes('draft') ? card('draft-config-container') : ''}${card('engagement-container')}</section>
        </details>`;
}

const ROUTES = {
    '/seasons/football': () => json({ sport: 'football', season: 2026, status: 'in-season' }),
    '/scores/readiness/2026': () => json({ season: '2026', platform: [], leagues: [], seasonUnderway: true }),
    '/scores/status/2026': () => json({ scoredThroughWeek: 7, gamesLoadedThroughWeek: 8, unscoredResults: 3 }),
    '/job-runs': () => json([{ jobName: 'recap-notice', status: 'success', startedAt: new Date().toISOString() }]),
    '/teams/2026/cfp-odds/status': () => json({ season: 2026, makeCount: 25, champCount: 40, updatedAt: new Date(Date.now() - 23 * 864e5).toISOString() }),
    '/draft/graham-league/2026': () => json({ status: 'complete', picks: [{}, {}] }),
    '/scoring-config/graham-league?season=2026': () => json({ engagement: { captainEnabled: true, captainMultiplier: 2, h2hEnabled: true, h2hWinBonus: 3 } })
};

let calls;
async function boot({ admin = true, tools = ['scores', 'draft'], routes = {}, week = { week: 8, liveNow: null }, league = 'graham-league', name = 'gg' } = {}) {
    page(tools);
    calls = [];
    const table = Object.assign({}, ROUTES, routes);
    global.fetch = jest.fn(url => {
        calls.push(url);
        const h = table[url];
        return h ? h() : json({ message: 'nope' }, 404);
    });
    window.ADMIN_IS_ADMIN = admin;
    window.ADMIN_SPORT = undefined;
    window.APP_YEAR = '2026';
    window.ccManageLeagueCode = () => league;
    window.ccLeague = { name: () => name };
    window.ccCurrentWeek = { state: () => Promise.resolve(week) };
    window.openTool = jest.fn(() => true);
    window.displayScoresContainer = function displayScoresContainer() {};
    (0, eval)(MODEL);
    (0, eval)(VIEW);
    await flush();
    return document.querySelector('[admin-clipboard]');
}

const items = root => Array.from(root.querySelectorAll('.cb-item')).map(li => li.querySelector('.cb-label').textContent);
const item = (root, text) => Array.from(root.querySelectorAll('.cb-item')).find(li => li.textContent.includes(text));

afterEach(() => { try { window.localStorage.clear(); } catch (e) { /* jsdom */ } });

describe('what it fetches', () => {
    test('an Admin: the platform reads too, including the CFP odds', async () => {
        await boot();
        expect(calls).toEqual(expect.arrayContaining([
            '/seasons/football', '/scores/readiness/2026', '/scores/status/2026', '/job-runs',
            '/teams/2026/cfp-odds/status', '/draft/graham-league/2026', '/scoring-config/graham-league?season=2026'
        ]));
    });

    test('a commissioner never asks for platform data — but does make the league reads', async () => {
        await boot({ admin: false });
        expect(calls).not.toContain('/teams/2026/cfp-odds/status');
        expect(calls).toEqual(expect.arrayContaining(['/seasons/football', '/draft/graham-league/2026']));
    });

    test('no managed league: no league reads', async () => {
        await boot({ league: '' });
        expect(calls.some(u => /^\/draft\/|^\/scoring-config\//.test(u))).toBe(false);
    });
});

describe('what it draws', () => {
    test('the Admin view: phase, week, platform group, then the league', async () => {
        const root = await boot();
        expect(root.hidden).toBe(false);
        expect(root.querySelector('[aria-current="step"]').textContent).toContain('In season');
        expect(root.querySelector('.cb-head h2').textContent).toBe('Week 8');
        expect(Array.from(root.querySelectorAll('.cb-grp')).map(g => g.textContent)).toEqual(['Platform · every league', 'gg']);
        expect(items(root)).toEqual(expect.arrayContaining([
            '3 finals not scored yet', 'CFP odds board is 23 days old', 'Recap alert sent', 'Draft complete', 'Captain 2× · H2H +3'
        ]));
    });

    test('Admin: a gap whose tool is on the page gets its button', async () => {
        const root = await boot();
        const btn = item(root, 'not scored').querySelector('[data-cb-fix]');
        expect(btn.textContent).toBe('Score now');
    });

    test('no button when the tool is not on this page', async () => {
        // cfp-odds-container is not in this page slice, so the stale-odds row
        // stays a plain row rather than a dead button.
        const root = await boot();
        expect(item(root, 'CFP odds').querySelector('[data-cb-fix]')).toBeNull();
    });

    test('a commissioner: no platform group, and unscored finals say when automation runs', async () => {
        const root = await boot({ admin: false, tools: ['draft'] });
        expect(root.querySelectorAll('.cb-grp').length).toBe(1);
        expect(item(root, 'not scored')).toBeUndefined();
        const row = item(root, 'New results to score');
        expect(row.querySelector('[data-cb-fix]')).toBeNull();
        expect(row.querySelector('.cb-auto').textContent).toBe('Auto · 23:00');
    });

    test('a failed read drops its rows instead of inventing a state', async () => {
        const root = await boot({ routes: { '/draft/graham-league/2026': () => json({}, 500) } });
        expect(items(root).some(t => /draft/i.test(t))).toBe(false);
    });

    test('a league with no draft yet (200 + null) is reported as such', async () => {
        const root = await boot({ routes: { '/draft/graham-league/2026': () => json(null) } });
        expect(items(root)).toContain('No draft configured');
    });

    test('a bowl slate being played moves the phase to the postseason', async () => {
        const root = await boot({ week: { week: 1, liveNow: { week: 1, seasonType: 'postseason' } } });
        expect(root.querySelector('[aria-current="step"]').textContent).toContain('Bowls & CFP');
    });

    test('league names are escaped', async () => {
        const root = await boot({ name: '<img src=x onerror=alert(1)>' });
        expect(root.querySelector('img')).toBeNull();
        expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    test('every fetch failing: the Clipboard stays hidden rather than guess a phase', async () => {
        page(['scores']);
        global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
        window.ccCurrentWeek = { state: () => Promise.reject(new Error('offline')) };
        (0, eval)(MODEL);
        (0, eval)(VIEW);
        await flush();
        expect(document.querySelector('[admin-clipboard]').hidden).toBe(true);
    });

    test('readiness alone still places the season', async () => {
        const root = await boot({ routes: { '/seasons/football': () => json({}, 500) } });
        expect(root.hidden).toBe(false);
        expect(root.querySelector('[aria-current="step"]').textContent).toContain('In season');
    });
});

describe('where a tap goes', () => {
    test('a fix button opens that tool through openTool', async () => {
        const root = await boot();
        item(root, 'not scored').querySelector('[data-cb-fix]').click();
        expect(window.openTool).toHaveBeenCalledWith('scores-container', window.displayScoresContainer);
    });

    test('a phase tap previews its list; Back returns, and the current phase never moves', async () => {
        const root = await boot();
        root.querySelector('[data-cb-phase="draft"]').click();
        expect(root.querySelector('.cb-card').classList.contains('is-preview')).toBe(true);
        expect(root.querySelector('.cb-head h2').textContent).toBe('Draft prep');
        expect(root.querySelector('[aria-current="step"]').textContent).toContain('In season');
        root.querySelector('.cb-back').click();
        expect(root.querySelector('.cb-card').classList.contains('is-preview')).toBe(false);
        expect(root.querySelector('.cb-head h2').textContent).toBe('Week 8');
    });

    test('focus stays on the stepper button a keyboard user pressed', async () => {
        const root = await boot();
        const btn = root.querySelector('[data-cb-phase="draft"]');
        btn.focus();
        btn.click();
        expect(document.activeElement).toBe(root.querySelector('[data-cb-phase="draft"]'));
        expect(document.activeElement).not.toBe(btn); // a fresh node: the stepper was redrawn
    });

    test('tapping the current phase is the normal view', async () => {
        const root = await boot();
        root.querySelector('[data-cb-phase="season"]').click();
        expect(root.querySelector('.cb-card').classList.contains('is-preview')).toBe(false);
    });
});

describe('openTool (public/admin.js)', () => {
    // The real function, lifted out of admin.js: loading the whole file needs
    // the full page. It has to open the drawer BEFORE the opener runs, since
    // toggleSub measures scrollHeight and a card in a closed drawer is 0.
    const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');
    const src = ADMIN.match(/function openTool\(attr, opener\) \{[\s\S]*?\n\}/)[0];
    const openTool = new Function(src + '; return openTool;')();

    beforeEach(() => {
        document.body.innerHTML = `
            <details admin-toolbox><summary>Toolbox</summary>
                <div class="function-container"><div class="button-container"><button>Update Scores</button></div>
                    <div class="sub-container" scores-container></div></div>
            </details>`;
        Element.prototype.scrollIntoView = jest.fn();
    });

    test('opens the drawer before the card, then focuses the tool', () => {
        let drawerOpenWhenOpenerRan = null;
        const opener = jest.fn(() => { drawerOpenWhenOpenerRan = document.querySelector('details').open; });
        expect(openTool('scores-container', opener)).toBe(true);
        expect(opener).toHaveBeenCalled();
        expect(drawerOpenWhenOpenerRan).toBe(true);
        expect(document.activeElement.textContent).toBe('Update Scores');
    });

    test('an already-open card is not toggled shut', () => {
        document.querySelector('[scores-container]').classList.add('open');
        const opener = jest.fn();
        openTool('scores-container', opener);
        expect(opener).not.toHaveBeenCalled();
    });

    test('a tool not on the page: false, nothing runs', () => {
        const opener = jest.fn();
        expect(openTool('cfp-odds-container', opener)).toBe(false);
        expect(opener).not.toHaveBeenCalled();
    });

    test('the readiness Fix and the status strip both route through it', () => {
        expect(ADMIN).toMatch(/if \(target\) openTool\(target\[0\], target\[1\]\);/);
        expect(ADMIN).toMatch(/openTool\('scores-container', displayScoresContainer\);/);
    });
});

describe('the Toolbox drawer', () => {
    test('its bar counts the tools and names the groups', async () => {
        await boot();
        expect(document.querySelector('[admin-toolbox-meta]').textContent).toBe('4 tools · Scoring, League setup');
    });

    test('a League Manager\'s drawer counts only what they have', async () => {
        await boot({ admin: false, tools: ['draft'] });
        expect(document.querySelector('[admin-toolbox-meta]').textContent).toBe('2 tools · League setup');
    });

    test('open or closed is remembered in this browser', async () => {
        await boot();
        const box = document.querySelector('[admin-toolbox]');
        expect(box.open).toBe(false);
        box.open = true;
        box.dispatchEvent(new Event('toggle'));
        expect(window.localStorage.getItem('ccAdminToolboxOpen')).toBe('1');
        await boot();
        expect(document.querySelector('[admin-toolbox]').open).toBe(true);
    });
});

describe('the page markup', () => {
    const EJS = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
    const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-clipboard.css'), 'utf8');

    test('every tool section sits inside the Toolbox drawer', () => {
        const open = EJS.indexOf('<details class="cb-toolbox" admin-toolbox>');
        const close = EJS.indexOf('</details>');
        expect(open).toBeGreaterThan(-1);
        const groups = [...EJS.matchAll(/<section class="admin-group">/g)].map(m => m.index);
        groups.forEach(i => { expect(i).toBeGreaterThan(open); expect(i).toBeLessThan(close); });
        expect(EJS.indexOf("include('partials/admin-league-setup'")).toBeGreaterThan(open);
        expect(EJS.indexOf("include('partials/admin-league-setup'")).toBeLessThan(close);
    });

    test('the Clipboard loads after admin.js, whose openTool and openers it calls', () => {
        expect(EJS.indexOf('admin-clipboard-view.js')).toBeGreaterThan(EJS.indexOf('src="admin.js"'));
        expect(EJS.indexOf('src="admin-clipboard.js"')).toBeLessThan(EJS.indexOf('admin-clipboard-view.js'));
    });

    test('the role is the server\'s answer', () => {
        expect(EJS).toMatch(/window\.ADMIN_IS_ADMIN = <%= isAdmin \? 'true' : 'false' %>/);
    });

    test('no bare Bootstrap layout class in the Clipboard\'s CSS', () => {
        const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        const classes = [...rules.matchAll(/\.([a-z][\w-]*)/g)].map(m => m[1]);
        const bare = ['row', 'col', 'card', 'lead', 'table', 'container', 'btn', 'badge', 'nav'];
        expect(classes.filter(c => bare.includes(c))).toEqual([]);
        expect(classes.filter(c => !c.startsWith('cb') && !['admin-group', 'is-shown', 'is-preview'].includes(c))).toEqual([]);
    });
});
