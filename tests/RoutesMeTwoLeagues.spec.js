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
const ScoringConfig = require('../models/scoringConfig');
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

describe('GET /users/me/push counts a roster in ANY league’s own season (#568)', () => {
    // web-push is mocked above; nothing here sends, it only reads state.
    const solo = async (league, season) => {
        const a = await Account.create({ firstName: 'Solo', lastName: 'One', email: 'solo@example.invalid' });
        await Franchise.create({ accountId: a._id, league, seasons: [{ season, teams: [] }] });
        return a;
    };
    let before;
    beforeEach(() => { before = process.env.PUSH_RECIPIENT_IDS; delete process.env.PUSH_RECIPIENT_IDS; });
    afterEach(() => { if (before === undefined) delete process.env.PUSH_RECIPIENT_IDS; else process.env.PUSH_RECIPIENT_IDS = before; });

    test('a basketball-only manager in the 2027 season is allowed', async () => {
        const res = await request(appFor(await solo(HOOPS, BB_SEASON))).get('/users/me/push');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ allowed: true, reason: null });
    });

    test('a two-league account with only a CURRENT basketball entry is allowed', async () => {
        // The football franchise (found first) is a prior season only.
        await Franchise.updateOne({ accountId: account._id, league: FOOTBALL }, { $set: { 'seasons.0.season': FB_SEASON - 1 } });
        const res = await request(app).get('/users/me/push').set('Cookie', cookie(FOOTBALL));
        expect(res.body).toMatchObject({ allowed: true, reason: null });
    });

    test('no roster this season anywhere: not allowed, and the reason says so', async () => {
        const res = await request(appFor(await solo(HOOPS, BB_SEASON - 1))).get('/users/me/push');
        expect(res.body).toMatchObject({ allowed: false, reason: 'no-roster' });
    });

    test('a narrowing allowlist that excludes them is reported as that', async () => {
        process.env.PUSH_RECIPIENT_IDS = '64b1f00000000000000000aa';
        const res = await request(app).get('/users/me/push');
        expect(res.body).toMatchObject({ allowed: false, reason: 'restricted' });
    });
});

describe('basketball alert prefs (#557)', () => {
    const solo = async (league, season) => {
        const a = await Account.create({ firstName: 'Solo', lastName: 'One', email: 'solo@example.invalid' });
        await Franchise.create({ accountId: a._id, league, seasons: [{ season, teams: [] }] });
        return a;
    };

    const sectionsOf = async (a) => (await request(a).get('/users/me/push')).body.sections;
    const captainIn = (league, season, on = true) => ScoringConfig.updateOne({ league },
        { $set: { league, [`engagementBySeason.${season}`]: { captainEnabled: on, captainMultiplier: 2 } } }, { upsert: true });

    test('GET /users/me/push names the sports the account plays', async () => {
        expect(await sectionsOf(app)).toMatchObject({ football: true, basketball: true });
        expect(await sectionsOf(appFor(await solo(FOOTBALL, FB_SEASON)))).toMatchObject({ football: true, basketball: false });
    });

    // Setting the switches up before the draft is the point.
    test('a basketball franchise from a PAST season still counts', async () => {
        expect((await sectionsOf(appFor(await solo(HOOPS, BB_SEASON - 1)))).basketball).toBe(true);
    });

    test('an ARCHIVED league counts for nothing', async () => {
        await League.updateOne({ code: HOOPS }, { $set: { status: 'archived' } });
        expect(await sectionsOf(app)).toMatchObject({ football: true, basketball: false });
    });

    describe('captain: only where a league of theirs plays Captain, in that league\'s season', () => {
        test('no league plays Captain: false', async () => {
            expect((await sectionsOf(app)).captain).toBe(false);
        });

        test('the basketball league plays it in ITS season (2027): true', async () => {
            await captainIn(HOOPS, BB_SEASON);
            expect((await sectionsOf(app)).captain).toBe(true);
        });

        test('Captain on only for a season the league is not in: false', async () => {
            await captainIn(FOOTBALL, BB_SEASON);                       // football is in 2026
            expect((await sectionsOf(app)).captain).toBe(false);
        });

        test('Captain switched off: false', async () => {
            await captainIn(FOOTBALL, FB_SEASON, false);
            expect((await sectionsOf(app)).captain).toBe(false);
        });

        test('an archived Captain league does not count', async () => {
            await captainIn(HOOPS, BB_SEASON);
            await League.updateOne({ code: HOOPS }, { $set: { status: 'archived' } });
            expect((await sectionsOf(app)).captain).toBe(false);
        });

        test('a league they are NOT in playing Captain does not count', async () => {
            await captainIn('someone-elses', FB_SEASON);
            expect((await sectionsOf(app)).captain).toBe(false);
        });
    });

    test('PATCH stores each basketball key, leaving football’s alone', async () => {
        const res = await request(app).patch('/users/me/push/prefs').send({ hoopsCloseGame: false });
        expect(res.status).toBe(200);
        expect(res.body.prefs).toMatchObject({ hoopsCloseGame: false, hoopsTipoff: true, hoopsFinal: true, closeGame: true, final: true });
        await request(app).patch('/users/me/push/prefs').send({ hoopsTipoff: false, hoopsFinal: false });
        const stored = (await Account.findById(account._id).lean()).pushPrefs;
        expect(stored).toMatchObject({ hoopsTipoff: false, hoopsCloseGame: false, hoopsFinal: false, closeGame: true, final: true });
    });

    test('the defaults are on', async () => {
        const res = await request(app).patch('/users/me/push/prefs').send({ score: false });
        expect(res.body.prefs).toMatchObject({ hoopsTipoff: true, hoopsCloseGame: true, hoopsFinal: true });
    });

    test('a non-boolean is refused', async () => {
        expect((await request(app).patch('/users/me/push/prefs').send({ hoopsFinal: 'no' })).status).toBe(400);
    });
});
