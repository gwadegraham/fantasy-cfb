/**
 * @jest-environment jsdom
 *
 * The basketball game page's Gamecast tab (public/hoopsGamecast.js, wired in
 * public/hoopsGame.js) and the live scoreboard's fouls line. The play log is
 * the real Notre Dame @ Villanova game, through the real server shaper.
 */
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'hoopsGame.js'), 'utf8');
const GC = fs.readFileSync(path.join(__dirname, '..', 'public', 'hoopsGamecast.js'), 'utf8');
const KIT = fs.readFileSync(path.join(__dirname, '..', 'public', 'sport-page.js'), 'utf8');
const live = require('../modules/hoops-espn-live');
const SUMMARY = require('./fixtures/espn-hoops-plays-401920982.json');

beforeAll(() => { (0, eval)(KIT); (0, eval)(GC); });
beforeEach(() => { window.matchMedia = (q) => ({ matches: /reduce/.test(q) }); });
afterEach(() => { delete window.ccLeague; jest.useRealTimers(); });

const GAME = { id: 377909, season: 2027, homeTeamId: 338, awayTeamId: 213 };
const PLAYS = live.playsFrom(SUMMARY, GAME, { home: '222', away: '87' });
// Live at 2nd half 9:37: Notre Dame's timeout, everything before it.
const UPTO = PLAYS.findIndex(p => p.period === 2 && p.clock === '9:37');
const LIVE_PLAYS = PLAYS.slice(0, UPTO + 1);

function payload(o) {
    return Object.assign({
        game: { id: 377909, final: false, live: true, status: 'in_progress', period: 2, clock: '9:37', postseason: false,
            neutralSite: true, startDate: '2026-11-01T14:30:00.000Z', startTimeTbd: false, venue: 'Palazzo dello Sport', city: 'Rome' },
        home: { id: 338, school: 'Villanova', abbreviation: 'VILL', color: '#13B5EA', logo: 'https://x/v.png', hasPage: true,
            record: { w: 0, l: 0 }, points: 50, owner: null },
        away: { id: 213, school: 'Notre Dame', abbreviation: 'ND', color: '#0C2340', logo: 'https://x/nd.png', hasPage: true,
            record: { w: 0, l: 0 }, points: 52, owner: { franchiseName: 'Irish' } },
        quadrantValues: { 1: 5, 2: 3, 3: 1, 4: 0 },
        box: { source: 'espn', home: { players: [], points: 50 }, away: { players: [], points: 52 } },
        shots: { source: 'espn', attempts: { home: 1, away: 0 }, home: [{ made: true, range: 'rim', x: 25, y: 6 }], away: [] },
        gamecast: true,
        fouls: { period: 2, home: { fouls: 9, bonus: 'single' }, away: { fouls: 7, bonus: 'double' } },
        preview: { homeWinProb: 0.6, home: null, away: null, meetings: [] }
    }, o || {});
}

// fetch, routed by URL: the page payload, or the plays log (honouring ?since).
function server(state) {
    return jest.fn((url) => {
        const body = /\/plays/.test(url)
            ? (function () {
                const m = /since=(\d+)/.exec(url), n = m ? Number(m[1]) : 0;
                if (state.down) return { source: null, total: 0, from: 0, plays: [] };
                const from = n ? Math.max(0, Math.min(n, state.plays.length) - 10) : 0;
                const p = state.plays[from - 1];
                return Object.assign({ source: state.source || 'espn', total: state.plays.length, from: from, plays: state.plays.slice(from) },
                    from > 0 ? { check: [p.period, p.clock, p.text].join('|') } : {});
            })()
            : state.page;
        const copy = JSON.parse(JSON.stringify(body));
        // `slow`: a tail request that answers 20s late (the race below).
        if (state.slow && /since=/.test(url)) return new Promise(r => setTimeout(() => r({ ok: true, status: 200, json: () => Promise.resolve(copy) }), 20000));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(copy) });
    });
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// `fake`: the test runs on fake timers, so the macrotask tick is advanced.
async function open(state, fake) {
    window.history.replaceState(null, '', window.location.pathname);
    document.body.innerHTML = '<title>Game</title><main id="hoops-game" data-game-id="377909"></main>';
    window.ccLeague = { paint: jest.fn() };
    global.fetch = server(state);
    (0, eval)(SRC);
    await flush();
    if (fake) await jest.advanceTimersByTimeAsync(0); else await new Promise(r => setTimeout(r, 0));
    await flush();
}
const q = (s) => document.querySelector(s);
// Rows drawn across every open half, against the plays they should be.
const rowsShown = () => document.querySelectorAll('.hg-pbp-group.on .hg-gc-row').length;
const rowsExpected = (plays) => plays.length;
const all = (s) => Array.from(document.querySelectorAll(s));
const txt = (s) => all(s).map(n => n.textContent).join(' | ');

describe('a live game', () => {
    test('opens on its Gamecast: four short tabs, the log fetched apart from the page', async () => {
        const state = { page: payload(), plays: LIVE_PLAYS };
        await open(state);
        expect(txt('.sp-tab')).toBe('Gamecast | Summary | Box | Shots');
        expect(q('.sp-tab.on').textContent).toBe('Gamecast');
        expect(global.fetch.mock.calls.map(c => c[0])).toEqual(['/hoops/games/377909/page', '/hoops/games/377909/plays']);
        expect(txt('.hg-panel > .sp-h')).toBe('On the floor | Game flow | Play-by-playNewest first');
    });

    test('the scoreboard shows each side\'s fouls and bonus, away on the left', async () => {
        await open({ page: payload(), plays: LIVE_PLAYS });
        expect(q('.hg-board').classList.contains('fouled')).toBe(true);
        expect(all('.hg-fouls').map(n => n.textContent)).toEqual(['7 fouls2× Bonus', '9 foulsBonus']);
    });

    test('a final, or a live game with no fouls figured: no fouls line', async () => {
        await open({ page: payload({ fouls: null }), plays: LIVE_PLAYS });
        expect(q('.hg-fouls')).toBeNull();
        expect(q('.hg-board').classList.contains('fouled')).toBe(false);
    });

    test('On the floor: the last shot, the last play with its score, fouls chips', async () => {
        await open({ page: payload(), plays: LIVE_PLAYS });
        const last = LIVE_PLAYS[LIVE_PLAYS.length - 1];
        expect(q('.hg-gc-last .t').textContent).toContain(last.text);
        expect(q('.hg-gc-last .sc').textContent).toBe(last.away + '–' + last.home);
        expect(q('.hg-gc-floor .arc')).not.toBeNull();            // a new shot: its flight is drawn
        expect(txt('.hg-gc-chip')).toContain('ND · 7 fouls · in the double bonus');
    });

    test('play-by-play newest first, the current half open, substitutions never shown', async () => {
        await open({ page: payload(), plays: LIVE_PLAYS });
        const groups = all('.hg-pbp-period .lbl').map(n => n.textContent);
        expect(groups).toEqual(['2nd half', '1st half']);
        expect(all('.hg-pbp-group.on')).toHaveLength(1);
        expect(q('.hg-gc-row.mute').textContent).toContain('Notre Dame Timeout');
        expect(txt('.hg-gc-row')).not.toMatch(/Substitution/);
        q('[data-gc-per="1"]').click();
        expect(all('.hg-pbp-group.on')).toHaveLength(2);
        q('[data-gc-pbp="scoring"]').click();
        expect(all('.hg-gc-row').every(r => r.classList.contains('score'))).toBe(true);
    });

    test('Game flow: win probability, then the lead with changes and ties', async () => {
        await open({ page: payload(), plays: LIVE_PLAYS });
        expect(q('.hg-gc-big span').textContent).toBe('to win, now');
        expect(q('.hg-gc-foot').textContent).toContain('Pregame (Torvik): VILL 60%. Live line from ESPN.');
        q('[data-gc-chart="lead"]').click();
        expect(q('.hg-gc-big').textContent).toMatch(/^(ND|VILL) by \d+lead now$|^Tiedlead now$/);
        expect(txt('.hg-gc-stat span')).toBe('Lead changes | Ties | Biggest lead');
    });

    test('each refresh tops up only the newest plays, and the shot flight plays only for a NEW shot', async () => {
        jest.useFakeTimers();
        const state = { page: payload(), plays: PLAYS.slice(0, UPTO - 20) };
        await open(state, true);
        const held = state.plays.length;
        // Nothing new: the flight is not replayed.
        await jest.advanceTimersByTimeAsync(15000);
        expect(global.fetch.mock.calls.map(c => c[0]).pop()).toBe('/hoops/games/377909/plays?since=' + held);
        expect(q('.hg-gc-floor .arc')).toBeNull();
        // Twenty more plays, with a shot among them.
        state.plays = LIVE_PLAYS;
        await jest.advanceTimersByTimeAsync(15000);
        expect(global.fetch.mock.calls.map(c => c[0]).pop()).toBe('/hoops/games/377909/plays?since=' + held);
        expect(q('.hg-gc-last .t').textContent).toContain(LIVE_PLAYS[LIVE_PLAYS.length - 1].text);
        expect(q('.hg-gc-floor .arc')).not.toBeNull();
        // Every play once: the tail spliced on, nothing doubled or dropped.
        q('[data-gc-per="1"]').click();
        expect(rowsShown()).toBe(rowsExpected(LIVE_PLAYS));
        // A repaint of the same shot does not replay its flight.
        expect(q('.hg-gc-floor .arc')).toBeNull();
    });

    test('ESPN down mid-game keeps the plays on screen, and an empty log is fetched again once it is back', async () => {
        jest.useFakeTimers();
        const state = { page: payload(), plays: LIVE_PLAYS, down: true };
        await open(state, true);
        expect(q('.hg-panel').textContent).toContain('No plays yet.');
        state.down = false;
        await jest.advanceTimersByTimeAsync(15000);
        expect(global.fetch.mock.calls.map(c => c[0]).pop()).toBe('/hoops/games/377909/plays');
        expect(q('.hg-gc-floor')).not.toBeNull();
        state.down = true;
        await jest.advanceTimersByTimeAsync(15000);
        expect(q('.hg-gc-floor')).not.toBeNull();            // kept, not wiped
        q('[data-gc-per="1"]').click();
        expect(rowsShown()).toBe(rowsExpected(LIVE_PLAYS));
    });

    test('a play inserted further back than the re-sent tail: the whole log is fetched again', async () => {
        jest.useFakeTimers();
        const state = { page: payload(), plays: LIVE_PLAYS.slice(0, 100) };
        await open(state, true);
        const late = { type: 'PersonalFoul', text: 'Foul on Late Entry.', period: 1, clock: '18:00', side: 'home', home: 0, away: 0 };
        state.plays = LIVE_PLAYS.slice(0, 20).concat([late], LIVE_PLAYS.slice(20));
        await jest.advanceTimersByTimeAsync(15000);
        const urls = global.fetch.mock.calls.map(c => c[0]).filter(u => /\/plays/.test(u));
        expect(urls.slice(-2)).toEqual(['/hoops/games/377909/plays?since=100', '/hoops/games/377909/plays']);
        q('[data-gc-per="1"]').click();
        expect(rowsShown()).toBe(rowsExpected(state.plays));
        expect(txt('.hg-gc-row')).toContain('Foul on Late Entry.');
    });

    test('play text is escaped', async () => {
        const plays = LIVE_PLAYS.concat([{ type: 'JumpShot', text: '<img src=x onerror=alert(1)>', period: 2, clock: '9:30', side: 'home', home: 1, away: 1 }]);
        await open({ page: payload(), plays: plays });
        expect(q('.hg-panel img[src="x"]')).toBeNull();
        expect(q('.hg-gc-last .t').textContent).toContain('<img src=x');
    });

    test('the other tabs still work, and switching back keeps the log', async () => {
        await open({ page: payload(), plays: LIVE_PLAYS });
        q('[data-tab="summary"]').click();
        expect(q('.hg-gc-floor')).toBeNull();
        q('[data-tab="gamecast"]').click();
        expect(q('.hg-gc-floor')).not.toBeNull();
        expect(global.fetch.mock.calls.filter(c => /\/plays/.test(c[0]))).toHaveLength(1);
    });
});

describe('a final', () => {
    const finalPage = () => payload({ game: Object.assign(payload().game, { final: true, live: false, status: 'final' }),
        fouls: null, home: Object.assign(payload().home, { points: 72 }), away: Object.assign(payload().away, { points: 74 }) });

    test('opens on Summary; its Gamecast has no On the floor, plays in game order, the winner at 100%', async () => {
        await open({ page: finalPage(), plays: PLAYS, source: 'cbbd' });
        expect(q('.sp-tab.on').textContent).toBe('Summary');
        q('[data-tab="gamecast"]').click();
        await flush();
        expect(q('.hg-gc-floor')).toBeNull();
        expect(all('.hg-pbp-period .lbl').map(n => n.textContent)).toEqual(['1st half', '2nd half']);
        expect(q('.hg-gc-big').textContent).toBe('ND 100%won');
        expect(q('.hg-gc-foot').textContent).toContain('Line from CollegeBasketballData.');
        expect(q('.hg-gc-note').textContent).toBe('Substitutions hidden.');
    });

    test('no Gamecast for the game: the tabs as before', async () => {
        await open({ page: Object.assign(finalPage(), { gamecast: false }), plays: [] });
        expect(txt('.sp-tab')).toBe('Summary | Box score | Shot chart');
    });

    test("a game going final drops the ESPN log, so CBBD's whole log is fetched", async () => {
        jest.useFakeTimers();
        const state = { page: payload(), plays: LIVE_PLAYS };
        await open(state, true);
        state.page = finalPage();
        state.plays = PLAYS;
        state.source = 'cbbd';
        await jest.advanceTimersByTimeAsync(15000);
        q('[data-tab="gamecast"]').click();
        await jest.advanceTimersByTimeAsync(0);
        expect(global.fetch.mock.calls.map(c => c[0]).pop()).toBe('/hoops/games/377909/plays');
        expect(q('.hg-gc-big span').textContent).toBe('won');
    });

    test('a tail asked for before the final, answering after it, is thrown away', async () => {
        jest.useFakeTimers();
        const state = { page: payload(), plays: LIVE_PLAYS };
        await open(state, true);
        state.slow = true;
        await jest.advanceTimersByTimeAsync(15000);          // a tail request, still out
        state.page = finalPage();
        state.plays = PLAYS;
        state.source = 'cbbd';
        await jest.advanceTimersByTimeAsync(15000);          // goes final: the whole log is fetched
        await jest.advanceTimersByTimeAsync(20000);          // the old tail lands
        q('[data-tab="gamecast"]').click();
        all('.hg-pbp-group:not(.on) [data-gc-per]').forEach(b => b.click());
        expect(rowsShown()).toBe(rowsExpected(PLAYS));
        expect(q('.hg-gc-big span').textContent).toBe('won');
    });

    test('an empty log says so', async () => {
        await open({ page: payload(), plays: [] });
        expect(q('.hg-panel').textContent).toContain('No plays yet.');
    });
});
