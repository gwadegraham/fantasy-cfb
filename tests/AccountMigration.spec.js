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
        pushSubscriptions: [{ endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' }, userAgent: 'iPhone' }],
        pushPrefs: { score: true, final: false, captainLockLeadMinutes: 60 },
        captainReminders: [{ season: 2026, week: 1, sentAt: new Date('2026-09-05T12:00:00Z') }],
        recapNotices: [{ season: 2026, week: 1, sentAt: new Date('2026-09-08T12:00:00Z') }],
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

    test('devices and alert preferences follow the PERSON', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        const account = await Account.findOne({}).lean();

        expect(account.pushSubscriptions).toHaveLength(1);
        expect(account.pushSubscriptions[0]).toMatchObject({ endpoint: 'https://push.example/abc', userAgent: 'iPhone' });
        expect(account.pushSubscriptions[0].keys).toMatchObject({ p256dh: 'k', auth: 'a' });
        expect(account.pushPrefs).toMatchObject({ score: true, final: false, captainLockLeadMinutes: 60 });
        // A device is not a property of a league entry.
        expect(account.captainReminders).toBeUndefined();
    });

    test('the "already sent" ledgers follow the LEAGUE entry', async () => {
        // modules/push-notify.js dedupes on {season, week} with NO league in the
        // key. Shared across leagues, a football recap notice would silence the
        // basketball one for the same week.
        await seedUser();
        await migration.migrate({ apply: true });
        const franchise = await Franchise.findOne({}).lean();

        expect(franchise.captainReminders).toHaveLength(1);
        expect(franchise.captainReminders[0]).toMatchObject({ season: 2026, week: 1 });
        expect(franchise.recapNotices).toHaveLength(1);
        expect(franchise.pushSubscriptions).toBeUndefined();
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

    test('catches a MIGRATED franchise that no user accounts for', async () => {
        const user = await seedUser();
        await migration.migrate({ apply: true });
        // Carries the provenance stamp, so it claims to have come from a user.
        await Franchise.create({
            accountId: user._id, league: 'claunts-league', seasons: [], migratedFrom: user._id
        });

        const v = await migration.verify();
        expect(v.ok).toBe(false);
        expect(v.mismatches).toContainEqual(
            expect.objectContaining({ field: 'franchiseCount', expected: 1, actual: 2 })
        );
    });

    test('treats a franchise created OUTSIDE the migration as a warning, not a fault', async () => {
        // After phase 2 this is the normal case: a basketball-only manager with
        // no User behind them. Counting it as a failure would make verify red
        // forever — which is precisely the end state this epic is driving at.
        const user = await seedUser();
        await migration.migrate({ apply: true });
        await Franchise.create({ accountId: user._id, league: 'claunts-league', seasons: [] });

        const v = await migration.verify();
        expect(v.ok).toBe(true);
        expect(v.warnings.join(' ')).toMatch(/not created by this migration/);
    });

    test('a field on User in neither list fails verification instead of vanishing', async () => {
        // The silent failure: the migration copies only fields it knows, and
        // every comparison also only looks at fields it knows — so a field added
        // to models/user.js later would be dropped AND pass.
        await seedUser();
        await migration.migrate({ apply: true });
        expect((await migration.verify()).ok).toBe(true);

        User.schema.add({ timezone: String });
        try {
            expect(migration.uncoveredUserFields()).toContain('timezone');
            const v = await migration.verify();
            expect(v.ok).toBe(false);
            expect(v.mismatches).toContainEqual(
                expect.objectContaining({ field: 'schema-coverage', reason: expect.stringContaining('timezone') })
            );
        } finally {
            delete User.schema.paths.timezone;
        }
    });

    test('a NESTED field in neither list also fails verification', async () => {
        // The coverage guard used to reject any dotted path, which was only
        // right for `seasons` — `prefs: { timezone }` dropped out of the check
        // entirely, so it would be lost with a green verify. Same class of
        // silent failure as the flat case, one level down.
        await seedUser();
        await migration.migrate({ apply: true });
        expect((await migration.verify()).ok).toBe(true);

        User.schema.add({ prefs: { timezone: String } });
        try {
            expect(migration.uncoveredUserFields()).toContain('prefs');
            const v = await migration.verify();
            expect(v.ok).toBe(false);
            expect(v.mismatches).toContainEqual(
                expect.objectContaining({ field: 'schema-coverage', reason: expect.stringContaining('prefs') })
            );
        } finally {
            Object.keys(User.schema.paths)
                .filter(k => k.startsWith('prefs'))
                .forEach(k => { delete User.schema.paths[k]; });
        }
    });

    test('does not mistake `seasons` subpaths for uncovered fields', async () => {
        // seasons.* is covered structurally; the root-segment comparison must
        // not start reporting every subdocument path as missing.
        expect(migration.uncoveredUserFields()).toEqual([]);
    });

    test('catches an account that claims a user but has a different _id', async () => {
        // The rule that breaks every login. A findById(user._id) can only ever
        // return a matching _id, so the old check was unreachable — this is the
        // shape that actually catches a minted one.
        const user = await seedUser();
        await migration.migrate({ apply: true });
        await Account.create({
            firstName: 'Stray', lastName: 'Account', migratedFrom: user._id
        });

        const v = await migration.verify();
        expect(v.ok).toBe(false);
        expect(v.mismatches).toContainEqual(
            expect.objectContaining({ field: '_id', reason: expect.stringContaining('would find nothing') })
        );
    });

    test('a field LISTED but missing from the destination model also fails', async () => {
        // The other half of the guard, and the nastier one: following verify's
        // own advice ("add it to ACCOUNT_FIELDS") without also adding it to
        // models/account.js produced a GREEN run that still dropped the field,
        // because Mongoose discards an undeclared path on both the stored
        // document and the expected one, so the two agree.
        User.schema.add({ timezone: String });
        migration.ACCOUNT_FIELDS.push('timezone');
        try {
            expect(migration.uncoveredUserFields()).toEqual([]);   // source side satisfied
            expect(migration.unroutedFields()).toContainEqual(expect.stringContaining('timezone'));

            await seedUser({ timezone: 'America/Chicago' });
            await migration.migrate({ apply: true });
            const v = await migration.verify();
            expect(v.ok).toBe(false);
            expect(v.mismatches).toContainEqual(
                expect.objectContaining({ field: 'schema-routing', reason: expect.stringContaining('models/account.js') })
            );
        } finally {
            migration.ACCOUNT_FIELDS.pop();
            delete User.schema.paths.timezone;
        }
    });

    test('the two field lists currently cover the whole User schema', async () => {
        // Guards the real thing rather than the mechanism: if this fails, some
        // field of a manager is about to be thrown away at cutover.
        expect(migration.uncoveredUserFields()).toEqual([]);
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

describe('schema-cast differences are not treated as mismatches', () => {
    test('a user with no isUpdated is not a false positive', async () => {
        // Mongoose applies `default: false` on the franchise, so a raw-document
        // comparison called a correct migration a failure.
        const user = await seedUser();
        await User.collection.updateOne({ _id: user._id }, { $unset: { isUpdated: '' } });
        await migration.migrate({ apply: true });
        expect((await migration.verify()).ok).toBe(true);
    });

    test('a season row with no teams key is not a false positive', async () => {
        // The preseason / pre-draft shape: casting injects `teams: []`.
        const user = await seedUser();
        await User.collection.updateOne(
            { _id: user._id },
            { $set: { seasons: [{ season: 2026, cumulativeScore: 0, weeklyScore: [] }] } }
        );
        await migration.migrate({ apply: true });
        expect((await migration.verify()).ok).toBe(true);
    });
});

describe('stripIds', () => {
    test('distinguishes Dates and ObjectIds instead of collapsing them to {}', async () => {
        // Both are objects with no own enumerable keys, so the generic rebuild
        // turned every one into {} — silently comparing every Date equal to
        // every other Date. There is no Date in seasonSchema today; the day
        // someone adds a draft timestamp, this has to already be right.
        const mongoose = require('mongoose');
        expect(migration.stripIds(new Date('2026-01-01'))).not.toEqual(migration.stripIds(new Date('2000-01-01')));
        const a = new mongoose.Types.ObjectId();
        const b = new mongoose.Types.ObjectId();
        expect(migration.stripIds(a)).not.toEqual(migration.stripIds(b));
        expect(migration.stripIds(a)).toEqual(migration.stripIds(a));
    });

    test('still handles nulls, nested arrays and plain values', async () => {
        expect(migration.stripIds(null)).toBeNull();
        expect(migration.stripIds([[{ a: 1, _id: 'x' }]])).toEqual([[{ a: 1 }]]);
        expect(migration.stripIds(7)).toBe(7);
    });
});

describe('the unique (accountId, league) index', () => {
    test('actually rejects a duplicate — this is what makes re-running safe', async () => {
        const user = await seedUser();
        await migration.migrate({ apply: true });
        await Franchise.init();   // ensure the index exists before relying on it

        await expect(
            Franchise.create({ accountId: user._id, league: 'graham-league', seasons: [] })
        ).rejects.toThrow(/duplicate key|E11000/);
    });
});

describe('a league that changed between runs', () => {
    test('re-running clears the franchise in the old league', async () => {
        // Real scenario: the 2026 Cole -> James roster change. Without this a
        // re-run left one manager holding two leagues, which verify() caught
        // but no amount of re-running fixed — contradicting the stated property
        // that a half-finished run is safe to repeat.
        const user = await seedUser({ league: 'graham-league' });
        await migration.migrate({ apply: true });
        await User.updateOne({ _id: user._id }, { $set: { league: 'claunts-league' } });

        await migration.migrate({ apply: true });

        const franchises = await Franchise.find({ accountId: user._id }).lean();
        expect(franchises).toHaveLength(1);
        expect(franchises[0].league).toBe('claunts-league');
        expect((await migration.verify()).ok).toBe(true);
    });

    test('does not remove a franchise the migration did not create', async () => {
        // A basketball entry (#310) is a legitimate second franchise.
        const user = await seedUser({ league: 'graham-league' });
        await migration.migrate({ apply: true });
        const other = await Franchise.create({ accountId: user._id, league: 'hardwood-league', seasons: [] });

        await migration.migrate({ apply: true });
        expect(await Franchise.findById(other._id).lean()).not.toBeNull();
    });
});

describe('convergence on removed data', () => {
    test('re-running clears a field the user no longer has', async () => {
        // routes/users.js $unset's authSub when a commissioner resets someone's
        // login link. $set-only writes left it on the Account forever, so verify
        // went red and STAYED red however many times you re-ran — against the
        // stated property that a half-finished run is safe to repeat. After
        // phase 2 the Account would also be holding a revoked credential.
        const user = await seedUser();
        await migration.migrate({ apply: true });
        expect((await Account.findById(user._id).lean()).authSub).toBe('google-oauth2|123');

        await User.collection.updateOne({ _id: user._id }, { $unset: { authSub: '' } });
        await migration.migrate({ apply: true });

        expect((await Account.findById(user._id).lean()).authSub).toBeUndefined();
        expect((await migration.verify()).ok).toBe(true);
    });

    test('re-running removes the franchise of a user whose league was cleared', async () => {
        // The stale sweep sat below `if (!user.league) continue;`, so it never
        // ran for the one user that needed it.
        const user = await seedUser();
        await migration.migrate({ apply: true });
        expect(await Franchise.countDocuments({ accountId: user._id })).toBe(1);

        await User.collection.updateOne({ _id: user._id }, { $unset: { league: '' } });
        await migration.migrate({ apply: true });

        expect(await Franchise.countDocuments({ accountId: user._id })).toBe(0);
        expect((await migration.verify()).ok).toBe(true);
    });

    test('still does not clear a field the destination model defaults', async () => {
        // Unsetting `isUpdated` would remove it while the expected document
        // carries `default: false` — the clear becoming the mismatch it was
        // meant to prevent.
        const user = await seedUser();
        await User.collection.updateOne({ _id: user._id }, { $unset: { isUpdated: '' } });
        await migration.migrate({ apply: true });
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

    test('leaves documents it did not create', async () => {
        const user = await seedUser();
        await migration.migrate({ apply: true });
        const outsider = await Franchise.create({ accountId: user._id, league: 'claunts-league', seasons: [] });

        const r = await migration.rollback({ apply: true });
        expect(r.deleted).toMatchObject({ accounts: 1, franchises: 1 });
        expect(r.kept).toMatchObject({ franchises: 1 });
        // A basketball-only manager cannot be reconstructed from `users`, so an
        // unscoped delete would lose them for good.
        expect(await Franchise.findById(outsider._id).lean()).not.toBeNull();
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

    test('reports documents the app has written to since the migration', async () => {
        // "A full return to the pre-migration state" stops being true the
        // moment phase 2 ships: the app writes here, `users` does not have
        // those edits, and deleting is data loss rather than a rollback.
        await seedUser();
        await migration.migrate({ apply: true });
        expect((await migration.rollback()).touchedSinceMigration).toBe(0);

        await Account.updateOne({}, { $set: { avatarUrl: 'https://example.com/new.jpg' } });
        expect((await migration.rollback()).touchedSinceMigration).toBe(1);
    });

    test('a plain re-apply is NOT counted as an app write', async () => {
        // Detecting this by `updatedAt > createdAt` counted the migration's own
        // re-run as divergence, so the warning fired on every document after a
        // second --apply — which would have taught an operator to ignore it.
        await seedUser();
        await migration.migrate({ apply: true });
        await migration.migrate({ apply: true });
        await migration.migrate({ apply: true });
        expect((await migration.rollback()).touchedSinceMigration).toBe(0);
    });

    test('does not warn about data loss when nothing was ever migrated', async () => {
        // "account missing" is a mismatch carrying a userId, so counting those
        // made a rollback on a clean database announce that two documents'
        // edits were about to be lost — with zero documents to delete.
        await seedUser();
        await seedUser({ firstName: 'Brock', lastName: 'McCord', email: 'b@example.com' });

        const r = await migration.rollback();
        expect(r.wouldDelete).toMatchObject({ accounts: 0, franchises: 0 });
        expect(r.touchedSinceMigration).toBe(0);
    });

    test('counts divergent DOCUMENTS, not users', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        await Account.updateOne({}, { $set: { avatarUrl: 'https://example.com/new.jpg' } });
        await Franchise.updateOne({}, { $set: { lastUpdated: 'tampered' } });
        // One user, but two documents at risk.
        expect((await migration.rollback()).touchedSinceMigration).toBe(2);
    });

    test('a migrate after a rollback is clean', async () => {
        await seedUser();
        await migration.migrate({ apply: true });
        await migration.rollback({ apply: true });
        await migration.migrate({ apply: true });
        expect((await migration.verify()).ok).toBe(true);
    });
});
