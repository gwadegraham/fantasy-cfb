// The self-scoped /users/me routes for a person who plays BOTH sports.
//
// One account, a football franchise (2026) and a basketball franchise (2027 —
// basketball seasons are numbered by their ending year). The football
// franchise is created first so an unscoped Franchise.findOne({ accountId })
// hands it back, and football's active season is not basketball's: either
// bug — the wrong document or the wrong year — shows here as a name that
// lands in the wrong league or not at all.

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const usersRouter = require('../routes/users');

useMongo();

const HOOPS = 'hoops-league';
const FOOTBALL = 'graham-league';
const FB_SEASON = 2026;
const BB_SEASON = 2027;

let account, app;
const cookie = (league) => `cc_league=${league}`;

function appFor(acct) {
    const a = express();
    a.use(express.json());
    a.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles: [], metadata: { league: 'gg', userId: String(acct._id) } } } };
        next();
    });
    a.use('/users', usersRouter);
    return a;
}

const nameIn = async (league, season) => {
    const f = await Franchise.findOne({ accountId: account._id, league }).lean();
    const s = f.seasons.find(x => Number(x.season) === season);
    return s && s.franchiseName;
};

beforeEach(async () => {
    await League.create([
        { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' },
        { code: FOOTBALL, name: 'Graham League', sport: 'football' }
    ]);
    await SportSeason.create([
        { sport: 'football', season: FB_SEASON, status: 'in-season' },
        { sport: 'basketball', season: BB_SEASON, status: 'in-season' }
    ]);
    await seasons.prime();

    account = await Account.create({ firstName: 'Ann', lastName: 'Two', email: 'ann@example.invalid' });
    // Football FIRST: the document an unscoped findOne returns.
    await Franchise.create({ accountId: account._id, league: FOOTBALL,
        seasons: [{ season: FB_SEASON, franchiseName: 'Gridiron Name', teams: [] }] });
    await Franchise.create({ accountId: account._id, league: HOOPS,
        seasons: [{ season: BB_SEASON, franchiseName: 'Hoops Name', teamRefs: [{ id: 1, sport: 'basketball' }] }] });
    app = appFor(account);
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('PATCH /users/me/profile names the VIEWED league’s franchise (#565)', () => {
    test('viewing basketball renames the basketball franchise’s 2027 entry, not football’s', async () => {
        const res = await request(app).patch('/users/me/profile').set('Cookie', cookie(HOOPS))
            .send({ franchiseName: 'Bracket Busters' });
        expect(res.status).toBe(200);
        expect(res.body.franchiseName).toBe('Bracket Busters');
        expect(await nameIn(HOOPS, BB_SEASON)).toBe('Bracket Busters');
        expect(await nameIn(FOOTBALL, FB_SEASON)).toBe('Gridiron Name');
    });

    test('viewing football still renames football’s 2026 entry', async () => {
        const res = await request(app).patch('/users/me/profile').set('Cookie', cookie(FOOTBALL))
            .send({ franchiseName: 'Saturday Crew' });
        expect(res.status).toBe(200);
        expect(res.body.franchiseName).toBe('Saturday Crew');
        expect(await nameIn(FOOTBALL, FB_SEASON)).toBe('Saturday Crew');
        expect(await nameIn(HOOPS, BB_SEASON)).toBe('Hoops Name');
    });
});
