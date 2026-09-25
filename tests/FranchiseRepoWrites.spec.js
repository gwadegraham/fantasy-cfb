// The write half of modules/franchise-repo.js (#313 phase 3).
//
// Phase 2 moved every manager READ behind this module while writes kept going to
// `users`. That asymmetry is why FRANCHISE_READS was forbidden in production:
// flag-on meant reading a migration-era snapshot and writing somewhere else, and
// for routes/scores.js that is destructive rather than merely stale.
//
// These cover the writes moving to the same place the reads come from. The
// property under test throughout is not "the new path works" but "the two paths
// agree" — because the flag is about to become a real switch, and a difference
// between its positions is a difference nobody sees until it is live.

const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const migration = require('../modules/account-migration');
const repo = require('../modules/franchise-repo');

useMongo();

const ORIGINAL = process.env.FRANCHISE_READS;
beforeEach(() => { delete process.env.FRANCHISE_READS; });
afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FRANCHISE_READS;
    else process.env.FRANCHISE_READS = ORIGINAL;
});

function withFlag(on, fn) {
    process.env.FRANCHISE_READS = on ? 'true' : 'false';
    return Promise.resolve(fn()).finally(() => { delete process.env.FRANCHISE_READS; });
}

async function seed(over = {}) {
    const user = await User.create(Object.assign({
        firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com',
        league: 'graham-league', color: '#ED5858', authSub: 'auth0|1',
        avatarUrl: 'https://example.com/a.jpg', profilePrompted: true,
        isUpdated: true, lastUpdated: '9/7/2026, 11:42:28 PM',
        pushPrefs: { score: true, final: false },
        seasons: [
            { season: 2025, cumulativeScore: 163, franchiseName: 'Last Year' },
            { season: 2026, cumulativeScore: 34, franchiseName: 'Name, Image, & Sadness',
              weeklyScore: [{ week: 1, score: 8, season: 'regular',
                              scoreByTeam: [{ teamId: 251, gameId: 1, score: 8 }] }],
              captains: [{ week: 1, teamId: 251 }] }
        ]
    }, over));
    await migration.migrate({ apply: true });
    return user;
}

// What the manager looks like from whichever source is live. Used to assert that
// a write landed somewhere the app will actually read it back from.
const readBack = (id) => repo.byAccountId(id);

describe('the flag governs writes as well as reads', () => {
    test('writesToFranchises is the SAME switch as readsFromFranchises', () => {
        // Not decoration. Two independent variables would let reads and writes
        // point at different collections, which is the exact divergence the
        // cutover exists to end.
        for (const v of ['true', 'false', '1', '', undefined]) {
            if (v === undefined) delete process.env.FRANCHISE_READS;
            else process.env.FRANCHISE_READS = v;
            expect(repo.writesToFranchises()).toBe(repo.readsFromFranchises());
        }
    });

    test('a franchise-side write is read back, on both positions', async () => {
        for (const on of [false, true]) {
            const user = await seed({ email: `f${on}@example.com` });
            await withFlag(on, async () => {
                await repo.updateFranchise(user._id,
                    { $set: { 'seasons.$.cumulativeScore': 99 } },
                    { league: 'graham-league', filter: { 'seasons.season': 2026 } });
                const back = await readBack(user._id);
                const s = back.seasons.find(x => Number(x.season) === 2026);
                expect(s.cumulativeScore).toBe(99);
            });
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
    });

    test('an account-side write is read back, on both positions', async () => {
        for (const on of [false, true]) {
            const user = await seed({ email: `a${on}@example.com` });
            await withFlag(on, async () => {
                await repo.updateAccount(user._id, { $set: { avatarUrl: 'https://x/new.png' } });
                expect((await readBack(user._id)).avatarUrl).toBe('https://x/new.png');
            });
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
    });

    test('flag ON writes the franchise and leaves `users` untouched', async () => {
        // The half that proves it is genuinely a different collection, not the
        // same write passing both assertions.
        const user = await seed();
        await withFlag(true, () => repo.updateFranchise(user._id, { $set: { isUpdated: false } }));
        expect((await Franchise.findOne({ accountId: user._id }).lean()).isUpdated).toBe(false);
        expect((await User.findById(user._id).lean()).isUpdated).toBe(true);
    });

    test('flag OFF writes `users` and leaves the franchise untouched', async () => {
        const user = await seed();
        await withFlag(false, () => repo.updateFranchise(user._id, { $set: { isUpdated: false } }));
        expect((await User.findById(user._id).lean()).isUpdated).toBe(false);
        expect((await Franchise.findOne({ accountId: user._id }).lean()).isUpdated).toBe(true);
    });

    test('a franchise is found by accountId, not by _id', async () => {
        // The key changes with the collection. A write that kept { _id } would
        // match nothing and still resolve successfully at the driver level.
        const user = await seed();
        const fr = await Franchise.findOne({ accountId: user._id }).lean();
        expect(String(fr._id)).not.toBe(String(user._id));
        const res = await withFlag(true, () => repo.updateFranchise(user._id, { $set: { isUpdated: false } }));
        expect(res.matchedCount).toBe(1);
    });
});

describe('loadForWrite / saveBoth', () => {
    test('flag OFF hands back ONE document under two names, and saves it once', async () => {
        const user = await seed();
        await withFlag(false, async () => {
            const ctx = await repo.loadForWrite(user._id);
            expect(ctx.same).toBe(true);
            expect(ctx.account).toBe(ctx.franchise);

            ctx.account.avatarUrl = 'https://x/one.png';
            ctx.franchise.isUpdated = false;
            await repo.saveBoth(ctx);
        });
        const saved = await User.findById(user._id).lean();
        expect(saved.avatarUrl).toBe('https://x/one.png');
        expect(saved.isUpdated).toBe(false);
    });

    test('flag ON hands back two documents and saves each to its own collection', async () => {
        const user = await seed();
        await withFlag(true, async () => {
            const ctx = await repo.loadForWrite(user._id);
            expect(ctx.same).toBe(false);
            ctx.account.avatarUrl = 'https://x/two.png';
            ctx.franchise.isUpdated = false;
            await repo.saveBoth(ctx);
        });
        expect((await Account.findById(user._id).lean()).avatarUrl).toBe('https://x/two.png');
        expect((await Franchise.findOne({ accountId: user._id }).lean()).isUpdated).toBe(false);
    });

    test('the SAME handler code produces the same result on both positions', async () => {
        // The contract that lets every call site be written once. A handler sets
        // one account field and one franchise field without knowing or caring
        // whether that is one document or two.
        const applyEdit = (ctx) => {
            ctx.account.avatarUrl = 'https://x/same.png';
            ctx.franchise.seasons.find(s => Number(s.season) === 2026).franchiseName = 'Renamed';
        };
        const results = {};
        for (const on of [false, true]) {
            const user = await seed({ email: `s${on}@example.com` });
            await withFlag(on, async () => {
                const ctx = await repo.loadForWrite(user._id);
                applyEdit(ctx);
                await repo.saveBoth(ctx);
                const back = await repo.byAccountId(user._id);
                results[on] = {
                    avatarUrl: back.avatarUrl,
                    franchiseName: back.seasons.find(s => Number(s.season) === 2026).franchiseName
                };
            });
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
        expect(results.true).toEqual(results.false);
        expect(results.true).toEqual({ avatarUrl: 'https://x/same.png', franchiseName: 'Renamed' });
    });

    test('league picks WHICH franchise, once a person holds two', async () => {
        // Nothing passes two franchises today, so this is about the shape the
        // split exists to allow — one login holding a football team and a
        // basketball team. Without the filter, findOne returns whichever sorts
        // first in natural order and the handler edits the wrong sport's roster.
        const user = await seed();
        await Franchise.create({ accountId: user._id, league: 'hoops-league', seasons: [] });

        const football = await withFlag(true, () => repo.loadForWrite(user._id, { league: 'graham-league' }));
        const hoops = await withFlag(true, () => repo.loadForWrite(user._id, { league: 'hoops-league' }));
        expect(football.franchise.league).toBe('graham-league');
        expect(hoops.franchise.league).toBe('hoops-league');
        expect(String(football.franchise._id)).not.toBe(String(hoops.franchise._id));
    });

    test('saveBoth(null) is a no-op, not a throw', async () => {
        // loadForWrite returns null for an unknown id, and several callers 404
        // on that before saving — but the error paths that do not are exactly
        // the ones nobody exercises by hand.
        await expect(repo.saveBoth(null)).resolves.toBeUndefined();
    });

    // NOT TESTED, deliberately, and recorded so it is not "fixed" later: that an
    // unmodified document causes no write. mongoose guarantees it (measured: 0
    // collection.updateOne calls for an unmodified save), so saveBoth has no
    // guard for it, and a test would pass whether or not one existed.

    test('an unknown id is null on both positions, not a throw', async () => {
        const ghost = new mongoose.Types.ObjectId();
        expect(await withFlag(false, () => repo.loadForWrite(ghost))).toBeNull();
        expect(await withFlag(true, () => repo.loadForWrite(ghost))).toBeNull();
    });

    test('an account with no franchise yields a null franchise, not a throw', async () => {
        const a = await Account.create({ firstName: 'Hoops', lastName: 'Only', color: '#fff' });
        const ctx = await withFlag(true, () => repo.loadForWrite(a._id));
        expect(ctx.account).toBeTruthy();
        expect(ctx.franchise).toBeNull();
        await withFlag(true, () => repo.saveBoth(ctx));   // must not throw
    });
});

describe('loadForWrite with a projection and a season', () => {
    // What the two PATCH middlewares in routes/users.js need. The projection is
    // not only about bytes: PATCH /:id relies on mongoose REFUSING to save a
    // document that both edits a scalar and replaces an array wholesale under an
    // $elemMatch projection, so a body carrying cumulativeScore AND weeklyScore
    // throws instead of writing half. Reproducing the projection on both flag
    // positions is what keeps that true.
    const FIELDS = ['firstName', 'lastName', 'league', 'lastUpdated', 'color', 'seasons'];

    test('narrows to ONE season on both positions', async () => {
        for (const on of [false, true]) {
            const user = await seed({ email: `p${on}@example.com` });
            await withFlag(on, async () => {
                const ctx = await repo.loadForWrite(user._id, { season: 2026, fields: FIELDS });
                expect(ctx.franchise.seasons).toHaveLength(1);
                expect(Number(ctx.franchise.seasons[0].season)).toBe(2026);
            });
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
    });

    test('a season the manager never played is null, which is the callers 404', async () => {
        // The filter, not the projection. Returning a document with an empty
        // roster instead would turn a 404 into a write against nothing.
        for (const on of [false, true]) {
            const user = await seed({ email: `q${on}@example.com` });
            const ctx = await withFlag(on, () => repo.loadForWrite(user._id, { season: 1999, fields: FIELDS }));
            expect(ctx).toBeNull();
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
    });

    test('a past season projects the past season, not the active one', async () => {
        const user = await seed();
        const ctx = await withFlag(true, () => repo.loadForWrite(user._id, { season: 2025, fields: FIELDS }));
        expect(ctx.franchise.seasons.map(x => Number(x.season))).toEqual([2025]);
    });

    test('the account side carries the response fields, and only those', async () => {
        const user = await seed();
        const ctx = await withFlag(true, () => repo.loadForWrite(user._id, { season: 2026, fields: FIELDS }));
        expect(ctx.account.firstName).toBe('Garrett');
        expect(ctx.account.color).toBe('#ED5858');
        // authSub and the devices are not in the field list and must not ride along.
        expect(ctx.account.authSub).toBeUndefined();
        expect(ctx.account.pushSubscriptions).toBeUndefined();
    });

    test('an edit through the projected context is written and read back', async () => {
        for (const on of [false, true]) {
            const user = await seed({ email: `r${on}@example.com` });
            await withFlag(on, async () => {
                const ctx = await repo.loadForWrite(user._id, { season: 2026, fields: FIELDS });
                ctx.franchise.seasons[0].cumulativeScore = 77;
                ctx.franchise.lastUpdated = 'just now';
                await repo.saveBoth(ctx);
                const back = await repo.byAccountId(user._id);
                expect(back.lastUpdated).toBe('just now');
                expect(back.seasons.find(x => Number(x.season) === 2026).cumulativeScore).toBe(77);
                // The season NOT projected must survive the write untouched.
                expect(back.seasons.find(x => Number(x.season) === 2025).cumulativeScore).toBe(163);
            });
            await User.deleteMany({}); await Account.deleteMany({}); await Franchise.deleteMany({});
        }
    });
});

describe('rosteredForWrite', () => {
    test('returns every entry that has a roster, and skips those that do not', async () => {
        const withRoster = await seed({ email: 'has@example.com', seasons: [{
            season: 2026,
            teams: [{ id: 251, school: 'Texas', mascot: 'M', abbreviation: 'TEX', conference: 'SEC',
                      color: '#000', logos: ['a.png'],
                      location: { venue_id: 1, name: 'V', city: 'C', state: 'ST', zip: '1',
                                  latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false } }]
        }] });
        await User.create({ firstName: 'No', lastName: 'Roster', league: 'graham-league', seasons: [{ season: 2026 }] });
        await migration.migrate({ apply: true });

        for (const on of [false, true]) {
            const docs = await withFlag(on, () => repo.rosteredForWrite());
            expect(docs).toHaveLength(1);
            expect(String(docs[0].seasons[0].teams[0].id)).toBe('251');
        }
        expect(String(withRoster._id)).toBeTruthy();
    });

    test('the documents it returns are mutable and save to the live collection', async () => {
        const user = await seed({ seasons: [{
            season: 2026,
            teams: [{ id: 251, school: 'Stale Name', mascot: 'M', abbreviation: 'TEX', conference: 'SEC',
                      color: '#000', logos: ['a.png'],
                      location: { venue_id: 1, name: 'V', city: 'C', state: 'ST', zip: '1',
                                  latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false } }]
        }] });
        await withFlag(true, async () => {
            const [doc] = await repo.rosteredForWrite();
            doc.seasons[0].teams[0].school = 'Texas';
            await doc.save();
        });
        expect((await Franchise.findOne({ accountId: user._id }).lean()).seasons[0].teams[0].school).toBe('Texas');
        expect((await User.findById(user._id).lean()).seasons[0].teams[0].school).toBe('Stale Name');
    });
});

describe('createManager', () => {
    const NEW = {
        firstName: 'Ann', lastName: 'Lee', email: 'ann@example.com',
        league: 'graham-league', color: '#71D28D',
        lastUpdated: '9/25/2026, 8:00:00 AM',
        seasons: [{ season: 2026 }]
    };

    test('flag OFF creates one user, and nothing in the new collections', async () => {
        const made = await withFlag(false, () => repo.createManager(NEW));
        expect(await User.countDocuments({})).toBe(1);
        expect(await Account.countDocuments({})).toBe(0);
        expect(made.league).toBe('graham-league');
    });

    test('flag ON creates the PAIR, and the account id is the id callers get', async () => {
        const made = await withFlag(true, () => repo.createManager(NEW));
        const account = await Account.findOne({ email: 'ann@example.com' }).lean();
        const franchise = await Franchise.findOne({ accountId: account._id }).lean();
        expect(franchise.league).toBe('graham-league');
        expect(String(made._id)).toBe(String(account._id));
        expect(await User.countDocuments({})).toBe(0);
        // Fields land on the right side of the split.
        expect(account.color).toBe('#71D28D');
        expect(account.league).toBeUndefined();
        expect(franchise.lastUpdated).toBe('9/25/2026, 8:00:00 AM');
    });

    test('the result is User-shaped on both positions', async () => {
        const off = await withFlag(false, () => repo.createManager(NEW));
        await User.deleteMany({});
        const on = await withFlag(true, () => repo.createManager(NEW));
        for (const made of [off, on]) {
            expect(made.firstName).toBe('Ann');
            expect(made.league).toBe('graham-league');
            expect(made._id).toBeTruthy();
        }
    });

    test('a failed franchise deletes the account it just made', async () => {
        // An orphan Account is NOT an inert half-record. decideInvite reads a
        // missing league as "no league constraint", so an account with no
        // franchise can claim an invite minted for any league. Rolling back is
        // safe because the account is one call old and nothing points at it.
        const boom = jest.spyOn(Franchise, 'create').mockRejectedValueOnce(new Error('write failed'));
        await expect(withFlag(true, () => repo.createManager(NEW))).rejects.toThrow('write failed');
        expect(await Account.countDocuments({})).toBe(0);
        expect(await Franchise.countDocuments({})).toBe(0);
        boom.mockRestore();
    });

    test('a rollback that itself fails still surfaces the ORIGINAL error', async () => {
        // Both writes failing is the worst moment to lose the reason why. If the
        // compensating delete threw on its own, the caller would be handed
        // "delete failed" and go looking in the wrong place — while the orphan
        // account it was trying to remove is still there.
        const boom = jest.spyOn(Franchise, 'create').mockRejectedValueOnce(new Error('franchise write failed'));
        const noDelete = jest.spyOn(Account, 'deleteOne').mockRejectedValueOnce(new Error('delete also failed'));

        await expect(withFlag(true, () => repo.createManager(NEW)))
            .rejects.toThrow('franchise write failed');

        boom.mockRestore(); noDelete.mockRestore();
    });

    test('a field routed to neither document is refused, not dropped', async () => {
        // The failure mode the migration already guards in its dry run: a new
        // User field nobody routed just vanishes. Here it throws instead.
        await expect(withFlag(true, () => repo.createManager(
            Object.assign({}, NEW, { favouriteSnack: 'pretzels' })
        ))).rejects.toThrow(/routed to neither/);
    });
});
