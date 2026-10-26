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
            <section admin-jobs tabindex="-1"><h3>Automated jobs <span admin-jobs-count></span></h3><ul admin-jobs-list></ul></section>
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
        expect(classes.filter(c => !c.startsWith('cb') && !['admin-group', 'is-shown', 'is-preview', 'ha-top', 'ha-league'].includes(c))).toEqual([]);
    });
});

describe('basketball (/hoops/admin)', () => {
    const HOOPS = {
        '/seasons/basketball': () => json({ sport: 'basketball', season: 2027, status: 'preseason' }),
        '/hoops/admin/status': () => json({ season: 2027, seasonStatus: 'preseason', onFile: {
            teams: { teams: 365, withLogos: 365 }, games: { games: 0, finals: 0 }, roster: { players: 5264 } } }),
        '/hoops/admin/preseason': () => json({ season: 2027, current: { teams: 365, ranked: 0, sources: 0 } }),
        '/job-runs': () => json([]),
        '/draft/hoops-league/2027': () => json({ draftOrder: ['a', 'b'], totalRounds: 10, poolSize: 120 }),
        '/scoring-config/hoops-league?season=2027': () => json({ engagement: { captainEnabled: true, captainMultiplier: 2 } }),
        '/users/league/hoops-league/roster': () => json({ season: 2027, players: [{ inSeason: true }, { inSeason: true }, { inSeason: false }] })
    };

    // A slice of hoopsAdmin.ejs. An Admin's drawer holds the data-task area
    // (drawn later by hoopsAdmin.js) and the preseason section.
    async function bootHoops({ admin = true, routes = {} } = {}) {
        document.body.innerHTML = `
            <section class="cb-wrap" admin-clipboard hidden></section>
            <details class="cb-toolbox" admin-toolbox>
                <summary><span admin-toolbox-meta></span></summary>
                <section admin-jobs data-toolbox-group="Automated jobs" tabindex="-1"><h3><span admin-jobs-count></span></h3><ul admin-jobs-list></ul></section>
                ${admin ? '<main id="hoops-admin" data-toolbox-group="Basketball data"></main><section id="hoops-preseason" data-toolbox-group="Preseason ratings"></section>' : ''}
                <section class="admin-group"><div class="group-head"><h2>League setup</h2></div>
                    <div class="function-container"><div class="sub-container" draft-config-container></div></div></section>
            </details>`;
        calls = [];
        const table = Object.assign({}, HOOPS, routes);
        global.fetch = jest.fn(url => { calls.push(url); const h = table[url]; return h ? h() : json({ message: 'nope' }, 404); });
        window.ADMIN_IS_ADMIN = admin;
        window.ADMIN_SPORT = 'basketball';
        window.APP_YEAR = '2027';
        window.ccManageLeagueCode = () => 'hoops-league';
        window.ccLeague = { name: () => 'Hardwood Heroes' };
        window.ccCurrentWeek = { state: jest.fn(() => Promise.resolve({ week: 3 })) };
        window.openTool = jest.fn(() => true);
        (0, eval)(MODEL);
        (0, eval)(VIEW);
        await flush();
        return document.querySelector('[admin-clipboard]');
    }

    afterEach(() => { window.ADMIN_SPORT = undefined; });

    test('an Admin: basketball reads only — never football readiness, status or odds', async () => {
        await bootHoops();
        expect(calls).toEqual(expect.arrayContaining(Object.keys(HOOPS)));
        expect(calls.some(u => /^\/scores\/|cfp-odds|\/seasons\/football/.test(u))).toBe(false);
        // The week follows the VIEWED league, which may be football here.
        expect(window.ccCurrentWeek.state).not.toHaveBeenCalled();
    });

    test('a commissioner: no Admin-only reads (they 404), but the league reads happen', async () => {
        await bootHoops({ admin: false });
        expect(calls.filter(u => /^\/hoops\/admin/.test(u))).toEqual([]);
        expect(calls).toEqual(expect.arrayContaining(['/seasons/basketball', '/draft/hoops-league/2027', '/users/league/hoops-league/roster']));
    });

    test('Admin data-in phase: gaps point at the basketball tasks', async () => {
        const root = await bootHoops();
        expect(root.querySelector('[aria-current="step"]').textContent).toContain('Data in');
        expect(item(root, 'No schedule on file').querySelector('[data-cb-fix]').textContent).toBe('Import');
        expect(item(root, 'No preseason ratings').querySelector('[data-cb-fix]')).not.toBeNull();
        expect(items(root)).toEqual(expect.arrayContaining(['2 managers', 'Draft date not set', 'Captain 2×']));
    });

    test('a task button targets its card even though hoopsAdmin.js has not drawn it yet', async () => {
        const root = await bootHoops();
        expect(document.querySelector('[data-task="schedule"]')).toBeNull();
        item(root, 'No schedule on file').querySelector('[data-cb-fix]').click();
        expect(window.openTool).toHaveBeenCalledWith('data-task="schedule"', null);
    });

    test('with the REAL openTool and no cards drawn yet, Import still opens the drawer on the data area', async () => {
        const root = await bootHoops();
        const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');
        window.openTool = new Function(ADMIN.match(/function openTool\(attr, opener\) \{[\s\S]*?\n\}/)[0] + '; return openTool;')();
        Element.prototype.scrollIntoView = jest.fn();
        const box = document.querySelector('[admin-toolbox]');
        expect(box.open).toBe(false);
        item(root, 'No schedule on file').querySelector('[data-cb-fix]').click();
        expect(box.open).toBe(true);
        expect(document.activeElement.id).toBe('hoops-admin');
    });

    test('the drawer setting is per sport', async () => {
        window.localStorage.setItem('ccAdminToolboxOpen', '1');
        await bootHoops();
        expect(document.querySelector('[admin-toolbox]').open).toBe(false);
        window.localStorage.setItem('ccAdminToolboxOpen:basketball', '1');
        await bootHoops();
        expect(document.querySelector('[admin-toolbox]').open).toBe(true);
    });

    test('a commissioner gets the league rows only, and goes straight to draft prep', async () => {
        const root = await bootHoops({ admin: false });
        expect(root.querySelectorAll('.cb-grp').length).toBe(1);
        expect(root.querySelector('[aria-current="step"]').textContent).toContain('Draft night');
        expect(root.querySelector('[data-cb-fix="hoops-schedule"]')).toBeNull();
    });

    test('season status falls back to the hoops payload when /seasons fails', async () => {
        const root = await bootHoops({ routes: { '/seasons/basketball': () => json({}, 500) } });
        expect(root.hidden).toBe(false);
    });

    test('the drawer recounts when hoopsAdmin.js draws its task cards', async () => {
        await bootHoops();
        const meta = document.querySelector('[admin-toolbox-meta]');
        expect(meta.textContent).toBe('1 tool · Automated jobs, Basketball data, Preseason ratings, League setup');
        document.getElementById('hoops-admin').innerHTML = '<section class="ha-task"></section><section class="ha-task"></section>';
        await flush();
        expect(meta.textContent).toBe('3 tools · Automated jobs, Basketball data, Preseason ratings, League setup');
    });
});

describe('the basketball page markup', () => {
    const EJS = fs.readFileSync(path.join(__dirname, '..', 'views', 'hoopsAdmin.ejs'), 'utf8');

    test('with a league: Clipboard, then the roster, then the drawer holding every tool', () => {
        const cb = EJS.indexOf('admin-clipboard hidden');
        const open = EJS.indexOf('<details class="cb-toolbox" admin-toolbox>');
        const close = EJS.indexOf('</details>');
        expect(cb).toBeGreaterThan(-1);
        expect(cb).toBeLessThan(open);
        expect(EJS.indexOf('user-table-body')).toBeLessThan(open);
        const firstTasks = EJS.indexOf('id="hoops-admin"');
        expect(firstTasks).toBeGreaterThan(open);
        expect(firstTasks).toBeLessThan(close);
        expect(EJS.indexOf("include('partials/admin-league-setup'")).toBeGreaterThan(open);
        expect(EJS.indexOf("include('partials/admin-league-setup'")).toBeLessThan(close);
    });

    test('the Clipboard scripts load only with admin.js, after it', () => {
        const block = EJS.slice(EJS.indexOf('<% if (manageLeague) { %>'), EJS.indexOf('<title>'));
        expect(block.indexOf('/admin.js')).toBeGreaterThan(-1);
        expect(block.indexOf('/admin-clipboard-view.js')).toBeGreaterThan(block.indexOf('/admin.js'));
    });

    test('an Admin with no basketball league keeps the data tasks open: no drawer, no Clipboard', () => {
        const noLeague = EJS.slice(EJS.indexOf('<% } else if (_admin) { %>'), EJS.indexOf('</body>'));
        expect(noLeague).toMatch(/id="hoops-admin"/);
        expect(noLeague).not.toMatch(/admin-toolbox|admin-clipboard/);
    });

    test('one page title: hoopsAdmin.js\'s own heading is hidden inside the drawer', () => {
        const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin-clipboard.css'), 'utf8');
        expect(CSS).toMatch(/\.cb-toolbox \.ha-top h1 \{ display: none; \}/);
        expect(EJS).toMatch(/role="heading" aria-level="1"><%= _admin \? 'Basketball Admin'/);
    });

    test('the role is the server\'s answer', () => {
        expect(EJS).toMatch(/window\.ADMIN_IS_ADMIN = <%= \(typeof isAdmin !== 'undefined' && isAdmin\) \? 'true' : 'false' %>/);
    });
});

describe('the Automated jobs list: the same on both sports', () => {
    const jobRows = () => Array.from(document.querySelectorAll('[admin-jobs-list] .cb-job'));
    const names = () => jobRows().map(li => li.querySelector('b').textContent);

    test('football lists every scheduled football job, never-run included, and no basketball job', async () => {
        await boot({ routes: { '/job-runs': () => json([
            { jobName: 'daily-scores', status: 'success', startedAt: new Date().toISOString() },
            { jobName: 'hoops-scores', status: 'error', startedAt: new Date().toISOString() }
        ]) } });
        expect(jobRows()).toHaveLength(9);
        expect(names()).not.toContain('Scores');
        expect(document.querySelector('[admin-jobs-list]').textContent).toContain('No runs yet');
        expect(document.querySelector('[admin-jobs-count]').textContent).toBe('All clear');
    });

    test('a failed job goes to the top, amber, with its message; the header counts it', async () => {
        await boot({ routes: { '/job-runs': () => json([
            { jobName: 'daily-scores', status: 'success', startedAt: new Date().toISOString() },
            { jobName: 'enrichment', status: 'error', startedAt: new Date().toISOString(), message: 'CFBD 500' }
        ]) } });
        const first = jobRows()[0];
        expect(first.classList.contains('cb-job-warn')).toBe(true);
        expect(first.textContent).toContain('Schedule / SP+ / media');
        expect(first.textContent).toContain('Failed');
        expect(first.textContent).toContain('CFBD 500');
        expect(document.querySelector('[admin-jobs-count]').textContent).toBe('1 needs you');
        expect(document.querySelector('[admin-jobs]').classList.contains('cb-jobs-attn')).toBe(true);
    });

    test('a nightly scoring job that has not run in season is flagged on the list too', async () => {
        await boot({ routes: { '/job-runs': () => json([]) } });
        const first = jobRows()[0];
        expect(first.textContent).toContain('Daily scores');
        expect(first.textContent).toContain('Has not run');
    });

    test('a League Manager sees the list too, as they saw the old strip', async () => {
        await boot({ admin: false, tools: ['draft'] });
        expect(calls).toContain('/job-runs');
        expect(jobRows()).toHaveLength(9);
    });

    test('a code error mid-load still clears "Loading…"', async () => {
        page(['scores']);
        document.querySelector('[admin-jobs-list]').innerHTML = '<li>Loading…</li>';
        global.fetch = jest.fn(() => json({}));
        window.ADMIN_IS_ADMIN = true; window.APP_YEAR = '2026';
        window.ccManageLeagueCode = () => { throw new Error('boom'); };
        window.ccLeague = { name: () => { throw new Error('boom'); } };
        window.ccCurrentWeek = { state: () => { throw new Error('boom'); } };
        (0, eval)(MODEL); (0, eval)(VIEW); await flush();
        expect(document.querySelector('[admin-jobs-list]').textContent).toBe('Could not read the job history.');
    });

    test('job history unreadable: says so instead of an empty list', async () => {
        await boot({ routes: { '/job-runs': () => json({}, 500) } });
        expect(document.querySelector('[admin-jobs-list]').textContent).toBe('Could not read the job history.');
    });

    test('the Clipboard\'s job row opens the list', async () => {
        const root = await boot({ routes: { '/job-runs': () => json([]) } });
        item(root, 'Daily scores has not run').querySelector('[data-cb-fix]').click();
        expect(window.openTool).toHaveBeenCalledWith('admin-jobs', null);
    });

    test('a previewed phase does not redraw the list', async () => {
        const root = await boot({ routes: { '/job-runs': () => json([]) } });
        const before = document.querySelector('[admin-jobs-list]').innerHTML;
        root.querySelector('[data-cb-phase="draft"]').click();
        expect(document.querySelector('[admin-jobs-list]').innerHTML).toBe(before);
    });

    test('basketball lists its 10 jobs in the same markup', async () => {
        document.body.innerHTML = `<section admin-clipboard hidden></section>
            <section admin-jobs><h3><span admin-jobs-count></span></h3><ul admin-jobs-list></ul></section>`;
        calls = [];
        global.fetch = jest.fn(url => { calls.push(url);
            if (url === '/seasons/basketball') return json({ status: 'in-season' });
            if (url === '/job-runs') return json([{ jobName: 'hoops-net', status: 'success', startedAt: new Date().toISOString() }]);
            return json(null); });
        window.ADMIN_IS_ADMIN = true; window.ADMIN_SPORT = 'basketball'; window.APP_YEAR = '2027';
        window.ccManageLeagueCode = () => 'hoops-league';
        (0, eval)(MODEL); (0, eval)(VIEW); await flush();
        expect(jobRows()).toHaveLength(10);
        // Same markup; the one that ran (NCAA NET) lists ahead of never-run ones.
        expect(jobRows()[0].textContent).toContain('NCAA NET');
        expect(document.querySelector('[admin-jobs-count]').textContent).toBe('All clear');
        window.ADMIN_SPORT = undefined;
    });
});

describe('the retired panels', () => {
    const ADMIN = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.js'), 'utf8');
    const EJS = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
    const HOOPS_EJS = fs.readFileSync(path.join(__dirname, '..', 'views', 'hoopsAdmin.ejs'), 'utf8');

    test('the status strip and readiness panel are gone from football\'s page', () => {
        expect(EJS).not.toMatch(/admin-status|season-readiness/);
        expect(ADMIN).not.toMatch(/function (loadAdminStatus|renderAdminStatus|loadReadiness|renderReadiness)\b/);
    });

    test('both pages carry the same jobs section, inside the Toolbox', () => {
        [EJS, HOOPS_EJS].forEach(src => {
            const open = src.indexOf('admin-toolbox>');
            const jobs = src.indexOf('admin-jobs data-toolbox-group="Automated jobs"');
            expect(jobs).toBeGreaterThan(open);
            expect(jobs).toBeLessThan(src.indexOf('</details>'));
        });
    });
});
