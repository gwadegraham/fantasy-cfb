// ESPN tip-time fill: modules/hoops-espn-tip-times.js.
//
// What it must get right: ESPN only fills a game CBBD has as TBD, CBBD's time
// wins the moment it has one, a fill never moves a game off its Eastern day
// (so never off its week), and ESPN being down leaves things as they were.
//
// global.fetch is always stubbed — an unstubbed call would hit ESPN from the
// laptop — and cbbd.fetchGamesInRange too, for the same reason with CBBD.

const { useMongo } = require('./helpers/mongo');
const HoopsGame = require('../models/hoopsGame');
const tips = require('../modules/hoops-espn-tip-times');
const hoopsGames = require('../routes/hoopsGames');
const cbbd = require('../modules/cbbd-client');

useMongo();

const SEASON = 2027;
const WINDOW = { season: SEASON, start: new Date('2026-10-26T00:00:00Z'), end: new Date('2026-11-30T00:00:00Z') };

// Midnight Eastern: CBBD's TBD placeholder. EST after 1 Nov 2026, EDT before.
const MON_NOV_2 = '2026-11-02T05:00:00.000Z';
const SAT_OCT_31 = '2026-10-31T04:00:00.000Z';

const stored = (id, iso, o = {}) => Object.assign({
    id, sourceId: String(400000000 + id), season: SEASON, week: 1, seasonType: 'regular',
    startDate: new Date(iso), startTimeTbd: true, status: 'scheduled',
    homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B'
}, o);
const event = (id, date, timeValid = true) => ({
    id: String(400000000 + id), date, competitions: [{ timeValid }]
});

// ESPN's scoreboard, keyed by the dates=YYYYMMDD it is asked for.
function stubEspn(byDay) {
    return jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
        const day = new URL(url).searchParams.get('dates');
        const answer = byDay[day];
        if (answer instanceof Error) throw answer;
        if (typeof answer === 'number') return { ok: false, status: answer, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => (answer === undefined ? { events: [] } : answer) };
    });
}
const asked = (spy) => spy.mock.calls.map(([url]) => new URL(url).searchParams.get('dates'));
const row = (id) => HoopsGame.findOne({ id }).lean();

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('filling a TBD game', () => {
    test('takes ESPN\'s time and marks it as ESPN\'s', async () => {
        await HoopsGame.create(stored(1, MON_NOV_2));
        stubEspn({ 20261102: { events: [event(1, '2026-11-03T00:30Z')] } });

        const out = await tips.fillTipTimes(WINDOW);

        const g = await row(1);
        expect(g.startDate.toISOString()).toBe('2026-11-03T00:30:00.000Z');
        expect(g.startTimeTbd).toBe(false);
        expect(g.startTimeSource).toBe('espn');
        expect(g.week).toBe(1);
        expect(out).toMatchObject({ candidates: 1, filled: 1, calls: 1, failedDays: 0 });
    });

    test('a 9 PM ET tip is already TOMORROW in UTC, and is still filled on its Eastern day', async () => {
        await HoopsGame.create(stored(1, MON_NOV_2));
        const espn = stubEspn({ 20261102: { events: [event(1, '2026-11-03T02:00Z')] } });

        await tips.fillTipTimes(WINDOW);

        // Asked for Nov 2 (the Eastern day), never Nov 3 (the UTC day).
        expect(asked(espn)).toEqual(['20261102']);
        expect((await row(1)).startDate.toISOString()).toBe('2026-11-03T02:00:00.000Z');
    });

    test('across the DST change: an EDT placeholder (04:00Z) is asked for its own Eastern day', async () => {
        await HoopsGame.create([stored(1, SAT_OCT_31), stored(2, MON_NOV_2)]);
        const espn = stubEspn({
            20261031: { events: [event(1, '2026-10-31T23:00Z')] },
            20261102: { events: [event(2, '2026-11-03T00:00Z')] }
        });

        const out = await tips.fillTipTimes(WINDOW);

        expect(asked(espn).sort()).toEqual(['20261031', '20261102']);
        expect(out.filled).toBe(2);
        expect((await row(1)).startDate.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    });

    test('one ESPN call per Eastern day, however many games are on it', async () => {
        await HoopsGame.create([stored(1, MON_NOV_2), stored(2, MON_NOV_2), stored(3, MON_NOV_2)]);
        const espn = stubEspn({ 20261102: { events: [1, 2, 3].map(id => event(id, '2026-11-03T00:00Z')) } });

        await tips.fillTipTimes(WINDOW);

        expect(espn).toHaveBeenCalledTimes(1);
    });
});

describe('left TBD', () => {
    test('ESPN is TBD too', async () => {
        await HoopsGame.create(stored(1, MON_NOV_2));
        stubEspn({ 20261102: { events: [event(1, '2026-11-02T05:00Z', false)] } });

        const out = await tips.fillTipTimes(WINDOW);

        expect(out.espnTbd).toBe(1);
        expect(await row(1)).toMatchObject({ startTimeTbd: true, startDate: new Date(MON_NOV_2) });
    });

    test('ESPN has the game on a different day (moved): CBBD\'s day stands', async () => {
        await HoopsGame.create(stored(1, '2026-11-06T05:00:00.000Z'));
        stubEspn({ 20261106: { events: [event(1, '2026-11-07T19:00Z')] } });

        const out = await tips.fillTipTimes(WINDOW);

        expect(out.dayMismatch).toBe(1);
        expect((await row(1)).startTimeTbd).toBe(true);
    });

    test('a late Hawaii tip after midnight Eastern would change the day, so it is not taken', async () => {
        // 7 PM HST on Sun 8 Nov is 00:00 ET Mon 9 Nov — the next week.
        await HoopsGame.create(stored(1, '2026-11-08T05:00:00.000Z'));
        stubEspn({ 20261108: { events: [event(1, '2026-11-09T05:00Z')] } });

        await tips.fillTipTimes(WINDOW);

        expect(await row(1)).toMatchObject({ startTimeTbd: true, week: 1 });
    });

    test('not on ESPN\'s scoreboard at all', async () => {
        await HoopsGame.create(stored(1, MON_NOV_2));
        stubEspn({ 20261102: { events: [] } });

        expect((await tips.fillTipTimes(WINDOW)).notOnEspn).toBe(1);
    });
});

describe('CBBD wins', () => {
    test('a game CBBD has a time for is never asked about, even if ESPN disagrees', async () => {
        await HoopsGame.create(stored(1, '2026-11-03T00:00:00Z', { startTimeTbd: false }));
        const espn = stubEspn({ 20261102: { events: [event(1, '2026-11-03T01:00Z')] } });

        const out = await tips.fillTipTimes(WINDOW);

        expect(espn).not.toHaveBeenCalled();
        expect(out.candidates).toBe(0);
        expect((await row(1)).startDate.toISOString()).toBe('2026-11-03T00:00:00.000Z');
    });

    test('a CBBD time written while ESPN is being asked is not overwritten', async () => {
        await HoopsGame.create(stored(1, MON_NOV_2));
        jest.spyOn(global, 'fetch').mockImplementation(async () => {
            // The ingest lands between our read and our write.
            await HoopsGame.updateOne({ id: 1 }, { $set: { startDate: new Date('2026-11-03T01:00:00Z'), startTimeTbd: false } });
            return { ok: true, status: 200, json: async () => ({ events: [event(1, '2026-11-03T00:00Z')] }) };
        });

        const out = await tips.fillTipTimes(WINDOW);

        expect(out.lost).toBe(1);
        expect(await row(1)).toMatchObject({ startTimeTbd: false, startDate: new Date('2026-11-03T01:00:00Z') });
        expect((await row(1)).startTimeSource).toBeUndefined();
    });

    test('CBBD moves a TBD game to another day while ESPN is being asked: the move stands', async () => {
        await HoopsGame.create(stored(1, MON_NOV_2));
        jest.spyOn(global, 'fetch').mockImplementation(async () => {
            await HoopsGame.updateOne({ id: 1 }, { $set: { startDate: new Date('2026-11-03T05:00:00Z'), week: 2 } });
            return { ok: true, status: 200, json: async () => ({ events: [event(1, '2026-11-03T00:00Z')] }) };
        });

        expect((await tips.fillTipTimes(WINDOW)).lost).toBe(1);
        expect(await row(1)).toMatchObject({ startTimeTbd: true, startDate: new Date('2026-11-03T05:00:00Z') });
    });

    test('games already on or over are left alone', async () => {
        await HoopsGame.create([
            stored(1, MON_NOV_2, { status: 'in_progress' }),
            stored(2, MON_NOV_2, { status: 'final' })
        ]);
        const espn = stubEspn({});

        expect((await tips.fillTipTimes(WINDOW)).candidates).toBe(0);
        expect(espn).not.toHaveBeenCalled();
    });
});

describe('keeping it current', () => {
    test('ESPN moves a time it gave us: we follow', async () => {
        await HoopsGame.create(stored(1, '2026-11-03T00:00:00Z', { startTimeTbd: false, startTimeSource: 'espn' }));
        stubEspn({ 20261102: { events: [event(1, '2026-11-03T01:30Z')] } });

        const out = await tips.fillTipTimes(WINDOW);

        expect(out.updated).toBe(1);
        expect((await row(1)).startDate.toISOString()).toBe('2026-11-03T01:30:00.000Z');
    });

    test('no change is no write', async () => {
        await HoopsGame.create(stored(1, '2026-11-03T00:00:00Z', { startTimeTbd: false, startTimeSource: 'espn' }));
        stubEspn({ 20261102: { events: [event(1, '2026-11-03T00:00Z')] } });
        const write = jest.spyOn(HoopsGame, 'bulkWrite');

        expect((await tips.fillTipTimes(WINDOW)).unchanged).toBe(1);
        expect(write).not.toHaveBeenCalled();
    });

    test.each([
        ['EST', '2026-11-03T00:00:00Z', '20261102', MON_NOV_2],
        ['EDT', '2026-10-31T23:00:00Z', '20261031', SAT_OCT_31]
    ])('ESPN goes back to TBD (%s): the placeholder returns at midnight Eastern', async (_, time, day, placeholder) => {
        await HoopsGame.create(stored(1, time, { startTimeTbd: false, startTimeSource: 'espn' }));
        stubEspn({ [day]: { events: [event(1, placeholder.replace(':00.000Z', 'Z'), false)] } });

        const out = await tips.fillTipTimes(WINDOW);

        expect(out.reverted).toBe(1);
        const g = await row(1);
        expect(g).toMatchObject({ startTimeTbd: true, startDate: new Date(placeholder) });
        expect(g.startTimeSource).toBeUndefined();
    });

    test('ESPN moves a game it timed off this day: gone from the day\'s list, so back to TBD', async () => {
        // ESPN lists a game only on its own day, so a moved game is simply absent.
        await HoopsGame.create(stored(1, '2026-11-03T00:00:00Z', { startTimeTbd: false, startTimeSource: 'espn' }));
        stubEspn({ 20261102: { events: [] } });

        expect((await tips.fillTipTimes(WINDOW)).reverted).toBe(1);
        const g = await row(1);
        expect(g).toMatchObject({ startTimeTbd: true, startDate: new Date(MON_NOV_2) });
        expect(g.startTimeSource).toBeUndefined();
    });

    test('ESPN moves a game it timed to another day: back to TBD on CBBD\'s day', async () => {
        await HoopsGame.create(stored(1, '2026-11-03T00:00:00Z', { startTimeTbd: false, startTimeSource: 'espn' }));
        stubEspn({ 20261102: { events: [event(1, '2026-11-04T00:00Z')] } });

        expect((await tips.fillTipTimes(WINDOW)).reverted).toBe(1);
        expect(await row(1)).toMatchObject({ startTimeTbd: true, startDate: new Date(MON_NOV_2) });
    });
});

describe('ESPN failing leaves everything as it was', () => {
    test.each([
        ['unreachable', new Error('fetch failed')],
        ['a 500', 500],
        ['a changed shape', { scoreboard: [] }]
    ])('%s', async (_, answer) => {
        await HoopsGame.create(stored(1, MON_NOV_2));
        stubEspn({ 20261102: answer });

        const out = await tips.fillTipTimes(WINDOW);

        expect(out.failedDays).toBe(1);
        expect(await row(1)).toMatchObject({ startTimeTbd: true, startDate: new Date(MON_NOV_2) });
    });

    test('one bad day does not stop the others', async () => {
        await HoopsGame.create([stored(1, SAT_OCT_31), stored(2, MON_NOV_2)]);
        stubEspn({ 20261031: 503, 20261102: { events: [event(2, '2026-11-03T00:00Z')] } });

        expect(await tips.fillTipTimes(WINDOW)).toMatchObject({ failedDays: 1, filled: 1 });
    });
});

describe('the CBBD ingest keeps a fill until CBBD has its own time', () => {
    const cbbdGame = (o = {}) => Object.assign({
        id: 1, sourceId: '400000001', season: SEASON, seasonLabel: '20262027', seasonType: 'regular',
        startDate: MON_NOV_2, startTimeTbd: true, status: 'scheduled',
        homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B', homePoints: 0, awayPoints: 0
    }, o);
    const refresh = (g) => {
        jest.spyOn(cbbd, 'fetchGamesInRange').mockResolvedValue({ games: [g], windows: 1, remainingCalls: 1, capHits: [] });
        return hoopsGames.refreshResults({ season: SEASON, seasonType: 'regular', start: WINDOW.start, end: WINDOW.end });
    };

    beforeEach(() => HoopsGame.create(stored(1, '2026-11-03T02:00:00Z', { startTimeTbd: false, startTimeSource: 'espn' })));

    test('CBBD still TBD on the same day: ESPN\'s time survives the pull', async () => {
        expect((await refresh(cbbdGame())).code).toBe(200);

        expect(await row(1)).toMatchObject({
            startTimeTbd: false, startTimeSource: 'espn', startDate: new Date('2026-11-03T02:00:00Z')
        });
    });

    test('CBBD gets a time: CBBD\'s, even when it differs, and the ESPN marker goes', async () => {
        await refresh(cbbdGame({ startDate: '2026-11-03T01:00:00.000Z', startTimeTbd: false }));

        const g = await row(1);
        expect(g).toMatchObject({ startTimeTbd: false, startDate: new Date('2026-11-03T01:00:00Z') });
        expect(g.startTimeSource).toBeUndefined();
    });

    test('CBBD postpones it: the filled time goes with it', async () => {
        await refresh(cbbdGame({ status: 'postponed' }));

        const g = await row(1);
        expect(g).toMatchObject({ status: 'postponed', startTimeTbd: true, startDate: new Date(MON_NOV_2) });
        expect(g.startTimeSource).toBeUndefined();
    });

    test('CBBD moves the game to another day: CBBD\'s placeholder, and the next fill starts over', async () => {
        await refresh(cbbdGame({ startDate: '2026-11-04T05:00:00.000Z' }));

        const g = await row(1);
        expect(g).toMatchObject({ startTimeTbd: true, startDate: new Date('2026-11-04T05:00:00Z') });
        expect(g.startTimeSource).toBeUndefined();
    });
});
