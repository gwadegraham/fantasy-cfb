// The football game page's fantasy read (#506 Phase 3): GET
// /games/fantasy/:league/:gameId and the pure module behind it,
// modules/game-fantasy.js.
//
// What a manager reads off it: who has each side in the league being viewed,
// what the game banked them, and — before it is decided — what a win (or a
// loss) would pay, from the real scoring engine. And what it must never do:
// answer for a basketball league, whose franchises own basketball team ids
// that collide with football's (#489).

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo, mirrorUsers } = require('./helpers/mongo');
const Game = require('../models/game');
const User = require('../models/user');
const League = require('../models/league');
const scoring = require('../modules/scoring');
const { resolveConfig } = require('../modules/scoring-defaults');
const { sideRead, asResult, stakeFor } = require('../modules/game-fantasy');
const gamesRouter = require('../routes/games');

const SEASON = 2026;
const LEAGUE = 'graham-league';
const MICH = 130, MINN = 135, WMU = 2711, BSU = 68;

const app = express();
app.use('/games', gamesRouter);

useMongo();

const team = (id, school) => ({
    id, school, mascot: 'M', abbreviation: school.slice(0, 4).toUpperCase(), conference: 'Big Ten', color: '#000',
    logos: [], location: { venue_id: id, name: 'S', city: 'C', state: 'ST', zip: '0', latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false }
});

// Michigan at Minnesota, a Big Ten game still to play; Boise State at
// Western Michigan, final.
async function seed() {
    await Game.insertMany([
        { id: 900, season: SEASON, week: 5, seasonType: 'regular', startDate: new Date(Date.now() + 86400000).toISOString(),
          startTimeTbd: false, neutralSite: false, conferenceGame: true, completed: false,
          homeId: MINN, homeTeam: 'Minnesota', homeConference: 'Big Ten', awayId: MICH, awayTeam: 'Michigan', awayConference: 'Big Ten' },
        { id: 901, season: SEASON, week: 4, seasonType: 'regular', startDate: '2026-09-26T19:00:00.000Z',
          startTimeTbd: false, neutralSite: false, conferenceGame: false, completed: true,
          homeId: WMU, homeTeam: 'Western Michigan', homeConference: 'Mid-American', homePoints: 7,
          awayId: BSU, awayTeam: 'Boise State', awayConference: 'Mountain West', awayPoints: 32 }
    ]);
    await User.create({
        firstName: 'Garrett', lastName: 'Graham', league: LEAGUE,
        seasons: [{ season: SEASON, franchiseName: 'Name, Image, & Sadness', teams: [team(MICH, 'Michigan'), team(BSU, 'Boise State')],
            weeklyScore: [{ week: 4, score: 1, scoreByTeam: [{ team: 'Boise State', teamId: BSU, gameId: 901, score: 1 }] }] }]
    });
    await User.create({
        firstName: 'Treyce', lastName: 'Williams', league: LEAGUE,
        seasons: [{ season: SEASON, franchiseName: 'Pig Pen Pity Party', teams: [team(MINN, 'Minnesota')], weeklyScore: [] }]
    });
    // Another league's manager owns Western Michigan. Nothing of theirs may appear.
    await User.create({
        firstName: 'Other', lastName: 'Person', league: 'claunts-league',
        seasons: [{ season: SEASON, franchiseName: 'Elsewhere', teams: [team(WMU, 'Western Michigan')],
            weeklyScore: [{ week: 4, score: 0, scoreByTeam: [{ team: 'Western Michigan', teamId: WMU, gameId: 901, score: 0 }] }] }]
    });
    // A basketball league whose franchise owns BASKETBALL team 130 — the same
    // number as football's Michigan.
    await League.create({ code: 'hoops-league', name: 'Hoop Dreams', sport: 'basketball' });
    await User.create({
        firstName: 'Hoops', lastName: 'Fan', league: 'hoops-league',
        seasons: [{ season: SEASON, franchiseName: 'Bracket Busters', teams: [team(MICH, 'Hoops 130')], weeklyScore: [] }]
    });
    await mirrorUsers();
}

beforeEach(seed);

// The scoring engine's network-backed lookups, stubbed with what the
// scoring pass would read: Graham's default config, no poll, no bracket.
function stubEngine(over = {}) {
    jest.spyOn(scoring, 'cachedScoringConfig').mockResolvedValue(over.cfg || resolveConfig(LEAGUE, null));
    jest.spyOn(scoring, 'getRankingsForGame').mockResolvedValue(over.rankings || null);
    jest.spyOn(scoring, 'getBracketForGame').mockResolvedValue(null);
}
afterEach(() => { jest.restoreAllMocks(); });

describe('GET /games/fantasy/:league/:gameId', () => {
    test('a final: each side’s owner in THIS league, and what it banked', async () => {
        stubEngine();
        const res = await request(app).get(`/games/fantasy/${LEAGUE}/901`);
        expect(res.status).toBe(200);
        expect(res.body.final).toBe(true);
        expect(res.body.away).toMatchObject({ teamId: BSU, banked: 1, owner: { franchise: 'Name, Image, & Sadness', firstName: 'Garrett' } });
        // Western Michigan is owned only in the OTHER league.
        expect(res.body.home).toEqual({ teamId: WMU, owner: null, banked: null });
        // A decided game has no stakes, and never asks the engine.
        expect(res.body.away.ifWin).toBeUndefined();
        expect(scoring.cachedScoringConfig).not.toHaveBeenCalled();
    });

    test('a game to play: what a win pays each manager, from the real engine', async () => {
        stubEngine();
        const res = await request(app).get(`/games/fantasy/${LEAGUE}/900`);
        expect(res.status).toBe(200);
        const v = resolveConfig(LEAGUE, null).values;
        // A conference win in the stacking model: base + conference bonus.
        expect(res.body.away).toMatchObject({ teamId: MICH, owner: { franchise: 'Name, Image, & Sadness' }, ifWin: v.baseWin + v.confBonus, ifLoss: 0 });
        expect(res.body.home).toMatchObject({ teamId: MINN, owner: { franchise: 'Pig Pen Pity Party' }, ifWin: v.baseWin + v.confBonus, ifLoss: 0 });
        // Not scored yet is not zero.
        expect(res.body.away.banked).toBeNull();
    });

    test('a live game gets no stakes — the page only shows them before kickoff', async () => {
        stubEngine();
        await Game.updateOne({ id: 900 }, { period: 2, clock: '5:00', homePoints: 7, awayPoints: 3 });
        const res = await request(app).get(`/games/fantasy/${LEAGUE}/900`);
        expect(res.status).toBe(200);
        expect(res.body.away.owner.franchise).toBe('Name, Image, & Sadness');
        expect(res.body.away.ifWin).toBeUndefined();
        expect(scoring.cachedScoringConfig).not.toHaveBeenCalled();
    });

    test('the week’s poll counts: a win over a top-10 team pays its bonus', async () => {
        stubEngine({ rankings: { polls: [{ poll: 'AP Top 25', ranks: [{ rank: 4, school: 'Minnesota' }] }] } });
        const res = await request(app).get(`/games/fantasy/${LEAGUE}/900`);
        const v = resolveConfig(LEAGUE, null).values;
        expect(res.body.away.ifWin).toBe(v.baseWin + v.confBonus + v.rankedTop10Bonus);
        expect(res.body.home.ifWin).toBe(v.baseWin + v.confBonus);
    });

    test('a basketball league is refused, not answered with its own franchises', async () => {
        stubEngine();
        const res = await request(app).get('/games/fantasy/hoops-league/900');
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain('Bracket Busters');
    });

    test('an unknown league and an unknown game are 404s; a junk id is a 400', async () => {
        stubEngine();
        expect((await request(app).get('/games/fantasy/no-such-league/900')).status).toBe(404);
        expect((await request(app).get(`/games/fantasy/${LEAGUE}/12345`)).status).toBe(404);
        expect((await request(app).get(`/games/fantasy/${LEAGUE}/abc`)).status).toBe(400);
    });

    test('a scoring lookup that fails costs the stakes, not the read', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(scoring, 'cachedScoringConfig').mockRejectedValue(new Error('config down'));
        const res = await request(app).get(`/games/fantasy/${LEAGUE}/900`);
        expect(res.status).toBe(200);
        expect(res.body.away.owner.franchise).toBe('Name, Image, & Sadness');
        expect(res.body.away.ifWin).toBeUndefined();
    });

    test('nobody rostered on either side: owners null, and the engine is never asked', async () => {
        stubEngine();
        await User.deleteMany({});
        await mirrorUsers();
        const res = await request(app).get(`/games/fantasy/${LEAGUE}/900`);
        expect(res.status).toBe(200);
        expect(res.body.away.owner).toBeNull();
        expect(res.body.home.owner).toBeNull();
        expect(scoring.cachedScoringConfig).not.toHaveBeenCalled();
    });
});

describe('modules/game-fantasy.js', () => {
    const game = { id: 7, homeId: 1, awayId: 2, homePoints: null, awayPoints: null, conferenceGame: true, seasonType: 'regular' };

    test('asResult fills in a result for either side and leaves the rest alone', () => {
        expect(asResult(game, 1, true)).toMatchObject({ homePoints: 1, awayPoints: 0, conferenceGame: true });
        expect(asResult(game, 1, false)).toMatchObject({ homePoints: 0, awayPoints: 1 });
        expect(asResult(game, 2, true)).toMatchObject({ homePoints: 0, awayPoints: 1 });
        expect(game.homePoints).toBeNull();          // not mutated
    });

    test('sideRead: banked comes from the team AND game key; absent is null, not 0', () => {
        const owners = { 1: { userId: 'u', firstName: 'G', name: 'G G', franchise: 'F', color: '#fff' } };
        expect(sideRead(game, 'home', owners, { '1:7': 0 })).toEqual({ teamId: 1, owner: { userId: 'u', firstName: 'G', name: 'G G', franchise: 'F' }, banked: 0 });
        expect(sideRead(game, 'home', owners, { '1:8': 5 }).banked).toBeNull();
        expect(sideRead(game, 'away', owners, { '2:7': 3 })).toEqual({ teamId: 2, owner: null, banked: null });
    });

    test('stakeFor asks the engine for the team as winner and as loser', () => {
        const evaluate = jest.fn((model, teamId, g) => (g.homePoints > g.awayPoints) === (teamId === g.homeId) ? 3 : 1);
        expect(stakeFor(evaluate, { model: 'graham' }, game, 1, null, null)).toEqual({ ifWin: 3, ifLoss: 1 });
        expect(evaluate.mock.calls[0][0]).toBe('graham');
        expect(evaluate.mock.calls[0][1]).toBe(1);
    });
});
