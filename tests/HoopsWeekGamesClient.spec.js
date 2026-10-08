/**
 * @jest-environment jsdom
 *
 * My Team's Games tile on a basketball league (#501) — public/hoops-week-games.js,
 * and the branch in public/userHome.js hydrateGames that hands it the tile.
 *
 * The tile read "No games for your teams · Week 6" with Duke playing: it asked
 * football's calendar for the week and football's games collection for the
 * games. What a manager reads now: their basketball teams' logos for the
 * basketball week, and a drawer of those games — no betting lines, no AP
 * ranks, no 1–16 + Postseason picker.
 */

const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

beforeAll(() => {
    (0, eval)(read('kickoff-day.js'));
    (0, eval)(read('sport-page.js'));
    (0, eval)(read('hoops-week-games.js'));
});
const hg = () => window.ccHoopsWeekGames;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)); };

const DUKE = { id: 1, school: 'Duke', logos: ['https://x/duke.png'] };
const KU = { id: 3, school: 'Kansas', logos: ['https://x/ku.png'] };
const IDLE = { id: 9, school: 'Idle State', logos: ['https://x/idle.png'] };
const ROSTER = [DUKE, KU, IDLE];
const side = (id, team, points, logo) => ({ id, team, points: points == null ? null : points, logo: logo || null });
const G = {
    final: { id: 100, state: 'final', startDate: '2026-11-03T00:00:00.000Z', neutralSite: false,
        home: side(1, 'Duke', 80), away: side(2, 'Texas', 70, 'https://x/tex.png') },
    live: { id: 101, state: 'live', period: 2, clock: '8:43', startDate: '2026-11-06T00:00:00.000Z', neutralSite: true,
        home: side(4, 'UConn', 50), away: side(3, 'Kansas', 52) },
    pre: { id: 102, state: 'pre', startDate: '2026-11-08T05:00:00.000Z', startTimeTbd: true, neutralSite: false,
        home: side(5, 'Gonzaga'), away: side(1, 'Duke') }
};
const WEEKS = [
    { week: 1, first: '2026-11-03T00:00:00.000Z', last: '2026-11-09T03:00:00.000Z' },
    { week: 2, first: '2026-11-10T00:00:00.000Z', last: '2026-11-16T03:00:00.000Z' }
];
const SEASON_ENTRY = { season: 2027, weeklyScore: [{ week: 1, scoreByTeam: [{ teamId: 1, gameId: 100, score: 4 }] }] };
const logoOf = (t) => t.logos[0];

describe('byTeam / pointsFor / result', () => {
    test('a game lands under each rostered side, from that side', () => {
        const by = hg().byTeam(ROSTER, [G.final, G.live, G.pre]);
        expect(by['1'].map(e => e.game.id)).toEqual([100, 102]);
        expect(by['1'][1]).toMatchObject({ venue: 'away', them: { team: 'Gonzaga' } });
        expect(by['3'][0].venue).toBe('neutral');
        expect(by['9']).toEqual([]);
    });

    test('points come off the manager\'s own weeklyScore for that team and game', () => {
        expect(hg().pointsFor(SEASON_ENTRY, 1, 1, 100)).toBe(4);
        expect(hg().pointsFor(SEASON_ENTRY, 2, 1, 100)).toBeNull();
        expect(hg().pointsFor(SEASON_ENTRY, 1, 3, 100)).toBeNull();
    });

    test('final reads W/L and the score from our side; live the half and clock; to come the tip', () => {
        const by = hg().byTeam(ROSTER, [G.final, G.live, G.pre]);
        expect(hg().result(by['1'][0])).toEqual({ tone: 'w', text: 'W 80–70' });
        expect(hg().result(by['3'][0])).toEqual({ tone: 'live', text: '52–50 · 2nd 8:43' });
        expect(hg().result(by['1'][1])).toEqual({ tone: 'up', text: 'TBD' });
        expect(hg().periodLabel(3)).toBe('OT');
        expect(hg().periodLabel(4)).toBe('2OT');
    });
});

describe('glance', () => {
    test('the logos of your teams that play, each to its basketball team page', () => {
        document.body.innerHTML = hg().glanceHtml({ roster: ROSTER, games: [G.final, G.live], label: 'Week 1', poss: 'your', logoOf });
        const links = Array.from(document.querySelectorAll('.uh-games-logos a')).map(a => a.getAttribute('href'));
        expect(links).toEqual(['/hoops/team/1', '/hoops/team/3']);
        expect(document.body.textContent).toContain('2 of your teams · Week 1');
    });

    test('says so when none of them play', () => {
        document.body.innerHTML = hg().glanceHtml({ roster: ROSTER, games: [], label: 'Week 6', poss: 'their', logoOf });
        expect(document.body.textContent).toBe('No games for their teams · Week 6');
    });
});

describe('drawer list', () => {
    function render() {
        document.body.innerHTML = '<div class="uh-hg">' + hg().listHtml({ roster: ROSTER, games: [G.final, G.live, G.pre],
            seasonEntry: SEASON_ENTRY, week: 1, logoOf, poss: 'your' }) + '</div>';
    }

    test('grouped under each team in roster order; every row opens its game', () => {
        render();
        const heads = Array.from(document.querySelectorAll('.uh-hg-team')).map(a => [a.textContent, a.getAttribute('href')]);
        expect(heads).toEqual([['Duke', '/hoops/team/1'], ['Kansas', '/hoops/team/3']]);
        expect(Array.from(document.querySelectorAll('.uh-hg-row')).map(a => a.getAttribute('href')))
            .toEqual(['/hoops/game/100', '/hoops/game/102', '/hoops/game/101']);
    });

    test('venue mark, opponent, result and the points banked', () => {
        render();
        const rows = Array.from(document.querySelectorAll('.uh-hg-row'));
        expect(rows[0].querySelector('.opp').textContent).toBe('vsTexas');
        expect(rows[0].querySelector('.opp img').getAttribute('src')).toBe('https://x/tex.png');
        expect(rows[0].querySelector('.res').textContent).toBe('W 80–70');
        expect(rows[0].querySelector('.p').textContent).toBe('+4');
        expect(rows[1].querySelector('.opp').textContent).toBe('@Gonzaga');
        expect(rows[1].classList.contains('up')).toBe(true);
        expect(rows[1].querySelector('.p').textContent).toBe('');
        expect(rows[2].querySelector('.opp').textContent).toBe('NUConn');
        expect(rows[2].querySelector('.res').textContent).toBe('52–50 · 2nd 8:43');
    });

    test('no betting lines and no AP ranks', () => {
        render();
        expect(document.body.innerHTML).not.toMatch(/spread|over\/under|O\/U|AP /i);
    });

    test('the week picker is the season\'s actual weeks', () => {
        document.body.innerHTML = hg().pickerHtml(WEEKS, 2);
        const opts = Array.from(document.querySelectorAll('option'));
        expect(opts.map(o => o.value)).toEqual(['1', '2']);
        expect(opts[1].selected).toBe(true);
        expect(opts[0].textContent).toMatch(/^Week 1 · Nov \d+–\d+$/);
    });
});

describe('hydrate', () => {
    let calls;
    beforeEach(() => {
        calls = [];
        window.ccCurrentWeek = { get: jest.fn(() => Promise.resolve(1)) };
        window.fetch = jest.fn((url) => {
            calls.push(url);
            const week = Number(/\/teams\/\d+\/(\d+)/.exec(url)[1]);
            const games = week === 1 ? [G.final, G.live, G.pre] : [];
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ week, weeks: WEEKS, games }) });
        });
        document.body.innerHTML = '<div id="glance"></div><div id="drawer"></div>';
    });
    afterEach(() => { delete window.ccCurrentWeek; });

    async function boot() {
        let drawer = null;
        await hg().hydrate({ season: '2027', seasonEntry: SEASON_ENTRY, roster: ROSTER, poss: 'your', logoOf,
            glanceEl: document.getElementById('glance'), setDrawer: fn => { drawer = fn; } });
        return drawer;
    }

    test('the current basketball week\'s games for the rostered ids', async () => {
        await boot();
        expect(window.ccCurrentWeek.get).toHaveBeenCalledWith('2027');
        expect(calls).toEqual(['/hoops/games/teams/2027/1?ids=1%2C3%2C9']);
        expect(document.getElementById('glance').textContent).toContain('2 of your teams · Week 1');
    });

    test('picking a week reloads that week and repaints the glance', async () => {
        const drawer = await boot();
        const body = document.getElementById('drawer');
        drawer(body);
        expect(body.querySelectorAll('.uh-hg-row')).toHaveLength(3);
        const sel = body.querySelector('[uh-hg-week]');
        sel.value = '2';
        sel.dispatchEvent(new Event('change'));
        await flush();
        expect(calls[1]).toBe('/hoops/games/teams/2027/2?ids=1%2C3%2C9');
        expect(body.textContent).toContain('No games for your teams this week.');
        expect(body.querySelector('[uh-hg-week]').value).toBe('2');
        expect(document.getElementById('glance').textContent).toBe('No games for your teams · Week 2');
    });

    test('a failed load says so in the drawer and keeps a plain label', async () => {
        window.fetch = jest.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
        const drawer = await boot();
        expect(document.getElementById('glance').textContent).toBe('This week');
        const body = document.getElementById('drawer');
        drawer(body);
        expect(body.textContent).toBe('Could not load the games.');
    });
});

// The branch in userHome.js: a basketball league goes to this tile and never
// touches football's games route or its week storage; football is unchanged.
describe('userHome hydrateGames', () => {
    function loadUserHome(sport) {
        const node = new Proxy(function () { return node; }, {
            get(t, k) { return k === 'length' ? 0 : node; }, apply() { return node; }
        });
        global.$ = window.$ = function () { return node; };
        window.ccLeague = { code: () => 'x', sport: () => sport, title: (s) => s, name: () => 'L' };
        (0, eval)(read('logo.js'));
        (0, eval)(read('userHome.js'));
        document.body.innerHTML = '<div id="uh-tile-games"><div id="uh-glance-games"></div></div>';
    }
    let calls;
    beforeEach(() => {
        calls = [];
        window.localStorage.clear();
        window.localStorage.setItem('weekCode', 'week-5');
        window.localStorage.setItem('week', 'Week 5');
        window.localStorage.setItem('weekSeason', '2026');
        window.ccCurrentWeek = { get: jest.fn(() => Promise.resolve(1)), sync: jest.fn(() => Promise.resolve('week-5')) };
        window.fetch = jest.fn((url) => {
            calls.push(url);
            return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(/hoops/.test(url) ? { week: 1, weeks: WEEKS, games: [G.final] } : []) });
        });
    });
    afterEach(() => { delete window.ccCurrentWeek; delete window.ccLeague; });

    const user = { _id: 'u1', seasons: [{ season: 2027, teams: ROSTER, weeklyScore: [] }] };

    test('basketball: the basketball tile, and football\'s week storage untouched', async () => {
        loadUserHome('basketball');
        await hydrateGames(user, '2027');
        await flush();
        expect(calls).toEqual(['/hoops/games/teams/2027/1?ids=1%2C3%2C9']);
        expect(window.ccCurrentWeek.sync).not.toHaveBeenCalled();
        expect(window.localStorage.getItem('weekCode')).toBe('week-5');
        expect(window.localStorage.getItem('weekSeason')).toBe('2026');
        expect(document.querySelector('#uh-glance-games a').getAttribute('href')).toBe('/hoops/team/1');
    });

    test('football: still football\'s calendar and games route', async () => {
        loadUserHome('football');
        const fb = { _id: 'u1', seasons: [{ season: 2026, teams: [{ id: 1, school: 'Alabama', logos: [] }], weeklyScore: [] }] };
        await hydrateGames(fb, '2026');
        await flush();
        expect(window.ccCurrentWeek.sync).toHaveBeenCalledWith(undefined);
        expect(calls).toEqual(['/games/seasonType/regular/week/5/teams?ids=1']);
    });
});
