// ESPN's live basketball scoreboard laid over CBBD's
// (modules/hoops-espn-scoreboard.js). The network is always stubbed; how the
// overlay lands in the database and the poller is in HoopsLiveScores.spec.js.

const espnBoard = require('../modules/hoops-espn-scoreboard');

const competitor = (homeAway, score, lines) => ({
    homeAway, score: String(score), team: { id: '1' },
    linescores: lines && lines.map((v, i) => ({ value: v, period: i + 1 }))
});
const event = (id, state, o = {}) => Object.assign({
    id, date: '2026-11-18T00:00Z',
    status: { period: 2, displayClock: '6:10', type: { state, completed: state === 'post', name: 'X' } },
    competitions: [{ competitors: [competitor('home', 55, [30, 25]), competitor('away', 50, [28, 22])] }]
}, o);

const cbbdRow = (status, home, away, o = {}) => Object.assign({
    id: 10, status, period: 2, clock: '8:43',
    homeTeam: { id: 1, points: home, lineScores: [30, home - 30] },
    awayTeam: { id: 2, points: away, lineScores: [28, away - 28] }
}, o);
const ev = (home, away, o = {}) => Object.assign({
    period: 2, clock: '6:10', home: { points: home, lineScores: [30, home - 30] }, away: { points: away, lineScores: [28, away - 28] }
}, o);

afterEach(() => { jest.restoreAllMocks(); });

describe('shapeEvent', () => {
    test('a game in progress: score, half, clock and half scores', () => {
        expect(espnBoard.shapeEvent(event('1', 'in'))).toEqual({
            period: 2, clock: '6:10', home: { points: 55, lineScores: [30, 25] }, away: { points: 50, lineScores: [28, 22] }
        });
    });
    test('half scores come back in half order whatever order ESPN lists them', () => {
        const e = event('1', 'in');
        e.competitions[0].competitors[0].linescores.reverse();
        expect(espnBoard.shapeEvent(e).home.lineScores).toEqual([30, 25]);
    });
    test('half scores always add up to the header score: the current half absorbs the drift', () => {
        const e = event('1', 'in');
        e.status.period = 1;
        e.competitions[0].competitors[1].score = '13';
        e.competitions[0].competitors[1].linescores = [{ value: 15, period: 1 }];     // seen live
        expect(espnBoard.shapeEvent(e).away.lineScores).toEqual([13]);
        e.status.period = 2;
        e.competitions[0].competitors[1].linescores = [{ value: 15, period: 1 }, { value: 2, period: 2 }];
        expect(espnBoard.shapeEvent(e).away.lineScores).toBeNull();                 // cannot add up
    });
    test('second half under way but no second-half entry yet: the split is dropped, not misfiled', () => {
        const e = event('1', 'in');
        e.competitions[0].competitors[0].linescores = [{ value: 30, period: 1 }];
        expect(espnBoard.shapeEvent(e).home).toEqual({ points: 55, lineScores: null });
    });
    test('a completed game counts; a postponed one (also "post") does not', () => {
        expect(espnBoard.shapeEvent(event('1', 'post'))).not.toBeNull();
        const postponed = event('1', 'post');
        postponed.status.type.completed = false;
        expect(espnBoard.shapeEvent(postponed)).toBeNull();
    });
    test('not tipped, no score or no sides: nothing', () => {
        expect(espnBoard.shapeEvent(event('1', 'pre'))).toBeNull();
        const noScore = event('1', 'in');
        noScore.competitions[0].competitors[0].score = '';
        expect(espnBoard.shapeEvent(noScore)).toBeNull();
        expect(espnBoard.shapeEvent(event('1', 'in', { competitions: [{ competitors: [] }] }))).toBeNull();
        expect(espnBoard.shapeEvent({})).toBeNull();
    });
});

describe('fetchDay', () => {
    test('asks for one Eastern day of Division I and keeps only games that have tipped', async () => {
        const f = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ events: [event('1', 'in'), event('2', 'pre'), event('3', 'post')] }) });
        const out = await espnBoard.fetchDay('2026-11-17');
        expect(f.mock.calls[0][0]).toBe(`${espnBoard.SCOREBOARD}?dates=20261117&groups=50&limit=500`);
        expect([...out.keys()]).toEqual(['1', '3']);
    });
    test('a bad status or a changed shape throws', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 503 });
        await expect(espnBoard.fetchDay('2026-11-17')).rejects.toThrow('503');
        jest.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({}) });
        await expect(espnBoard.fetchDay('2026-11-17')).rejects.toThrow('no events array');
    });
});

describe('fetchLive', () => {
    test('one failing day costs only that day, and never throws', async () => {
        jest.spyOn(espnBoard, 'fetchDay').mockImplementation(async (day) => {
            if (day === '2026-11-18') throw new Error('ESPN scoreboard 2026-11-18 500');
            return new Map([['1', ev(10, 8)]]);
        });
        const out = await espnBoard.fetchLive(['2026-11-17', '2026-11-18']);
        expect([...out.events.keys()]).toEqual(['1']);
        expect(out.error).toBe('ESPN scoreboard 2026-11-18 500');
    });
    test('no days, no calls', async () => {
        const f = jest.spyOn(espnBoard, 'fetchDay');
        expect(await espnBoard.fetchLive([])).toEqual({ events: new Map(), error: null });
        expect(f).not.toHaveBeenCalled();
    });
});

describe('daysFor', () => {
    test('each game on its own Eastern day — a 9 PM tip is already tomorrow in UTC', () => {
        expect(espnBoard.daysFor([
            { startDate: new Date('2026-11-18T02:00:00Z') },        // 9 PM EST on the 17th
            { startDate: new Date('2026-11-18T00:00:00Z') },
            { startDate: new Date('2026-11-18T17:00:00Z') }
        ])).toEqual(['2026-11-17', '2026-11-18']);
        expect(espnBoard.daysFor(null)).toEqual([]);
    });
});

describe('behind', () => {
    const at = (period, clock, home, away) => ({ period, clock, home, away });
    test('game time decides first; points only when game time cannot', () => {
        expect(espnBoard.behind(at(1, '1:00', 70, 70), at(2, '19:00', 40, 40))).toBe(true);
        expect(espnBoard.behind(at(2, '6:00', 40, 40), at(2, '5:00', 50, 50))).toBe(true);
        expect(espnBoard.behind(at(2, '4:00', 49, 50), at(2, '5:00', 50, 50))).toBe(false);   // a correction
        expect(espnBoard.behind(at(2, '5:00', 49, 50), at(2, '5:00', 50, 50))).toBe(true);
        expect(espnBoard.behind(at(2, null, 50, 49), at(2, '5:00', 50, 50))).toBe(true);
        expect(espnBoard.behind(at(2, null, 51, 50), at(2, '5:00', 50, 50))).toBe(false);
    });
});

describe('elapsed', () => {
    test('two 20-minute halves, then 5-minute overtimes', () => {
        expect(espnBoard.elapsed(1, '20:00')).toBe(0);
        expect(espnBoard.elapsed(1, '0:00')).toBe(1200);
        expect(espnBoard.elapsed(2, '10:00')).toBe(1800);
        expect(espnBoard.elapsed(3, '2:30')).toBe(2550);
        expect(espnBoard.elapsed(4, '45.3')).toBeCloseTo(2400 + 300 + 254.7);
    });
    test('unknown half or clock is unknown, never 0', () => {
        expect(espnBoard.elapsed(null, '5:00')).toBeNull();
        expect(espnBoard.elapsed(2, null)).toBeNull();
        expect(espnBoard.elapsed(0, '5:00')).toBeNull();
    });
});

describe('overlay', () => {
    test('a game CBBD has scheduled goes in progress with ESPN\'s numbers', () => {
        const out = espnBoard.overlay(cbbdRow('scheduled', 0, 0),
            ev(4, 2, { period: 1, clock: '18:40', home: { points: 4, lineScores: [4] }, away: { points: 2, lineScores: [2] } }));
        expect(out).toMatchObject({ id: 10, status: 'in_progress', period: 1, clock: '18:40' });
        expect(out.homeTeam).toEqual({ id: 1, points: 4, lineScores: [4] });
        expect(out.awayTeam.points).toBe(2);
    });
    test('ESPN ahead of a running CBBD row wins; CBBD\'s team ids survive', () => {
        const out = espnBoard.overlay(cbbdRow('in_progress', 50, 48), ev(55, 50));
        expect(out).toMatchObject({ clock: '6:10', homeTeam: { id: 1, points: 55 }, awayTeam: { id: 2, points: 50 } });
    });
    test('ESPN behind CBBD — on the clock or on either score — leaves CBBD\'s row as is', () => {
        const row = cbbdRow('in_progress', 50, 48);
        expect(espnBoard.overlay(row, ev(55, 50, { clock: '9:30' }))).toBe(row);
        expect(espnBoard.overlay(row, ev(49, 50, { clock: '8:43' }))).toBe(row);
        expect(espnBoard.overlay(row, ev(55, 47, { clock: '8:43' }))).toBe(row);
    });
    test('ESPN with a corrected (lower) score but a later clock wins: the correction stands', () => {
        expect(espnBoard.overlay(cbbdRow('in_progress', 50, 48), ev(49, 48)).homeTeam.points).toBe(49);
    });
    test('ESPN saying exactly what CBBD says hands back CBBD\'s row, so it is not counted as ESPN\'s', () => {
        const row = cbbdRow('in_progress', 50, 48);
        expect(espnBoard.overlay(row, ev(50, 48, { clock: '8:43' }))).toBe(row);
    });
    test('a final ESPN game is still only "in progress": the final is CBBD\'s', () => {
        expect(espnBoard.overlay(cbbdRow('in_progress', 70, 66, { clock: '0:30' }), ev(74, 68, { clock: '0:00' })).status).toBe('in_progress');
    });
    test('final, postponed or cancelled on CBBD, or nothing from ESPN: untouched', () => {
        for (const status of ['final', 'postponed', 'cancelled']) {
            const row = cbbdRow(status, 50, 48);
            expect(espnBoard.overlay(row, ev(60, 50))).toBe(row);
        }
        const row = cbbdRow('in_progress', 50, 48);
        expect(espnBoard.overlay(row, undefined)).toBe(row);
    });
    test('ESPN without half scores keeps CBBD\'s', () => {
        const out = espnBoard.overlay(cbbdRow('in_progress', 50, 48), ev(55, 50, { home: { points: 55, lineScores: null } }));
        expect(out.homeTeam.lineScores).toEqual([30, 20]);
    });
});
