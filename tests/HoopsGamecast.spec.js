// The basketball gamecast's log (modules/hoops-gamecast.js) and its route,
// GET /hoops/games/:id/plays.
//
// The rule under test is the box score's: ESPN while the game is on, CBBD's
// stored log once final, ESPN standing in only inside the lookback. ESPN and
// CBBD are always stubbed.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const gamecast = require('../modules/hoops-gamecast');
const espnSummary = require('../modules/espn-summary');
const cbbd = require('../modules/cbbd-client');
const visibility = require('../modules/hoops-visibility');
const leagueSelection = require('../modules/league-selection');
const boxScore = require('../modules/hoops-box-score');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsShots = require('../models/hoopsShots');
const SUMMARY = require('./fixtures/espn-hoops-plays-401920982.json');

useMongo();

const SEASON = 2027;
const START = new Date(Date.UTC(2026, 10, 1, 14, 30));
// Villanova (338, ESPN 222) hosting Notre Dame (213, ESPN 87): the fixture's game.
const GAME = { id: 377909, season: SEASON, week: 1, seasonType: 'regular', status: 'in_progress', startDate: START, startTimeTbd: false,
    sourceId: '401920982', homeTeamId: 338, homeTeam: 'Villanova', awayTeamId: 213, awayTeam: 'Notre Dame',
    homePoints: 40, awayPoints: 38, neutralSite: true, conferenceGame: false };
const LOG = [{ type: 'JumpShot', text: 'stored', period: 1, clock: '19:00', side: 'home', home: 2, away: 0, points: 2 }];

// The real summary through the real shaper: whatever shape the module asks for.
const stubEspn = (body = SUMMARY) => jest.spyOn(espnSummary, 'summaryFor')
    .mockImplementation(async (sport, id, shape) => (body ? { value: shape(body), error: null } : { value: null, error: 'down' }));

beforeEach(async () => {
    jest.spyOn(cbbd, 'cbbdGet').mockRejectedValue(new Error('no CBBD call expected'));
    await HoopsTeam.create([
        { id: 338, season: SEASON, school: 'Villanova', sourceId: '222' },
        { id: 213, season: SEASON, school: 'Notre Dame', sourceId: '87' }
    ]);
});
afterEach(() => jest.restoreAllMocks());

describe('forGame', () => {
    test('live: ESPN\'s log, sides matched on ESPN team ids', async () => {
        const espn = stubEspn();
        const out = await gamecast.forGame(GAME);
        expect(espn).toHaveBeenCalledWith('basketball', '401920982', expect.any(Function));
        expect(out.source).toBe('espn');
        expect(out.plays[out.plays.length - 1]).toMatchObject({ home: 72, away: 74 });
    });

    test('our home listed as ESPN\'s away: still the right side', async () => {
        stubEspn();
        const flipped = Object.assign({}, GAME, { homeTeamId: 213, awayTeamId: 338 });
        const out = await gamecast.forGame(flipped);
        expect(out.plays[out.plays.length - 1]).toMatchObject({ home: 74, away: 72 });
    });

    test('final with a stored log: CBBD\'s, and ESPN is never asked', async () => {
        const espn = stubEspn();
        await HoopsShots.create({ gameId: GAME.id, season: SEASON, log: LOG });
        const out = await gamecast.forGame(Object.assign({}, GAME, { status: 'final', homePoints: 72, awayPoints: 74 }), { now: START.getTime() });
        expect(out).toEqual({ source: 'cbbd', plays: [expect.objectContaining({ text: 'stored' })] });
        expect(espn).not.toHaveBeenCalled();
    });

    test('a stored log that cannot be read: ESPN stands in, as for none', async () => {
        stubEspn();
        jest.spyOn(require('../modules/hoops-shots'), 'logFor').mockRejectedValue(new Error('db down'));
        const out = await gamecast.forGame(Object.assign({}, GAME, { status: 'final', homePoints: 72, awayPoints: 74 }), { now: START.getTime() });
        expect(out.source).toBe('espn');
    });

    test('final, nothing stored, inside the lookback: ESPN stands in; past it, nothing', async () => {
        const espn = stubEspn();
        const final = Object.assign({}, GAME, { status: 'final', homePoints: 72, awayPoints: 74 });
        expect((await gamecast.forGame(final, { now: START.getTime() + boxScore.LOOKBACK_MS })).source).toBe('espn');
        expect(await gamecast.forGame(final, { now: START.getTime() + boxScore.LOOKBACK_MS + 1 })).toBeNull();
        expect(espn).toHaveBeenCalledTimes(1);
    });

    test('still to play, ESPN down, or no ESPN id: null', async () => {
        const espn = stubEspn(null);
        expect(await gamecast.forGame(Object.assign({}, GAME, { status: 'scheduled', homePoints: null, awayPoints: null }))).toBeNull();
        expect(await gamecast.forGame(GAME)).toBeNull();
        expect(await gamecast.espnFor(Object.assign({}, GAME, { sourceId: null }))).toBeNull();
        expect(espn).toHaveBeenCalledTimes(1);
    });
});

describe('slice', () => {
    const log = { source: 'espn', plays: Array.from({ length: 30 }, (_, i) => ({ n: i })) };
    test('everything at first; then the tail from RESEND before what the page holds', () => {
        expect(gamecast.slice(log)).toMatchObject({ source: 'espn', total: 30, from: 0 });
        const part = gamecast.slice(log, '25');
        expect(part.from).toBe(25 - gamecast.RESEND);
        expect(part.plays[0]).toEqual({ n: 15 });
        expect(gamecast.slice(log, '99').from).toBe(30 - gamecast.RESEND);
        expect(gamecast.slice(log, 'x').from).toBe(0);
        expect(gamecast.slice(log, '3').from).toBe(0);
    });
});

describe('GET /hoops/games/:id/plays', () => {
    function app() {
        const a = express();
        a.use('/hoops/games', require('../routes/hoopsGames'));
        return a;
    }

    test('serves the log, and only the tail with ?since', async () => {
        jest.spyOn(visibility, 'seesBasketball').mockResolvedValue(true);
        jest.spyOn(leagueSelection, 'selectedLeague').mockResolvedValue('');
        stubEspn();
        await HoopsGame.create(GAME);
        const all = await request(app()).get('/hoops/games/377909/plays');
        expect(all.status).toBe(200);
        expect(all.body.source).toBe('espn');
        expect(all.body.from).toBe(0);
        expect(all.body.plays).toHaveLength(all.body.total);
        const tail = await request(app()).get('/hoops/games/377909/plays?since=' + (all.body.total - 2));
        expect(tail.body.from).toBe(all.body.total - 2 - gamecast.RESEND);
        expect(tail.body.plays).toHaveLength(gamecast.RESEND + 2);
    });

    test('nothing to show: an empty log, not an error', async () => {
        jest.spyOn(visibility, 'seesBasketball').mockResolvedValue(true);
        await HoopsGame.create(Object.assign({}, GAME, { status: 'scheduled', homePoints: null, awayPoints: null }));
        const r = await request(app()).get('/hoops/games/377909/plays');
        expect(r.body).toEqual({ source: null, total: 0, from: 0, plays: [] });
    });

    test('hidden from someone in no basketball league; 400 for a bad id; 404 unknown; 500 when it throws', async () => {
        const sees = jest.spyOn(visibility, 'seesBasketball').mockResolvedValue(false);
        expect((await request(app()).get('/hoops/games/377909/plays')).status).toBe(404);
        sees.mockResolvedValue(true);
        expect((await request(app()).get('/hoops/games/abc/plays')).status).toBe(400);
        expect((await request(app()).get('/hoops/games/1/plays')).status).toBe(404);
        await HoopsGame.create(GAME);
        jest.spyOn(gamecast, 'forGame').mockRejectedValue(new Error('boom'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await request(app()).get('/hoops/games/377909/plays')).status).toBe(500);
    });
});
