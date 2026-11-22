// public/betting.js — live scores and game links on the betting page.
//
// Loaded into jsdom with the scripts the view loads ahead of it. Inline onclick
// attributes must run (the picker rows use them), hence runScripts 'dangerously'.
// fetch is stubbed per test; init()'s own load stays pending on a promise that
// never resolves, so only what a test drives runs.

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

function page() {
    const dom = new JSDOM(
        '<!doctype html><body data-page-sport="football">'
        + '<span id="week-label"></span><button id="week-prev"></button><button id="week-next"></button>'
        + '<div id="betting-content"></div></body>',
        { runScripts: 'dangerously', url: 'http://localhost/betting', virtualConsole: new VirtualConsole() }
    );
    const w = dom.window;
    w.APP_YEAR = '2026';
    w.userState = {};
    w.fetch = () => new Promise(() => {});
    w.matchMedia = () => ({ matches: false });
    ['kickoff-day.js', 'leg-display.js', 'betting.js'].forEach(f => {
        const el = w.document.createElement('script');
        el.textContent = read(f);
        w.document.body.appendChild(el);
    });
    return w;
}

const LIVE = {
    id: 401, awayTeam: 'Stanford', homeTeam: 'Duke', awayAbbr: 'STAN', homeAbbr: 'DUKE',
    startDate: '2026-11-21T17:00:00.000Z', completed: false, state: 'live',
    period: 3, clock: '8:42', awayPoints: 7, homePoints: 21, awayLogos: [], homeLogos: []
};
const PRE = Object.assign({}, LIVE, {
    id: 402, awayTeam: 'Iowa', homeTeam: 'Rice', state: 'pre', period: null, clock: null,
    awayPoints: null, homePoints: null, startDate: '2026-11-22T01:00:00.000Z'
});

function json(body) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe('game picker', () => {
    it('links each game to its page without selecting it', () => {
        const w = page();
        w.eval(`games = ${JSON.stringify([LIVE, PRE])};`);
        w.selectGame = jest.fn();
        w.document.body.insertAdjacentHTML('beforeend', w.renderGameList([LIVE, PRE]));

        const link = w.document.querySelector('[data-picker-game="401"] .game-picker-link');
        expect(link.getAttribute('href')).toBe('/game/401');
        // jsdom has no navigation; the point is the row's handler never fires.
        link.addEventListener('click', e => e.preventDefault());
        link.click();
        expect(w.selectGame).not.toHaveBeenCalled();

        // The row itself still picks the game.
        w.document.querySelector('[data-picker-game="401"] .game-picker-teams').click();
        expect(w.selectGame).toHaveBeenCalledWith(401);
    });

    it('shows the score and clock for a live game, kickoff for one not started', () => {
        const w = page();
        w.document.body.insertAdjacentHTML('beforeend', w.renderGameList([LIVE, PRE]));
        const live = w.document.querySelector('[data-picker-game="401"] .game-picker-time').textContent;
        expect(live).toContain('7–21');
        expect(live).toContain('Q3 8:42');
        const pre = w.document.querySelector('[data-picker-game="402"] .game-picker-time').textContent;
        expect(pre).not.toMatch(/\d+–\d+/);
        expect(pre.length).toBeGreaterThan(0);
    });
});

describe('leg game line', () => {
    it('links to the game page and carries the live score', () => {
        const w = page();
        const html = w.matchupLine(LIVE, 401);
        const div = w.document.createElement('div');
        div.innerHTML = html;
        const a = div.querySelector('a.leg-game-link');
        expect(a.getAttribute('href')).toBe('/game/401');
        expect(a.textContent).toContain('Q3 8:42');
        expect(a.textContent).toContain('STAN 7');
        expect(a.textContent).toContain('21 DUKE');
    });

    it('shows just the matchup before kickoff', () => {
        const w = page();
        const div = w.document.createElement('div');
        div.innerHTML = w.matchupLine(PRE, 402);
        expect(div.textContent).toBe('Iowa @ Rice');
    });
});

describe('live refresh', () => {
    function mount(w, list) {
        w.eval(`games = ${JSON.stringify(list)}; currentWeek = 12;`);
        w.document.getElementById('betting-content').innerHTML = list.map(g =>
            '<div class="leg-game" data-leg-game="' + g.id + '">' + w.matchupLine(g, g.id) + '</div>').join('');
    }

    it('patches a live score in place and asks only for live games', async () => {
        const w = page();
        mount(w, [LIVE, PRE]);
        const node = w.document.querySelector('[data-leg-game="401"]');
        w.fetch = jest.fn(() => json([Object.assign({}, LIVE, { homePoints: 28, clock: '2:10' })]));

        await w.refreshLive();

        expect(w.fetch).toHaveBeenCalledWith('/betting/games/2026/12?live=1');
        expect(w.document.querySelector('[data-leg-game="401"]')).toBe(node);  // same node, not rebuilt
        expect(node.textContent).toContain('28 DUKE');
        expect(node.textContent).toContain('Q3 2:10');
    });

    // The game that went final leaves the live list, so its final score is only
    // in the full week.
    it('reloads the whole week when a game goes final', async () => {
        const w = page();
        mount(w, [LIVE, PRE]);
        const final = Object.assign({}, LIVE, { state: 'final', completed: true, period: null, clock: null, homePoints: 35 });
        w.fetch = jest.fn(url => json(url.includes('live=1') ? [] : [final, PRE]));

        await w.refreshLive();

        expect(w.fetch).toHaveBeenCalledWith('/betting/games/2026/12');
        const text = w.document.querySelector('[data-leg-game="401"]').textContent;
        expect(text).toContain('35 DUKE');
        expect(text).not.toContain('Q3');
    });
});
