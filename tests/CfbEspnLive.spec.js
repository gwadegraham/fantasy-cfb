// Football's live box score from ESPN (modules/cfb-espn-live.js) and its
// route, GET /games/live-stats/:id.
//
// The fixture is one real game mid-fourth-quarter, trimmed: Central Michigan
// (2117) at Eastern Michigan (2199), 4 Nov 2026, CMU 35-0 at 11:07. ESPN is
// always stubbed.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const live = require('../modules/cfb-espn-live');
const espnSummary = require('../modules/espn-summary');
const Game = require('../models/game');
const SUMMARY = require('./fixtures/espn-cfb-summary-401866456.json');

useMongo();

const CMU = 2117, EMU = 2199;
const GAME = { id: 401866456, homeId: EMU, awayId: CMU };
const clone = (o) => JSON.parse(JSON.stringify(o));
const HOUR = 3600 * 1000;

afterEach(() => jest.restoreAllMocks());

describe('shape', () => {
    const out = live.shape(GAME)(SUMMARY);

    test('sides are matched on team id: CMU away, EMU home', () => {
        expect(out.playerStats.away.passing[0]).toMatchObject({ name: 'Jadyn Glasser', c: 14, att: 19, yds: 175, td: 1, int: 0 });
        expect(out.playerStats.home.passing[0]).toMatchObject({ name: 'Brogan McCaughey', yds: 43, int: 1 });
        expect(out.leaders.away.rushingYards).toEqual({ name: 'Nick Woodford', pos: 'RB', line: '21 CAR, 123 YDS, 3 TD' });
        expect(out.leaders.home.passingYards.name).toBe('Brogan McCaughey');
    });

    test('the same game with the ids the other way round turns every side round', () => {
        const flipped = live.shape({ id: GAME.id, homeId: CMU, awayId: EMU })(SUMMARY);
        expect(flipped.playerStats.home.passing[0].name).toBe('Jadyn Glasser');
        expect(flipped.teamStats.home.totalYards).toBe(404);
        expect(flipped.leaders.home.rushingYards.name).toBe('Nick Woodford');
    });

    test('ESPN\'s "Team" row is not a player; QBR is null, not 0', () => {
        const names = out.playerStats.away.rushing.map(p => p.name);
        expect(names).toContain('Nick Woodford');
        expect(names.some(n => /team/i.test(n))).toBe(false);
        expect(out.playerStats.away.passing.every(p => p.qbr === null)).toBe(true);
    });

    test('interceptions, a category of their own, land in the defensive line', () => {
        // Jaion Jackson (1 tackle, 1 INT) is outside the top six; make him a
        // leader so his line is kept, then take the interception away.
        const s = clone(SUMMARY);
        const cmu = s.boxscore.players.find(p => p.team.id === String(CMU)).statistics;
        cmu.find(c => c.name === 'defensive').athletes.find(a => a.athlete.displayName === 'Jaion Jackson').stats[0] = '9';
        const jackson = () => live.shape(GAME)(s).playerStats.away.defensive.find(p => p.name === 'Jaion Jackson');
        expect(jackson()).toMatchObject({ tot: 9, int: 1 });
        cmu.find(c => c.name === 'interceptions').athletes = [];
        expect(jackson().int).toBe(0);
    });

    test('team stats: CFBD\'s keys from ESPN\'s totals, TDs, sacks and TFL summed from the players', () => {
        expect(out.teamStats.away).toMatchObject({ totalYards: 404, netPassingYards: 175, rushingYards: 229, turnovers: 0,
            penalties: 3, totalPenaltiesYards: 20, thirdDownPct: 50, passingTDs: 1, rushingTDs: 4, tacklesForLoss: 4 });
        expect(out.teamStats.home).toMatchObject({ totalYards: 52, interceptions: 1, sacks: 1 });
        expect(out.teamStats.away.possessionSeconds).toBeGreaterThan(out.teamStats.home.possessionSeconds);
    });

    test('a team that is not this game\'s, or no box yet: null', () => {
        expect(live.shape({ homeId: 1, awayId: CMU })(SUMMARY)).toBeNull();
        expect(live.shape(GAME)(Object.assign(clone(SUMMARY), { boxscore: { teams: [], players: [] } }))).toBeNull();
        expect(live.shape(GAME)({})).toBeNull();
    });
});

describe('wantsEspn', () => {
    const now = Date.UTC(2026, 10, 5, 2, 0);
    const at = (h) => new Date(now - h * HOUR);
    const box = { home: { passing: [] }, away: {} };

    test('live: yes; before kickoff: no', () => {
        expect(live.wantsEspn({ startDate: at(2), completed: false }, now)).toBe(true);
        expect(live.wantsEspn({ startDate: at(-1), completed: false }, now)).toBe(false);
        expect(live.wantsEspn({ completed: false }, now)).toBe(false);
        expect(live.wantsEspn(null, now)).toBe(false);
    });

    test('final: only while CFBD has no box, and only inside the lookback', () => {
        expect(live.wantsEspn({ startDate: at(4), completed: true }, now)).toBe(true);
        expect(live.wantsEspn({ startDate: at(4), completed: true, playerStats: { home: {}, away: {} } }, now)).toBe(true);
        expect(live.wantsEspn({ startDate: at(4), completed: true, playerStats: box }, now)).toBe(false);
        expect(live.wantsEspn({ startDate: new Date(now - live.LOOKBACK_MS), completed: true }, now)).toBe(true);
        expect(live.wantsEspn({ startDate: new Date(now - live.LOOKBACK_MS - 1), completed: true }, now)).toBe(false);
    });
});

describe('forGame', () => {
    const stub = (body = SUMMARY) => jest.spyOn(espnSummary, 'summaryFor')
        .mockImplementation(async (sport, id, shape) => (body ? { value: shape(body), error: null } : { value: null, error: 'down' }));

    test('live: ESPN\'s box under the game\'s own id', async () => {
        const espn = stub();
        const out = await live.forGame(Object.assign({ startDate: new Date(Date.now() - HOUR), completed: false }, GAME));
        expect(espn).toHaveBeenCalledWith('football', GAME.id, expect.any(Function), expect.any(Number));
        expect(out).toMatchObject({ source: 'espn', final: false });
        expect(out.playerStats.away.passing[0].name).toBe('Jadyn Glasser');
    });

    test('a final marks itself; ESPN down or not wanted: null, and ESPN not asked when not wanted', async () => {
        stub();
        expect((await live.forGame(Object.assign({ startDate: new Date(Date.now() - HOUR), completed: true }, GAME))).final).toBe(true);
        jest.restoreAllMocks();
        const espn = stub(null);
        expect(await live.forGame(Object.assign({ startDate: new Date(Date.now() - HOUR), completed: false }, GAME))).toBeNull();
        expect(await live.forGame(Object.assign({ startDate: new Date(Date.now() + HOUR), completed: false }, GAME))).toBeNull();
        expect(espn).toHaveBeenCalledTimes(1);
    });
});

describe('GET /games/live-stats/:id', () => {
    function app() {
        const a = express();
        a.use('/games', require('../routes/games'));
        return a;
    }
    const doc = (o) => Object.assign({ id: GAME.id, season: 2026, week: 10, homeId: EMU, homeTeam: 'Eastern Michigan',
        awayId: CMU, awayTeam: 'Central Michigan', seasonType: 'regular', neutralSite: false, conferenceGame: true, startTimeTbd: false, startDate: new Date(Date.now() - HOUR), completed: false }, o);

    test('a live game: ESPN\'s box', async () => {
        jest.spyOn(espnSummary, 'summaryFor').mockImplementation(async (s, id, shape) => ({ value: shape(SUMMARY), error: null }));
        await Game.create(doc());
        const r = await request(app()).get('/games/live-stats/' + GAME.id);
        expect(r.status).toBe(200);
        expect(r.body.source).toBe('espn');
        expect(r.body.teamStats.away.totalYards).toBe(404);
    });

    test('a final with CFBD\'s box: { source: null }, ESPN never asked', async () => {
        const espn = jest.spyOn(espnSummary, 'summaryFor');
        await Game.create(doc({ completed: true, playerStats: { home: { passing: [{ name: 'A', c: 1, att: 1, yds: 1 }] }, away: {} } }));
        const r = await request(app()).get('/games/live-stats/' + GAME.id);
        expect(r.body).toEqual({ source: null });
        expect(espn).not.toHaveBeenCalled();
    });

    test('400 for a bad id, 404 unknown, 500 when it throws', async () => {
        expect((await request(app()).get('/games/live-stats/abc')).status).toBe(400);
        expect((await request(app()).get('/games/live-stats/1')).status).toBe(404);
        await Game.create(doc());
        jest.spyOn(live, 'forGame').mockRejectedValue(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await request(app()).get('/games/live-stats/' + GAME.id)).status).toBe(500);
    });
});
