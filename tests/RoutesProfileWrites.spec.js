// PATCH /users/me/profile and PATCH /users/me/push/prefs, across both positions
// of FRANCHISE_READS (#313 phase 3).
//
// The profile route is the ONLY handler in the app that writes to both new
// documents: the avatar and the prompt flag belong to the person, the franchise
// name belongs to their entry in one league. It had no HTTP coverage at all —
// tests/ProfileUpdate.spec.js is a pure-unit test of the sanitizer and never
// reaches the route.
//
// That gap was found by sabotage, not by reading: routing franchiseName to the
// ACCOUNT, and pushPrefs to the FRANCHISE, each passed all 97 tests in the four
// specs that touch these paths. They pass because every other test runs with the
// flag unset, where the two documents are one and a misrouted field is invisible
// — the same hole that hid the push-ledger misrouting.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const migration = require('../modules/account-migration');
const usersRouter = require('../routes/users');

const SEASON = 2026;
const LEAGUE = 'graham-league';
const CLOUD = 'testcloud';

useMongo();

const ORIGINAL_FLAG = process.env.FRANCHISE_READS;
const ORIGINAL_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;

let sessionId = null;
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    req.oidc = { isAuthenticated: () => !!sessionId,
                 user: { user_metadata: { metadata: { userId: sessionId && String(sessionId) } } } };
    next();
});
app.use('/users', usersRouter);

beforeEach(async () => {
    delete process.env.FRANCHISE_READS;
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    activeSeason._reset();
    await SportSeason.create({ sport: 'football', season: SEASON, status: 'in-season' });
    await activeSeason.prime();
});
afterEach(() => {
    jest.restoreAllMocks();
    sessionId = null;
    if (ORIGINAL_FLAG === undefined) delete process.env.FRANCHISE_READS; else process.env.FRANCHISE_READS = ORIGINAL_FLAG;
    if (ORIGINAL_CLOUD === undefined) delete process.env.CLOUDINARY_CLOUD_NAME; else process.env.CLOUDINARY_CLOUD_NAME = ORIGINAL_CLOUD;
});

async function seed() {
    const user = await User.create({
        firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com',
        league: LEAGUE, color: '#ED5858',
        pushPrefs: { score: true, final: false },
        seasons: [
            { season: 2025, franchiseName: 'Last Year' },
            { season: SEASON, franchiseName: 'Old Name', cumulativeScore: 34 }
        ]
    });
    await migration.migrate({ apply: true });
    sessionId = user._id;
    return user;
}

const AVATAR = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/abc.png`;

describe('PATCH /users/me/profile — the one handler that writes both documents', () => {
    test.each([['false'], ['true']])('the response is the same with the flag %s', async (flag) => {
        await seed();
        process.env.FRANCHISE_READS = flag;
        const res = await request(app).patch('/users/me/profile')
            .send({ franchiseName: 'New Name', prompted: true, avatarUrl: AVATAR });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ avatarUrl: AVATAR, profilePrompted: true, franchiseName: 'New Name' });
    });

    test('flag ON puts the avatar on the ACCOUNT and the name on the FRANCHISE', async () => {
        const user = await seed();
        process.env.FRANCHISE_READS = 'true';
        await request(app).patch('/users/me/profile')
            .send({ franchiseName: 'New Name', prompted: true, avatarUrl: AVATAR });

        const account = await Account.findById(user._id).lean();
        const franchise = await Franchise.findOne({ accountId: user._id }).lean();

        expect(account.avatarUrl).toBe(AVATAR);
        expect(account.profilePrompted).toBe(true);
        // The name is NOT on the account — routing it there is silent under the
        // flag-off path and was caught by nothing before this test existed.
        expect(account.seasons).toBeUndefined();
        expect(franchise.seasons.find(s => Number(s.season) === SEASON).franchiseName).toBe('New Name');
        expect(franchise.avatarUrl).toBeUndefined();

        // And `users` is untouched, so the two really are separate collections.
        const stale = await User.findById(user._id).lean();
        expect(stale.avatarUrl).toBeUndefined();
        expect(stale.seasons.find(s => Number(s.season) === SEASON).franchiseName).toBe('Old Name');
    });

    test('only the ACTIVE season is renamed, on both positions', async () => {
        for (const flag of ['false', 'true']) {
            const user = await seed();
            process.env.FRANCHISE_READS = flag;
            await request(app).patch('/users/me/profile').send({ franchiseName: 'Renamed' });

            const back = await require('../modules/franchise-repo').byAccountId(user._id);
            expect(back.seasons.find(s => Number(s.season) === SEASON).franchiseName).toBe('Renamed');
            expect(back.seasons.find(s => Number(s.season) === 2025).franchiseName).toBe('Last Year');

            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
            await SportSeason.deleteMany({}); activeSeason._reset();
            await SportSeason.create({ sport: 'football', season: SEASON, status: 'in-season' });
            await activeSeason.prime();
        }
    });

    test('a partial update leaves the other document alone', async () => {
        const user = await seed();
        process.env.FRANCHISE_READS = 'true';
        await request(app).patch('/users/me/profile').send({ prompted: true });
        const franchise = await Franchise.findOne({ accountId: user._id }).lean();
        expect(franchise.seasons.find(s => Number(s.season) === SEASON).franchiseName).toBe('Old Name');
        expect((await Account.findById(user._id).lean()).profilePrompted).toBe(true);
    });

    test('an unknown session is 404, not a 500, on both positions', async () => {
        for (const flag of ['false', 'true']) {
            await seed();
            sessionId = new (require('mongoose').Types.ObjectId)();
            process.env.FRANCHISE_READS = flag;
            const res = await request(app).patch('/users/me/profile').send({ prompted: true });
            expect(res.status).toBe(404);
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
    });
});

describe('PATCH /users/me/push/prefs — account-side', () => {
    test.each([['false'], ['true']])('the response is the same with the flag %s', async (flag) => {
        await seed();
        process.env.FRANCHISE_READS = flag;
        const res = await request(app).patch('/users/me/push/prefs').send({ closeGame: false });
        expect(res.status).toBe(200);
        expect(res.body.prefs).toMatchObject({ score: true, final: false, closeGame: false });
    });

    test('flag ON writes the prefs to the ACCOUNT, not the franchise', async () => {
        // Alert preferences follow the person across leagues. On the franchise
        // they would silently reset when a second sport is added, and the
        // flag-off path cannot tell the difference.
        const user = await seed();
        process.env.FRANCHISE_READS = 'true';
        await request(app).patch('/users/me/push/prefs').send({ closeGame: false });

        expect((await Account.findById(user._id).lean()).pushPrefs.closeGame).toBe(false);
        expect((await Franchise.findOne({ accountId: user._id }).lean()).pushPrefs).toBeUndefined();
    });

    test('a partial update keeps the keys it was not sent', async () => {
        const user = await seed();
        process.env.FRANCHISE_READS = 'true';
        await request(app).patch('/users/me/push/prefs').send({ closeGame: false });
        const prefs = (await Account.findById(user._id).lean()).pushPrefs;
        expect(prefs.final).toBe(false);   // seeded, not sent
        expect(prefs.score).toBe(true);    // seeded, not sent
    });
});
