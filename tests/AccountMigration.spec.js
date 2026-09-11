// Coverage for modules/account-migration.js — the User -> Account + Franchise
// split (#313).
//
// This is the riskiest change in the epic: it runs against a live season, and
// the failure modes are quiet. So the tests are weighted towards the things
// that would be silently catastrophic rather than towards happy-path counts.
//
// The one that matters most is _id preservation. An Auth0 login resolves
// through `user_metadata.metadata.userId`, and that value IS a users `_id`
// (modules/identity-guard.js). Mint a new one for the Account and every
// existing login stops resolving — with no error, because the lookup simply
// finds nothing.

const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const migration = require('../modules/account-migration');

useMongo();

// A manager as they actually exist: person-level fields plus a season carrying
// a roster and scored weeks.
async function seedUser(overrides = {}) {
    return User.create(Object.assign({
        firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com',
        league: 'graham-league', color: '#ED5858', authSub: 'google-oauth2|123',
        avatarUrl: 'https://example.com/a.jpg', profilePrompted: true,
        isUpdated: true, lastUpdated: '9/7/2026, 11:42:28 PM',
        seasons: [{
            season: 2026,
            franchiseName: 'Name, Image, & Sadness',
            draftPosition: 3,
            cumulativeScore: 8,
            weeklyScore: [{ week: 1, score: 8, season: 'regular', scoreByTeam: [{ teamId: 251, gameId: 1, score: 8 }] }],
            captains: [{ week: 1, teamId: 251 }]
        }]
    }, overrides));
}

describe('dry run', () => {
    test('reports what it would do and writes nothing', async () => {
        await seedUser();
        const result = await migration.migrate();

        expect(result.applied).toBe(false);
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]).toMatchObject({
            name: 'Garrett Graham', league: 'graham-league',
            accountAction: 'create', franchiseAction: 'create', seasons: [2026]
        });
        // The point of a dry run.
        expect(await Account.countDocuments({})).toBe(0);
        expect(await Franchise.countDocuments({})).toBe(0);
    });

    test('reports a user with no league as a problem rather than inventing one', async () => {
        await seedUser({ league: undefined });
        const result = await migration.migrate();
        expect(result.problems).toHaveLength(1);
        expect(result.problems[0]).toMatch(/has no league/);
        expect(result.steps[0].franchiseAction).toBe('skip');
    });

    test('says "update" for work already done', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        const again = await migration.plan();
        expect(again.steps[0]).toMatchObject({ accountAction: 'update', franchiseAction: 'update' });
    });
});

describe('the _id rule', () => {
    test('the Account keeps the User\'s _id, because Auth0 points at it', async () => {
        const user = await seedUser();
        await migration.migrate({ apply: true });

        const account = await Account.findById(user._id).lean();
        expect(account).not.toBeNull();
        expect(String(account._id)).toBe(String(user._id));
    });

    test('the Franchise gets its own _id and references the account', async () => {
        const user = await seedUser();
        await migration.migrate({ apply: true });

        const franchise = await Franchise.findOne({ accountId: user._id }).lean();
        expect(String(franchise.accountId)).toBe(String(user._id));
        // Nothing external points at a franchise, so its own id is free.
        expect(String(franchise._id)).not.toBe(String(user._id));
    });
});

describe('what moves where', () => {
    test('person-level fields land on the Account', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        const account = await Account.findOne({}).lean();

        expect(account).toMatchObject({
            firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com',
            color: '#ED5858', authSub: 'google-oauth2|123', profilePrompted: true
        });
        // League membership is emphatically NOT a property of the person — that
        // is the whole point of the split.
        expect(account.league).toBeUndefined();
        expect(account.seasons).toBeUndefined();
    });

    test('league-scoped state lands on the Franchise, intact', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        const franchise = await Franchise.findOne({}).lean();

        expect(franchise.league).toBe('graham-league');
        expect(franchise.isUpdated).toBe(true);
        expect(franchise.lastUpdated).toBe('9/7/2026, 11:42:28 PM');

        const season = franchise.seasons[0];
        expect(season.season).toBe(2026);
        expect(season.franchiseName).toBe('Name, Image, & Sadness');
        expect(season.draftPosition).toBe(3);
        expect(season.cumulativeScore).toBe(8);
        // The scores themselves are what must survive byte-identical.
        expect(season.weeklyScore[0].scoreByTeam[0]).toMatchObject({ teamId: 251, gameId: 1, score: 8 });
        expect(season.captains[0]).toMatchObject({ week: 1, teamId: 251 });
    });

    test('every season comes across, not just the active one', async () => {
        await seedUser({ seasons: [{ season: 2023 }, { season: 2024 }, { season: 2025 }, { season: 2026 }] });
        await migration.migrate({ apply: true });
        const franchise = await Franchise.findOne({}).lean();
        expect(franchise.seasons.map(s => s.season)).toEqual([2023, 2024, 2025, 2026]);
    });
});

describe('idempotency', () => {
    test('re-running does not duplicate a franchise', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        await migration.migrate({ apply: true });
        await migration.migrate({ apply: true });

        expect(await Account.countDocuments({})).toBe(1);
        expect(await Franchise.countDocuments({})).toBe(1);
    });

    test('a half-finished run is safe to repeat', async () => {
        const a = await seedUser();
        const b = await seedUser({ firstName: 'Brock', lastName: 'McCord', email: 'b@example.com' });
        // As if the first run died after one user.
        await Account.updateOne({ _id: a._id }, { $set: migration.accountFrom(a.toObject()) }, { upsert: true });

        await migration.migrate({ apply: true });
        expect(await Account.countDocuments({})).toBe(2);
        expect(await Franchise.countDocuments({})).toBe(2);
        expect(await Franchise.countDocuments({ accountId: b._id })).toBe(1);
    });
});

describe('verify', () => {
    test('passes on a clean migration', async () => {
        await seedUser();
        await seedUser({ firstName: 'Jeff', lastName: 'Claunts', league: 'claunts-league', email: 'j@example.com' });
        await migration.migrate({ apply: true });

        const v = await migration.verify();
        expect(v.ok).toBe(true);
        expect(v.mismatches).toEqual([]);
        expect(v).toMatchObject({ users: 2, accountCount: 2, franchiseCount: 2 });
    });

    test('catches a missing account', async () => {
        const user = await seedUser();
        await migration.migrate({ apply: true });
        await Account.deleteOne({ _id: user._id });

        const v = await migration.verify();
        expect(v.ok).toBe(false);
        expect(v.mismatches).toContainEqual(expect.objectContaining({ field: 'account', reason: 'missing' }));
    });

    test('catches a changed person-level field', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        await Account.updateOne({}, { $set: { firstName: 'Wrong' } });

        const v = await migration.verify();
        expect(v.ok).toBe(false);
        expect(v.mismatches).toContainEqual(
            expect.objectContaining({ field: 'firstName', expected: 'Garrett', actual: 'Wrong' })
        );
    });

    test('catches a score that changed in transit — the thing that would move standings', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        await Franchise.updateOne({}, { $set: { 'seasons.0.weeklyScore.0.score': 99 } });

        const v = await migration.verify();
        expect(v.ok).toBe(false);
        const seasonMismatch = v.mismatches.find(m => m.field === 'seasons');
        expect(seasonMismatch.reason).toMatch(/2026/);
    });

    test('catches a dropped season', async () => {
        await seedUser({ seasons: [{ season: 2025 }, { season: 2026 }] });
        await migration.migrate({ apply: true });
        await Franchise.updateOne({}, { $pop: { seasons: 1 } });

        const v = await migration.verify();
        expect(v.ok).toBe(false);
        expect(v.mismatches.find(m => m.field === 'seasons').reason).toMatch(/season count 2 -> 1/);
    });

    test('catches a franchise nothing accounts for', async () => {
        const user = await seedUser();
        await migration.migrate({ apply: true });
        await Franchise.create({ accountId: user._id, league: 'claunts-league', seasons: [] });

        const v = await migration.verify();
        expect(v.ok).toBe(false);
        expect(v.mismatches).toContainEqual(
            expect.objectContaining({ field: 'franchiseCount', expected: 1, actual: 2 })
        );
    });

    test('is insensitive to subdocument ids either way', async () => {
        // As written, the migration copies the lean season objects wholesale, so
        // the subdoc _ids actually carry over unchanged — better than assumed.
        // verify() strips them anyway: they are referenced nowhere, and a
        // comparison that counted them would start failing the day a copy path
        // re-mints them (a $set of a plain object, say, or a schema change).
        await seedUser();
        await migration.migrate({ apply: true });
        const user = await User.findOne({}).lean();
        const franchise = await Franchise.findOne({}).lean();
        expect(String(franchise.seasons[0]._id)).toBe(String(user.seasons[0]._id));

        // Force the divergence and confirm verify() still passes.
        await Franchise.updateOne({}, { $set: { 'seasons.0._id': new (require('mongoose').Types.ObjectId)() } });
        expect((await migration.verify()).ok).toBe(true);
    });
});

describe('rollback', () => {
    test('dry run reports without deleting', async () => {
        await seedUser();
        await migration.migrate({ apply: true });

        const r = await migration.rollback();
        expect(r).toMatchObject({ applied: false, wouldDelete: { accounts: 1, franchises: 1 } });
        expect(await Account.countDocuments({})).toBe(1);
    });

    test('removes what it created and leaves users untouched', async () => {
        await seedUser();
        const before = await User.find({}).lean();
        await migration.migrate({ apply: true });
        await migration.rollback({ apply: true });

        expect(await Account.countDocuments({})).toBe(0);
        expect(await Franchise.countDocuments({})).toBe(0);
        // The property that makes this reversible at all.
        expect(await User.find({}).lean()).toEqual(before);
    });

    test('a migrate after a rollback is clean', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        await migration.rollback({ apply: true });
        await migration.migrate({ apply: true });
        expect((await migration.verify()).ok).toBe(true);
    });
});
