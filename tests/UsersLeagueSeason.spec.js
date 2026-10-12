// The league-setup routes read and write the LEAGUE's season (#518).
//
// They used football's for every league. That never showed while only football
// leagues were managed, but from the basketball admin page it meant:
// "Add a Player" put a new basketball manager in football's 2026 instead of
// 2027; Season Roster reported 2026; ticking a manager into "this season"
// added a 2026 entry, and unticking one deleted their 2026 entry and scores.
// A football league's own season is football's, so those are unchanged — the
// last test pins that.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const Franchise = require('../models/franchise');
const seasons = require('../modules/active-season');

useMongo();

const HOOPS = 'hoops-league';
const BALL = 'graham-league';

function app() {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
        const user = { sub: 'auth0|a', user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: 'a' } } };
        req.oidc = { isAuthenticated: () => true, user };
        req.effUser = user;
        next();
    });
    a.use('/users', require('../routes/users'));
    return a;
}

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    await League.create([{ code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' },
                         { code: BALL, name: 'The Polar Depressed', sport: 'football' }]);
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                              { sport: 'basketball', season: 2027, status: 'preseason' }]);
    seasons._reset();
    await seasons.prime();
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

const add = (league, firstName) => request(app()).post('/users')
    .send({ firstName, lastName: 'T', email: `${firstName.toLowerCase()}@example.com`, league });
const seasonsOf = async (league) => ((await Franchise.findOne({ league }).lean()).seasons || []).map(s => Number(s.season));

test('Add a Player puts a basketball manager in the basketball season', async () => {
    expect((await add(HOOPS, 'Ann')).status).toBe(201);
    expect(await seasonsOf(HOOPS)).toEqual([2027]);
});

test('Season Roster reports the basketball season, and who is in it', async () => {
    await add(HOOPS, 'Ann');
    const res = await request(app()).get(`/users/league/${HOOPS}/roster`);
    expect(res.status).toBe(200);
    expect(res.body.season).toBe('2027');
    expect(res.body.players.map(p => p.inSeason)).toEqual([true]);
});

test('unticking and re-ticking a basketball manager touches only the basketball season', async () => {
    const id = (await add(HOOPS, 'Ann')).body._id;
    const f = await Franchise.findOne({ league: HOOPS });
    f.seasons.push({ season: 2026 });       // an older entry that must survive
    await f.save();

    const off = await request(app()).post(`/users/${id}/season-membership`).send({ included: false });
    expect(off.body).toEqual({ inSeason: false });
    expect(await seasonsOf(HOOPS)).toEqual([2026]);

    const on = await request(app()).post(`/users/${id}/season-membership`).send({ included: true });
    expect(on.body).toEqual({ inSeason: true });
    expect((await seasonsOf(HOOPS)).sort()).toEqual([2026, 2027]);
});

test('a football league is unchanged: football season throughout', async () => {
    await add(BALL, 'Bo');
    expect(await seasonsOf(BALL)).toEqual([2026]);
    const res = await request(app()).get(`/users/league/${BALL}/roster`);
    expect(res.body.season).toBe('2026');
});
