// GET /standings/recap on a BASKETBALL league (#558).
//
// The route used to read football's games, spreads and AP poll by team id.
// 130 basketball ids are also football ids (#489), so a hoops roster could be
// recapped against somebody else's schedule. These pin the hoops branch: weeks
// from hoopsgames, names from the hydrated roster, the story from quadrants
// and seeds — and nothing from the football collections.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const Game = require('../models/game');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const LEAGUE = 'hoops-league';
const SEASON = 2027;
// Relative to the real clock: the route judges completeness against `new Date()`.
const PAST = (daysAgo) => new Date(Date.now() - daysAgo * 864e5);
const FUTURE = new Date(Date.now() + 7 * 864e5);

const app = express();
app.use('/standings', require('../routes/standings'));

async function manager(name, teamIds, weeklyScore) {
    const a = await Account.create({ firstName: name, lastName: 'M', email: `${name}@example.invalid` });
    await Franchise.create({
        accountId: a._id, league: LEAGUE,
        seasons: [{ season: SEASON, teamRefs: teamIds.map(id => ({ id, sport: 'basketball' })), weeklyScore }]
    });
    return a;
}

const hoopsGame = (o) => Object.assign({
    season: SEASON, seasonType: 'regular', status: 'final',
    homePoints: 70, awayPoints: 60, neutralSite: false
}, o);

beforeEach(async () => {
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await seasons.prime();
    await HoopsTeam.create([
        { id: 1, season: SEASON, school: 'Gonzaga', logos: ['gonzaga.png'] },
        { id: 2, season: SEASON, school: 'Baylor' }
    ]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

const recap = (userId) => request(app).get(`/standings/recap/${LEAGUE}/latest/${userId}`);

test('recaps a basketball week with the roster team named and the Q1 story told', async () => {
    await HoopsGame.create(hoopsGame({ id: 501, week: 19, startDate: PAST(1), homeTeamId: 1, awayTeamId: 77, homeTeam: 'Gonzaga', awayTeam: 'Duke' }));
    const ann = await manager('Ann', [1, 2], [{ week: 19, score: 5, scoreByTeam: [{ teamId: 1, gameId: 501, score: 5, quadrant: 1, oppRank: 4 }] }]);

    const res = await recap(ann._id);

    expect(res.status).toBe(200);
    expect(res.body.season).toBe(SEASON);
    expect(res.body.recaps).toHaveLength(1);
    const r = res.body.recaps[0];
    expect(r.label).toBe('Week 19');
    expect(r.mvpTeam).toMatchObject({ school: 'Gonzaga', logo: 'gonzaga.png' });
    expect(r.upset).toMatchObject({ kind: 'q1', team: 'Gonzaga', loser: 'Duke', loserRank: 4 });
});

test('holds back a week whose basketball slate has not finished tipping off', async () => {
    await HoopsGame.create([
        hoopsGame({ id: 501, week: 19, startDate: PAST(2), homeTeamId: 1, awayTeamId: 77 }),
        hoopsGame({ id: 502, week: 19, startDate: FUTURE, status: 'scheduled', homePoints: 0, awayPoints: 0, homeTeamId: 2, awayTeamId: 78 })
    ]);
    const ann = await manager('Ann', [1, 2], [{ week: 19, score: 3, scoreByTeam: [{ teamId: 1, gameId: 501, score: 3, quadrant: 3 }] }]);

    const res = await recap(ann._id);

    expect(res.body.recaps).toEqual([]);
});

// The collision itself: team 1 is Gonzaga here and somebody else in football.
// A football game for "team 1" that has not kicked off must not hold a
// basketball week back.
test('never reads the football collections for a basketball roster', async () => {
    await HoopsGame.create(hoopsGame({ id: 501, week: 19, startDate: PAST(1), homeTeamId: 1, awayTeamId: 77, homeTeam: 'Gonzaga', awayTeam: 'Duke' }));
    await Game.create({ id: 501, season: SEASON, week: 19, seasonType: 'regular', startDate: FUTURE, startTimeTbd: false,
        completed: false, neutralSite: false, conferenceGame: false,
        homeId: 1, awayId: 300, homeTeam: 'Football One', awayTeam: 'Football Two' });
    const ann = await manager('Ann', [1], [{ week: 19, score: 2, scoreByTeam: [{ teamId: 1, gameId: 501, score: 2, quadrant: 3 }] }]);

    const res = await recap(ann._id);

    expect(res.body.recaps).toHaveLength(1);
});
