// PATCH /users/draft/:id — the endpoint every draft pick is written through
// (modules/draft-socket.js persists each pick with it).
//
// It had NO test coverage at all, on either flag, which is how the bug below
// survived a green 2687-test suite: #313 phase 3 rewrote this handler and its
// middleware, and nothing exercised either.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const migration = require('../modules/account-migration');
const usersRouter = require('../routes/users');

const SEASON = 2026;
const LEAGUE = 'graham-league';

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

useMongo();

const ORIGINAL = process.env.FRANCHISE_READS;
beforeEach(() => {
    delete process.env.FRANCHISE_READS;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL === undefined) delete process.env.FRANCHISE_READS;
    else process.env.FRANCHISE_READS = ORIGINAL;
});

const LOC = { venue_id: 7, name: 'Autzen', city: 'Eugene', state: 'OR', zip: '97401',
              latitude: 44, longitude: -123, capacity: 54000, grass: true, dome: false };
const team = (id, school) => ({
    id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'Big Ten', color: '#154733', logos: ['a.png'], location: LOC
});

async function seed(seasons) {
    const user = await User.create({
        firstName: 'Ann', lastName: 'Lee', league: LEAGUE, color: '#71D28D',
        seasons: seasons || [{ season: SEASON, franchiseName: 'Keep Me', cumulativeScore: 12, teams: [] }]
    });
    await migration.migrate({ apply: true });
    return user;
}

const strip = (v) => JSON.parse(JSON.stringify(v, (k, val) => (k === '_id' || k === '__v' ? undefined : val)));

describe('PATCH /users/draft/:id', () => {
    test.each([['false'], ['true']])('writes the drafted teams into an existing season, flag %s', async (flag) => {
        const user = await seed();
        process.env.FRANCHISE_READS = flag;

        const res = await request(app).patch(`/users/draft/${user._id}`)
            .send({ season: SEASON, teams: [team(1, 'Iowa'), team(2, 'Duke')] });

        expect(res.status).toBe(200);
        const back = await require('../modules/franchise-repo').byAccountId(user._id);
        const s = back.seasons.find(x => Number(x.season) === SEASON);
        expect(s.teams.map(t => t.school)).toEqual(['Iowa', 'Duke']);
        // The merge, not an overwrite: the rest of the season survives.
        expect(s.franchiseName).toBe('Keep Me');
        expect(s.cumulativeScore).toBe(12);
    });

    test.each([['false'], ['true']])('pushes a season the manager did not have, flag %s', async (flag) => {
        const user = await seed([{ season: 2025, franchiseName: 'Last Year', teams: [] }]);
        process.env.FRANCHISE_READS = flag;

        const res = await request(app).patch(`/users/draft/${user._id}`)
            .send({ season: SEASON, teams: [team(1, 'Iowa')] });

        expect(res.status).toBe(200);
        const back = await require('../modules/franchise-repo').byAccountId(user._id);
        expect(back.seasons.map(x => Number(x.season)).sort()).toEqual([2025, SEASON]);
    });

    test('the response is the same shape on both flags', async () => {
        const bodies = {};
        for (const flag of ['false', 'true']) {
            const user = await seed();
            process.env.FRANCHISE_READS = flag;
            const res = await request(app).patch(`/users/draft/${user._id}`)
                .send({ season: SEASON, teams: [team(1, 'Iowa')] });
            bodies[flag] = strip(res.body);
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
        expect(bodies.true).toEqual(bodies.false);
    });

    test('an unknown id is 404 on both flags', async () => {
        const ghost = new mongoose.Types.ObjectId();
        for (const flag of ['false', 'true']) {
            process.env.FRANCHISE_READS = flag;
            const res = await request(app).patch(`/users/draft/${ghost}`).send({ season: SEASON, teams: [] });
            expect(res.status).toBe(404);
        }
    });

    // The bug this file was written for.
    //
    // getUser passes a season, so loadForWrite returns null when there is no
    // matching entry and the middleware 404s. getUserNewSeason deliberately
    // passes none — so an account with no franchise comes back as
    // { account, franchise: null }, which is NOT null, the guard lets it past,
    // and `res.user.lastUpdated = …` on the handler's first line throws OUTSIDE
    // its try/catch. An async handler throwing there sends no response at all:
    // the request hangs until the client gives up.
    //
    // Zero franchises is a normal state by design once Hardwood ships, and this
    // endpoint is where every draft pick is written — so the pick never lands
    // and the draft room waits on a promise that never settles.
    test('an account with NO franchise is 404, not a hung request', async () => {
        const account = await Account.create({ firstName: 'Hoops', lastName: 'Only', color: '#fff' });
        process.env.FRANCHISE_READS = 'true';

        const res = await request(app).patch(`/users/draft/${account._id}`)
            .send({ season: SEASON, teams: [team(1, 'Iowa')] });

        expect(res.status).toBe(404);
    });
});
