// Profile pictures are per LEAGUE. One account, a football franchise and a
// basketball franchise; most people who play both use a team logo, so the
// picture has to follow the league being viewed, the same way the franchise
// name already does (#565).
//
// The rule under test:
//   - a franchise with no avatarUrl INHERITS the account's;
//   - a franchise with one (null included) shows its own;
//   - changing it while viewing one league never moves it in another.
//
// Football is created first so an unscoped findOne returns it — a read that
// forgets the league shows up here as the football logo on a basketball page.

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const repo = require('../modules/franchise-repo');
const usersRouter = require('../routes/users');

useMongo();

const HOOPS = 'hoops-league';
const FOOTBALL = 'graham-league';
const FB_SEASON = 2026;
const BB_SEASON = 2027;
const CLOUD = 'testcloud';
const pic = (name) => `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${name}.png`;
const OLD = pic('old-logo');

const ORIGINAL_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
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

const patch = (league, body) => request(app).patch('/users/me/profile').set('Cookie', cookie(league)).send(body);
const shownIn = async (league) => (await repo.byAccountId(account._id, { league })).avatarUrl;

beforeEach(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    await League.create([
        { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' },
        { code: FOOTBALL, name: 'Graham League', sport: 'football' }
    ]);
    await SportSeason.create([
        { sport: 'football', season: FB_SEASON, status: 'in-season' },
        { sport: 'basketball', season: BB_SEASON, status: 'in-season' }
    ]);
    await seasons.prime();

    // Today's data: one account-level picture, no franchise has its own.
    account = await Account.create({ firstName: 'Ann', lastName: 'Two', email: 'ann@example.invalid', avatarUrl: OLD });
    await Franchise.create({ accountId: account._id, league: FOOTBALL,
        seasons: [{ season: FB_SEASON, franchiseName: 'Gridiron Name', teams: [] }] });
    await Franchise.create({ accountId: account._id, league: HOOPS,
        seasons: [{ season: BB_SEASON, franchiseName: 'Hoops Name', teamRefs: [{ id: 1, sport: 'basketball' }] }] });
    app = appFor(account);
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    seasons._reset();
    jest.restoreAllMocks();
    if (ORIGINAL_CLOUD === undefined) delete process.env.CLOUDINARY_CLOUD_NAME; else process.env.CLOUDINARY_CLOUD_NAME = ORIGINAL_CLOUD;
});

describe('existing data needs no migration', () => {
    test('a franchise with no picture of its own shows the account’s, in both leagues', async () => {
        expect(await shownIn(FOOTBALL)).toBe(OLD);
        expect(await shownIn(HOOPS)).toBe(OLD);
    });
});

describe('PATCH /users/me/profile sets the VIEWED league’s picture', () => {
    test('changing it in basketball leaves football showing the old one', async () => {
        const res = await patch(HOOPS, { avatarUrl: pic('hoops') });
        expect(res.status).toBe(200);
        expect(res.body.avatarUrl).toBe(pic('hoops'));

        expect(await shownIn(HOOPS)).toBe(pic('hoops'));
        expect(await shownIn(FOOTBALL)).toBe(OLD);
    });

    test('football is PINNED at what it showed, so the account can move on', async () => {
        await patch(HOOPS, { avatarUrl: pic('hoops') });
        // The account holds the latest choice — what a league joined later starts with.
        expect((await Account.findById(account._id).lean()).avatarUrl).toBe(pic('hoops'));
        // Without the pin, football would inherit that and change too.
        const fb = await Franchise.findOne({ accountId: account._id, league: FOOTBALL }).lean();
        expect(fb.avatarUrl).toBe(OLD);
    });

    test('a second change, in football, does not touch basketball', async () => {
        await patch(HOOPS, { avatarUrl: pic('hoops') });
        await patch(FOOTBALL, { avatarUrl: pic('football') });
        expect(await shownIn(FOOTBALL)).toBe(pic('football'));
        expect(await shownIn(HOOPS)).toBe(pic('hoops'));
    });

    test('removing it in one league means NO picture there, not the account’s', async () => {
        const res = await patch(HOOPS, { avatarUrl: '' });
        expect(res.status).toBe(200);
        expect(res.body.avatarUrl).toBeNull();
        expect(await shownIn(HOOPS)).toBeNull();
        expect(await shownIn(FOOTBALL)).toBe(OLD);
        // Stored as null on the franchise, not merely inherited from an
        // account that is also null now.
        const raw = await Franchise.findOne({ accountId: account._id, league: HOOPS }).lean();
        expect(raw).toHaveProperty('avatarUrl', null);
    });

    test('a league that already chose is never re-pinned by changes elsewhere', async () => {
        // Two football changes: by the second, the account holds football's
        // first picture, so a pin that overwrote a choice would hand basketball
        // a FOOTBALL logo. Only "pin what has no choice yet" keeps it at none.
        await patch(HOOPS, { avatarUrl: '' });
        await patch(FOOTBALL, { avatarUrl: pic('football-1') });
        await patch(FOOTBALL, { avatarUrl: pic('football-2') });
        expect(await shownIn(HOOPS)).toBeNull();
    });

    test('an account with no picture yet pins its other league at none', async () => {
        await Account.updateOne({ _id: account._id }, { $unset: { avatarUrl: 1 } });
        await patch(FOOTBALL, { avatarUrl: pic('football') });
        expect(await shownIn(FOOTBALL)).toBe(pic('football'));
        expect(await shownIn(HOOPS)).toBeNull();
    });
});

describe('viewing a league with no franchise in it (an Admin can)', () => {
    test('the change becomes the account default and moves NO league', async () => {
        await League.create({ code: 'claunts-league', name: 'Claunts', sport: 'football' });
        const admin = express();
        admin.use(express.json());
        admin.use((req, res, next) => {
            req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: String(account._id) } } } };
            next();
        });
        admin.use('/users', usersRouter);
        const res = await request(admin).patch('/users/me/profile').set('Cookie', cookie('claunts-league'))
            .send({ avatarUrl: pic('elsewhere') });
        expect(res.status).toBe(200);
        expect((await Account.findById(account._id).lean()).avatarUrl).toBe(pic('elsewhere'));
        expect(await shownIn(FOOTBALL)).toBe(OLD);
        expect(await shownIn(HOOPS)).toBe(OLD);
    });
});

describe('every read path resolves the league’s picture', () => {
    // Each of these projects differently. A projection that leaves the
    // franchise's avatarUrl out does not fail — it shows the account's, which
    // looks right and is the wrong league's.
    beforeEach(async () => {
        await patch(HOOPS, { avatarUrl: pic('hoops') });
        // A THIRD value on the account, so a read that never reaches the
        // franchise shows 'account' rather than happening to match.
        await Account.updateOne({ _id: account._id }, { $set: { avatarUrl: pic('account') } });
    });

    test('byLeagueAndSeason, default projection', async () => {
        const [hoops] = await repo.byLeagueAndSeason(HOOPS, BB_SEASON);
        const [fb] = await repo.byLeagueAndSeason(FOOTBALL, FB_SEASON);
        expect(hoops.avatarUrl).toBe(pic('hoops'));
        expect(fb.avatarUrl).toBe(OLD);
    });

    test('byLeagueAndSeason, with named fields', async () => {
        const [hoops] = await repo.byLeagueAndSeason(HOOPS, BB_SEASON, { fields: ['firstName', 'avatarUrl', 'seasons'] });
        expect(hoops.avatarUrl).toBe(pic('hoops'));
    });

    test('byAccountId asking only for account-side fields', async () => {
        // The navbar's read: avatarUrl is the only field that reaches the franchise.
        const u = await repo.byAccountId(account._id, { league: HOOPS, fields: ['avatarUrl', 'firstName'] });
        expect(u.avatarUrl).toBe(pic('hoops'));
    });

    test('byLeague and byIds', async () => {
        const [byLeague] = await repo.byLeague(HOOPS, { fields: ['avatarUrl'] });
        expect(byLeague.avatarUrl).toBe(pic('hoops'));
        const both = await repo.byIds([account._id], { fields: ['avatarUrl', 'league'] });
        expect(Object.fromEntries(both.map(u => [u.league, u.avatarUrl])))
            .toEqual({ [HOOPS]: pic('hoops'), [FOOTBALL]: OLD });
    });

    test('the standings projection aggregate', async () => {
        const [hoops] = await repo.projectionManagers(HOOPS, BB_SEASON);
        const [fb] = await repo.projectionManagers(FOOTBALL, FB_SEASON);
        expect(hoops.avatarUrl).toBe(pic('hoops'));
        expect(fb.avatarUrl).toBe(OLD);
    });

    test('the aggregate inherits when the franchise has none of its own', async () => {
        // Football was pinned at OLD; un-pin it and the account's shows.
        await Franchise.updateOne({ accountId: account._id, league: FOOTBALL }, { $unset: { avatarUrl: 1 } });
        const [fb] = await repo.projectionManagers(FOOTBALL, FB_SEASON);
        expect(fb.avatarUrl).toBe(pic('account'));
    });

    test('the aggregate keeps a stored null over the account’s picture', async () => {
        await Franchise.updateOne({ accountId: account._id, league: HOOPS }, { $set: { avatarUrl: null } });
        const [hoops] = await repo.projectionManagers(HOOPS, BB_SEASON);
        expect(hoops.avatarUrl).toBeNull();
    });
});
