/**
 * @jest-environment jsdom
 *
 * Standings' Rivalry Games on a basketball league (#528).
 *
 * The section was football's whatever the league: basketball team ids sent to
 * football's games collection (the id spaces overlap, #489), the AP poll,
 * football logos and a /betting-lines call that 400s on a basketball season.
 * On a basketball league it reads GET /hoops/games/teams instead — one call
 * that carries T-Rank and the hoopsteams logos — and keeps its week on the
 * page, never in football's weekCode.
 */
const { loadStandingsPage, resetStandingsPage, makeUser } = require('./helpers/standings-dom');

const SEASON = 2027;
const HOOPS_SEED = { code: 'hoops-league', canSwitch: false, isAdmin: false, all: [
    { code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' },
    { code: 'graham-league', name: 'Graham League', sport: 'football' }
] };

const manager = (id, first, teams, weeklyScore) => makeUser({
    top: { _id: id, firstName: first, lastName: 'X', email: `${first}@example.com`.toLowerCase() },
    season: SEASON, teams, weeklyScore: weeklyScore || [0]
});

// Two managers; Duke (1) is Alice's, Kansas (3) and Texas (2) are Bob's.
const league = (aliceWeekly) => [
    manager('a', 'Alice', [{ id: 1, school: 'Duke' }], aliceWeekly),
    manager('b', 'Bob', [{ id: 3, school: 'Kansas' }, { id: 2, school: 'Texas' }])
];

// A game in GET /hoops/games/teams' shape (modules/hoops-league-scoreboard).
const side = (id, team, o) => Object.assign({ id, team, logo: null, rank: null, points: null }, o || {});
const hoopsGame = (id, away, home, o) => Object.assign({
    id, week: 2, state: 'pre', startDate: '2027-11-12T00:00:00Z', startTimeTbd: false,
    period: null, clock: null, outlet: null, notes: null, away, home
}, o || {});

const WEEKS = [
    { week: 1, first: Date.parse('2027-11-03T23:00:00Z'), last: Date.parse('2027-11-09T23:00:00Z') },
    { week: 2, first: Date.parse('2027-11-10T23:00:00Z'), last: Date.parse('2027-11-16T23:00:00Z') }
];

let hoopsAnswer;
const hoopsRoute = [/^\/hoops\/games\/teams\//, (href) => hoopsAnswer(href)];

// The REAL current-week.js, which is what decides that a basketball league
// asks /hoops/games/current-week and that sync() answers nothing there. It is
// a classic script that wires itself to window, so it is evaluated.
function installCurrentWeek() {
    (0, eval)(require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'current-week.js'), 'utf8'));
}

async function loadHoops(opts = {}) {
    if (!opts.withoutHelper) window.ccHoopsWeekGames = require('../public/hoops-week-games.js');
    installCurrentWeek();
    const currentWeek = [/^\/hoops\/games\/current-week\//, { season: SEASON, week: 2, liveNow: null }];
    return loadStandingsPage(Object.assign({
        users: league(opts.aliceWeekly),
        season: SEASON,
        leagueSeed: HOOPS_SEED,
        routes: [hoopsRoute, currentWeek],
        localStorage: { weekCode: 'week-7', week: 'Week 7' }
    }, opts.page || {}));
}

beforeEach(() => {
    hoopsAnswer = () => ({ season: SEASON, week: 2, weeks: WEEKS, games: [] });
});
afterEach(() => {
    resetStandingsPage();
    delete window.ccHoopsWeekGames;
    delete window.ccCurrentWeek;
});

describe('Rivalry Games on a basketball league', () => {
    it('makes none of football\'s calls: games, AP poll, logos or betting lines', async () => {
        const page = await loadHoops();
        const urls = page.urls();
        expect(urls.some(u => u.startsWith('/games/seasonType/'))).toBe(false);
        expect(urls.some(u => u.startsWith('/rankings/'))).toBe(false);
        expect(urls.some(u => u.startsWith('/teams/teamLogos/all'))).toBe(false);
        expect(urls.some(u => u.startsWith('/betting-lines/'))).toBe(false);
    });

    it('asks the basketball route for every rostered team, for the current basketball week', async () => {
        const page = await loadHoops();
        const call = page.urls().find(u => u.startsWith('/hoops/games/teams/'));
        expect(call).toBeDefined();
        const url = new URL(call, 'http://x');
        expect(url.pathname).toBe(`/hoops/games/teams/${SEASON}/2`);
        expect(url.searchParams.get('ids').split(',').sort()).toEqual(['1', '2', '3']);
        expect(page.urls()).toContain(`/hoops/games/current-week/${SEASON}`);
    });

    it('renders a game between two managers, with T-Rank, the hoopsteams logo and basketball links', async () => {
        hoopsAnswer = () => ({ season: SEASON, week: 2, weeks: WEEKS, games: [
            hoopsGame(501, side(1, 'Duke', { rank: 4, logo: 'https://x/duke.png' }), side(3, 'Kansas'), { outlet: 'ESPN' })
        ] });
        const page = await loadHoops();
        const card = page.q('.gc-clickable[data-game-id="501"]');
        expect(card).not.toBeNull();
        const html = card.innerHTML;
        expect(html).toContain('https://x/duke.png');
        expect(html).toContain('>4</p>Duke');
        expect(html).toContain('href="/hoops/team/1"');
        expect(html).toContain('href="/hoops/team/3"');
        expect(html).toContain('fa-basketball');      // Kansas has no logo
        expect(html).not.toContain('fa-helmet-un');
        expect(html).toContain('Alice');
        expect(html).toContain('Bob');
        expect(html).toContain('ESPN');
    });

    it('leaves out a game that is not between two managers', async () => {
        hoopsAnswer = () => ({ season: SEASON, week: 2, weeks: WEEKS, games: [
            hoopsGame(601, side(3, 'Kansas'), side(2, 'Texas')),          // both Bob's
            hoopsGame(602, side(1, 'Duke'), side(99, 'Unrostered'))
        ] });
        const page = await loadHoops();
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(0);
        expect(page.q('#no-games-container').innerHTML).toContain('No Rivalry Games');
    });

    it('a final shows the score and the points each side banked, a loss with its sign', async () => {
        hoopsAnswer = () => ({ season: SEASON, week: 2, weeks: WEEKS, games: [
            hoopsGame(701, side(1, 'Duke', { points: 61 }), side(3, 'Kansas', { points: 70 }), { state: 'final' })
        ] });
        const page = await loadHoops({ aliceWeekly: [0, {
            week: 2, season: 'regular', score: -2,
            scoreByTeam: [{ teamId: 1, gameId: 701, score: -2 }]
        }] });
        const html = page.scheduleBody().innerHTML;
        expect(html).toContain('61');
        expect(html).toContain('70');
        expect(html).toContain('data-pts="-2"');
        expect(html).toContain('−2');
    });

    it('builds the picker from the season\'s weeks and never touches football\'s stored week', async () => {
        const page = await loadHoops();
        const sel = page.q('[rivalry-week]');
        expect([...sel.options].map(o => o.value)).toEqual(['1', '2']);
        expect(sel.value).toBe('2');
        expect(window.localStorage.getItem('weekCode')).toBe('week-7');
        expect(window.localStorage.getItem('week')).toBe('Week 7');
    });

    // With nothing stored, football's bootstrap seeds weekCode from the latest
    // scored week. Off a BASKETBALL payload that is a basketball week number,
    // which a football page would then open on after a league switch.
    it('does not seed football\'s stored week from a basketball payload', async () => {
        const page = await loadHoops({ aliceWeekly: [3, 4, 5], page: { localStorage: {} } });
        expect(page.q('[rivalry-week]').value).toBe('2');
        // 'week-1' is the bootstrap's empty-storage default, the same a
        // football league writes; 'week-5' would be the basketball week.
        expect(window.localStorage.getItem('weekCode')).toBe('week-1');
    });

    it('a picked week fetches that week, still without writing football\'s storage', async () => {
        const page = await loadHoops();
        const sel = page.q('[rivalry-week]');
        sel.value = '1';
        sel.dispatchEvent(new window.Event('change'));
        await page.flush();
        const calls = page.urls().filter(u => u.startsWith('/hoops/games/teams/'));
        expect(calls[calls.length - 1]).toContain(`/hoops/games/teams/${SEASON}/1?`);
        expect(window.localStorage.getItem('weekCode')).toBe('week-7');
        expect(window.localStorage.getItem('weekPinned')).toBeNull();
    });

    it('a live game shows the score and the half and clock', async () => {
        hoopsAnswer = () => ({ season: SEASON, week: 2, weeks: WEEKS, games: [
            hoopsGame(801, side(1, 'Duke', { points: 30 }), side(3, 'Kansas', { points: 28 }),
                { state: 'live', period: 2, clock: '12:04' })
        ] });
        const page = await loadHoops();
        const html = page.scheduleBody().innerHTML;
        expect(html).toContain('30');
        expect(html).toContain('2nd 12:04');
        expect(html).not.toContain('score-explain');
    });

    it('a win carries the caret and a positive badge; an unscored side carries none', async () => {
        hoopsAnswer = () => ({ season: SEASON, week: 2, weeks: WEEKS, games: [
            hoopsGame(901, side(1, 'Duke', { points: 80 }), side(3, 'Kansas', { points: 70 }), { state: 'final', notes: 'Maui Invitational' })
        ] });
        const page = await loadHoops({ aliceWeekly: [0, {
            week: 2, season: 'regular', score: 6, scoreByTeam: [{ teamId: 1, gameId: 901, score: 6 }]
        }] });
        const html = page.scheduleBody().innerHTML;
        expect(html).toContain('fa-caret-left');
        expect(html).toContain('+6');
        expect(page.scheduleBody().querySelectorAll('.score-explain')).toHaveLength(1);
        expect(html).toContain('Maui Invitational');
    });

    it('wraps to a new row after three cards', async () => {
        const users = [
            manager('a', 'Alice', [1, 2, 3, 4].map(id => ({ id, school: 'A' + id }))),
            manager('b', 'Bob', [11, 12, 13, 14].map(id => ({ id, school: 'B' + id })))
        ];
        hoopsAnswer = () => ({ season: SEASON, week: 2, weeks: WEEKS, games: [1, 2, 3, 4].map(n =>
            hoopsGame(1000 + n, side(n, 'A' + n), side(10 + n, 'B' + n))) });
        const page = await loadHoops({ page: { users } });
        const rows = page.scheduleBody().querySelectorAll(':scope > tr');
        expect(page.scheduleBody().querySelectorAll('.game-table')).toHaveLength(4);
        expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('opens week 1 when basketball has no current week to give', async () => {
        const page = await loadHoops({ page: { routes: [hoopsRoute,
            [/^\/hoops\/games\/current-week\//, { season: SEASON, week: null, liveNow: null }]] } });
        expect(page.urls().find(u => u.startsWith('/hoops/games/teams/'))).toContain(`/hoops/games/teams/${SEASON}/1?`);
    });

    it('without the basketball helper loaded, says it could not load rather than asking football', async () => {
        const page = await loadHoops({ withoutHelper: true });
        expect(page.urls().some(u => u.startsWith('/games/seasonType/'))).toBe(false);
        expect(page.q('#no-games-container').innerHTML).toContain('Could not load the games');
    });

    // Before the draft: managers with season entries and no teams. Nothing
    // failed, so "could not load" would be false — and the picker still
    // needs the season's weeks.
    it('with no rostered teams yet: no rivalry games, and the basketball weeks in the picker', async () => {
        const users = [manager('a', 'Alice', []), manager('b', 'Bob', [])];
        const page = await loadHoops({ page: { users } });
        expect(page.urls().find(u => u.startsWith('/hoops/games/teams/'))).toBeDefined();
        expect(page.q('#no-games-container').innerHTML).toContain('No Rivalry Games');
        expect([...page.q('[rivalry-week]').options].map(o => o.value)).toEqual(['1', '2']);
    });

    it('a failed week pick keeps the last good week on screen and in the picker', async () => {
        hoopsAnswer = (href) => {
            if (href.includes(`/${SEASON}/1?`)) throw new Error('offline');
            return { season: SEASON, week: 2, weeks: WEEKS, games: [hoopsGame(501, side(1, 'Duke'), side(3, 'Kansas'))] };
        };
        const page = await loadHoops();
        const sel = page.q('[rivalry-week]');
        sel.value = '1';
        sel.dispatchEvent(new window.Event('change'));
        await page.flush();
        expect(page.q('.gc-clickable[data-game-id="501"]')).not.toBeNull();
        expect(sel.value).toBe('2');
        expect(page.q('#no-games-container').innerHTML).toContain('Could not load week 1');
    });

    it('the newest pick wins when an older one answers last', async () => {
        let releaseWeek1;
        hoopsAnswer = (href) => {
            const wk = href.includes(`/${SEASON}/1?`) ? 1 : 2;
            const body = { season: SEASON, week: wk, weeks: WEEKS, games: [hoopsGame(500 + wk, side(1, 'Duke'), side(3, 'Kansas'))] };
            return wk === 1 ? new Promise(r => { releaseWeek1 = () => r(body); }) : body;
        };
        const page = await loadHoops();
        const sel = page.q('[rivalry-week]');
        sel.value = '1';
        sel.dispatchEvent(new window.Event('change'));
        await page.flush(5);
        sel.value = '2';
        sel.dispatchEvent(new window.Event('change'));
        await page.flush();
        releaseWeek1();
        await page.flush();
        expect(page.q('.gc-clickable[data-game-id="502"]')).not.toBeNull();
        expect(page.q('.gc-clickable[data-game-id="501"]')).toBeNull();
    });

    it('a failed load says so rather than showing an empty week', async () => {
        hoopsAnswer = () => { throw new Error('offline'); };
        const page = await loadHoops();
        expect(page.q('#no-games-container').innerHTML).toContain('Could not load the games');
    });
});

// public/league.js sends a game card to /hoops/game/:id only outside a
// data-page-sport="football" container. The Rivalry Games container was
// hard-coded football — right while it only ever listed football games, and
// after #528 it would send a basketball card to football's /game/:id.
describe('the Rivalry Games container names its sport', () => {
    const fs = require('fs');
    const path = require('path');
    const ejs = require('ejs');
    const view = fs.readFileSync(path.join(__dirname, '..', 'views', 'standings.ejs'), 'utf8');
    // The container's own lines, rendered for real: the full view needs the
    // navbar partial's locals.
    const start = view.indexOf('<% var _rivalrySport');
    const end = view.indexOf('</div>', view.indexOf('class="football-icon"'));
    const render = (locals) => {
        document.body.innerHTML = ejs.render(view.slice(start, end) + '</div></div>', locals);
        return document.querySelector('.game-content');
    };

    it('basketball on a basketball league, so a card opens the basketball game', () => {
        const el = render({ viewerSport: 'basketball' });
        expect(el.getAttribute('data-page-sport')).toBe('basketball');
        expect(el.textContent).toContain('🏀');
    });

    it('the basketball helper script is only in a basketball viewer\'s page', () => {
        const tag = '<script defer src="hoops-week-games.js"></script>';
        const head = view.slice(view.indexOf('<%# Rivalry Games\' basketball reads'), view.indexOf('<script src="standings.js"'));
        expect(ejs.render(head, { viewerSport: 'basketball' })).toContain(tag);
        expect(ejs.render(head, { viewerSport: 'football' })).not.toContain(tag);
        expect(ejs.render(head, {})).not.toContain(tag);
    });

    it('football otherwise, as before', () => {
        expect(render({ viewerSport: 'football' }).getAttribute('data-page-sport')).toBe('football');
        expect(render({}).getAttribute('data-page-sport')).toBe('football');
    });
});
