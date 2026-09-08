/**
 * @jest-environment jsdom
 *
 * public/current-week.js — the one answer to "what week is it".
 *
 * The bug this module exists to close: three pages each defaulted their week
 * picker differently, so the moment week 1 finished they disagreed. Betting
 * opened on week 0 all season; My Team showed the latest SCORED week under a
 * tile labelled "this week"; and because My Team wrote the same storage key
 * Standings used to test "did the user choose a week?", one visit there froze
 * the picker for the rest of the season.
 */

const SEASON = 2026;

function load({ week = 2, ok = true, league = 'graham-league' } = {}) {
    jest.resetModules();
    window.localStorage.clear();
    window.ccLeague = { code: () => league };
    const calls = [];
    window.fetch = jest.fn(url => {
        calls.push(url);
        return Promise.resolve({ ok, json: () => Promise.resolve(week === null ? {} : { week }) });
    });
    require('../public/current-week.js');
    return { cw: window.ccCurrentWeek, calls };
}

afterEach(() => { delete window.ccLeague; delete window.ccCurrentWeek; });

describe('get', () => {
    it('reads the week off the league scoreboard calendar', async () => {
        const { cw, calls } = load({ week: 2 });
        await expect(cw.get(SEASON)).resolves.toBe(2);
        expect(calls[0]).toBe('/games/scoreboard/graham-league/2026');
    });

    // Several tiles on one page ask at once; they must not each fire a request.
    it('caches per league and season', async () => {
        const { cw, calls } = load({ week: 5 });
        await Promise.all([cw.get(SEASON), cw.get(SEASON), cw.get(SEASON)]);
        expect(calls).toHaveLength(1);
    });

    it('answers null rather than guessing when it cannot resolve one', async () => {
        await expect(load({ ok: false }).cw.get(SEASON)).resolves.toBeNull();
        await expect(load({ week: null }).cw.get(SEASON)).resolves.toBeNull();
        await expect(load({ league: '' }).cw.get(SEASON)).resolves.toBeNull();
        await expect(load({ week: 3 }).cw.get(null)).resolves.toBeNull();
    });

    it('survives a rejected request', async () => {
        const { cw } = load();
        window.fetch = jest.fn(() => Promise.reject(new Error('offline')));
        await expect(cw.get(SEASON)).resolves.toBeNull();
    });
});

describe('sync', () => {
    it('brings an unpinned picker up to the current week', async () => {
        const { cw } = load({ week: 4 });
        window.localStorage.setItem('weekCode', 'week-1');
        window.localStorage.setItem('week', 'Week 1');

        await expect(cw.sync(SEASON)).resolves.toBe('week-4');
        expect(window.localStorage.getItem('weekCode')).toBe('week-4');
        expect(window.localStorage.getItem('week')).toBe('Week 4');
    });

    it('seeds a picker that has nothing stored yet', async () => {
        const { cw } = load({ week: 2 });
        await cw.sync(SEASON);
        expect(window.localStorage.getItem('weekCode')).toBe('week-2');
    });

    // The whole point of the pin: a week the viewer chose outranks the calendar.
    it('leaves a week the viewer pinned alone', async () => {
        const { cw, calls } = load({ week: 9 });
        window.localStorage.setItem('weekCode', 'week-3');
        window.localStorage.setItem('week', 'Week 3');
        cw.pin();

        await expect(cw.sync(SEASON)).resolves.toBe('week-3');
        expect(window.localStorage.getItem('weekCode')).toBe('week-3');
        expect(calls).toHaveLength(0);          // doesn't even ask
    });

    it('lets a viewer unpin and rejoin the calendar', async () => {
        const { cw } = load({ week: 9 });
        window.localStorage.setItem('weekCode', 'week-3');
        cw.pin();
        expect(cw.pinned()).toBe(true);
        cw.unpin();

        await expect(cw.sync(SEASON)).resolves.toBe('week-9');
    });

    // The calendar answers in regular-season weeks, so syncing over the
    // postseason sentinel would drag a reader out of the bowls back to November.
    it('leaves a postseason selection alone', async () => {
        const { cw, calls } = load({ week: 2 });
        window.localStorage.setItem('weekCode', 'week-17');

        await expect(cw.sync(SEASON)).resolves.toBe('week-17');
        expect(window.localStorage.getItem('weekCode')).toBe('week-17');
        expect(calls).toHaveLength(0);
    });

    it('changes nothing when the calendar cannot be reached', async () => {
        const { cw } = load({ ok: false });
        window.localStorage.setItem('weekCode', 'week-6');
        window.localStorage.setItem('week', 'Week 6');

        await expect(cw.sync(SEASON)).resolves.toBeNull();
        expect(window.localStorage.getItem('weekCode')).toBe('week-6');
    });
});
