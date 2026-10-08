// GET /scoring-config/:league/explain on a basketball league (#495): the
// game is looked up in hoopsgames — the football collection shares its id
// space, so the old lookup 404'd or explained a football game — and the
// opponent is ranked where the game was banked (#502).

jest.mock('../modules/scoring', () => {
    const actual = jest.requireActual('../modules/scoring');
    return Object.assign({}, actual, { getScoringConfig: jest.fn() });
});

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const scoring = require('../modules/scoring');
const { resolveConfig } = require('../modules/scoring-defaults');
const Game = require('../models/game');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const router = require('../routes/scoringConfig');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;
const app = express();
app.use('/scoring-config', router);

beforeEach(async () => {
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
    scoring.getScoringConfig.mockImplementation(async (league) => resolveConfig(league, null));
    await HoopsTeam.create([
        { id: 1, season: SEASON, school: 'Elite', preseason: { rank: 5 } },
        { id: 2, season: SEASON, school: 'Awful', preseason: { rank: 300 } }
    ]);
    // Team 2 (awful) wins at home over #5: a Q1 win.
    await HoopsGame.create({ id: 100, season: SEASON, week: 3, seasonType: 'regular', status: 'final',
        startDate: new Date('2026-11-20'), homeTeamId: 2, awayTeamId: 1, homePoints: 80, awayPoints: 70, neutralSite: false });
});
afterEach(() => { seasons._reset(); jest.clearAllMocks(); });

const explain = (league, teamId, gameId) =>
    request(app).get(`/scoring-config/${league}/explain?teamId=${teamId}&gameId=${gameId}`);

test('explains the basketball game, not the football game with the same id', async () => {
    await Game.collection.insertOne({ id: 100, season: 2026, week: 3, seasonType: 'regular', homeId: 2, awayId: 1, homePoints: 1, awayPoints: 50, completed: true });
    const res = await explain(LEAGUE, 2, 100);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
    expect(res.body.matched.map(m => m.key)).toEqual(['q1Win']);
});

test('a game that is not in hoopsgames is a 404', async () => {
    expect((await explain(LEAGUE, 2, 999)).status).toBe(404);
});

test('the opponent is ranked where the game was banked, so it adds up to the points paid', async () => {
    const a = await Account.create({ firstName: 'G', lastName: 'G', email: 'g@example.invalid' });
    // Banked against #120 (a Q2 at home), though today's ranks say #5.
    await Franchise.create({ accountId: a._id, league: LEAGUE, seasons: [{ season: SEASON, franchiseName: 'Hoop Dreams',
        teamRefs: [{ id: 2, sport: 'basketball' }],
        weeklyScore: [{ week: 3, score: 3, scoreByTeam: [{ teamId: 2, gameId: 100, score: 3, quadrant: 2, oppRank: 60 }] }] }] });
    const res = await explain(LEAGUE, 2, 100);
    expect(res.body.matched.map(m => m.key)).toEqual(['q2Win']);
    expect(res.body.total).toBe(3);
});

test('a football league never reads hoopsgames: no football game 100, so 404', async () => {
    const res = await explain('graham-league', 2, 100);          // hoops game 100 exists; football does not
    expect(res.status).toBe(404);
});
