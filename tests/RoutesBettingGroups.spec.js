// HTTP-level tests for routes/betting-groups.js against an in-memory Mongo.
//
// GET / reads one field off each member's active season — franchiseName — and
// used to fetch `seasons: 1`, i.e. EVERY season of every member's user document.
// A user doc is ~103KB across four seasons, so that was 418KB and 4.4s against
// the M0 tier to produce a payload of names. Prod logs showed /betting-groups at
// 4.16s returning a 304 with zero bytes: all of it server-side, computing a body
// it then didn't send. Measured after projecting: 1KB, 75ms.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const BettingGroup = require('../models/bettingGroup');
const User = require('../models/user');
const groupsRouter = require('../routes/betting-groups');

const app = express();
app.use(express.json());
app.use('/betting-groups', groupsRouter);

useMongo();

const SEASON = 2026;

// Four seasons per manager, so a test fails if the route starts hauling them all
// back again — the shape that made this slow in the first place.
async function manager(firstName, franchiseByYear) {
    return User.create({
        firstName, lastName: 'Test', league: 'graham-league',
        avatarUrl: 'http://x/a.png',
        seasons: [2023, 2024, 2025, 2026].map(y => ({
            season: y,
            franchiseName: franchiseByYear[y] || null,
            teams: [],
            weeklyScore: [{ week: 1, score: 10 }]
        }))
    });
}

describe('GET /betting-groups', () => {
    it("answers each member's franchise name for the ACTIVE season", async () => {
        const ann = await manager('Ann', { 2025: 'Old Name', 2026: 'Hogs Gone Wild' });
        const bob = await manager('Bob', { 2026: 'Big Mac' });
        await BettingGroup.create({ active: true, season: SEASON, members: [ann._id, bob._id] });

        const res = await request(app).get('/betting-groups');
        expect(res.status).toBe(200);

        const byName = {};
        res.body.memberDetails.forEach(m => { byName[m.firstName] = m; });
        // 2026's name, not 2025's — the reason the season lookup exists.
        expect(byName.Ann.franchiseName).toBe('Hogs Gone Wild');
        expect(byName.Bob.franchiseName).toBe('Big Mac');
        expect(byName.Ann.avatarUrl).toBe('http://x/a.png');
        expect(byName.Ann.league).toBe('graham-league');
    });

    // The projection is the fix, and it has to be asserted on the QUERY, not the
    // response. The route shapes memberDetails itself, so the response looks
    // identical whether it fetched two season fields or all four seasons of every
    // member — an assertion on the body passes either way and guards nothing.
    // This one fails if anyone restores `seasons: 1` and puts 418KB back on the
    // wire.
    it('asks Mongo for only the two season fields it reads', async () => {
        const ann = await manager('Ann', { 2026: 'Hogs Gone Wild' });
        await BettingGroup.create({ active: true, season: SEASON, members: [ann._id] });

        const spy = jest.spyOn(User, 'find');
        await request(app).get('/betting-groups');

        const projection = spy.mock.calls[0][1];
        expect(projection['seasons.season']).toBe(1);
        expect(projection['seasons.franchiseName']).toBe(1);
        // The whole-subtree fetch must be gone.
        expect(projection.seasons).toBeUndefined();
        spy.mockRestore();
    });

    it('shapes each member down to the five fields the client renders', async () => {
        const ann = await manager('Ann', { 2026: 'Hogs Gone Wild' });
        await BettingGroup.create({ active: true, season: SEASON, members: [ann._id] });

        const res = await request(app).get('/betting-groups');
        const m = res.body.memberDetails[0];
        expect(Object.keys(m).sort()).toEqual(['_id', 'avatarUrl', 'firstName', 'franchiseName', 'league']);
    });

    it('answers null when no group is active', async () => {
        const res = await request(app).get('/betting-groups');
        expect(res.status).toBe(200);
        expect(res.body).toBeNull();
    });

    it('leaves franchiseName null for a manager with no entry for the season', async () => {
        const ann = await manager('Ann', { 2023: 'Ancient History' });
        await BettingGroup.create({ active: true, season: SEASON, members: [ann._id] });

        const res = await request(app).get('/betting-groups');
        expect(res.body.memberDetails[0].franchiseName).toBeNull();
    });
});
