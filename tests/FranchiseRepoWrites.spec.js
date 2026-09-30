// The write half of modules/franchise-repo.js (#313 phase 3).
//
// Reads and writes both go to accounts/franchises now, and the switch that used
// to move them together is gone. The `users` documents
// are still on disk, which is why several tests here tamper with a franchise
// and then assert the answer CHANGED: a read or write still pointed at the old
// collection would otherwise pass every one of them.

const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const migration = require('../modules/account-migration');
const repo = require('../modules/franchise-repo');

useMongo();

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

// What the manager looks like to the app. Used to assert that a write landed
// somewhere the app will actually read it back from.
const readBack = (id) => repo.byAccountId(id);

describe('the field-routing lists cannot drift', () => {
    // modules/franchise-repo.js and modules/account-migration.js each carry
    // their own copy, and the repo's comment says "kept in sync deliberately" —
    // which until now was a promise with nothing behind it.
    //
    // The cost of drift went up in phase 3. The migration's lists decide what
    // gets COPIED; the repo's now also decide where a write GOES (createManager)
    // and how a document is split for editing (loadForWrite). A field added to
    // one side only would migrate correctly and then be unroutable — or be
    // routed and never migrated.
    const migration = require('../modules/account-migration');

    test('the repo and the migration agree on both lists', () => {
        expect([...repo.ACCOUNT_FIELDS].sort()).toEqual([...migration.ACCOUNT_FIELDS].sort());
        expect([...repo.FRANCHISE_FIELDS].sort()).toEqual([...migration.FRANCHISE_FIELDS].sort());
    });

    test('and no field is claimed by both', () => {
        const both = repo.ACCOUNT_FIELDS.filter(f => repo.FRANCHISE_FIELDS.includes(f));
        expect(both).toEqual([]);
    });
});

describe('writes land where the reads come from', () => {
    test('a franchise-side write is read back', async () => {
        const user = await seed();
        await repo.updateFranchise(user._id,
            { $set: { 'seasons.$.cumulativeScore': 99 } },
            { league: 'graham-league', filter: { 'seasons.season': 2026 } });
        const back = await readBack(user._id);
        expect(back.seasons.find(x => Number(x.season) === 2026).cumulativeScore).toBe(99);
    });

    test('an account-side write is read back', async () => {
        const user = await seed();
        await repo.updateAccount(user._id, { $set: { avatarUrl: 'https://x/new.png' } });
        expect((await readBack(user._id)).avatarUrl).toBe('https://x/new.png');
    });

    test('the write goes to the franchise and leaves `users` untouched', async () => {
        // The half that proves it is genuinely a different collection, not the
        // same write passing both assertions.
        const user = await seed();
        await repo.updateFranchise(user._id, { $set: { isUpdated: false } });
        expect((await Franchise.findOne({ accountId: user._id }).lean()).isUpdated).toBe(false);
        expect((await User.findById(user._id).lean()).isUpdated).toBe(true);
    });

    test('a franchise is found by accountId, not by _id', async () => {
        // The key changes with the collection. A write that kept { _id } would
        // match nothing and still resolve successfully at the driver level.
        const user = await seed();
        const fr = await Franchise.findOne({ accountId: user._id }).lean();
        expect(String(fr._id)).not.toBe(String(user._id));
        const res = await repo.updateFranchise(user._id, { $set: { isUpdated: false } });
        expect(res.matchedCount).toBe(1);
    });
});

describe('loadForWrite / saveBoth', () => {
    test('it hands back two documents and saves each to its own collection', async () => {
        // `same` stays on the context because callers branch on it; with one
        // source it is always false, and a handler that reads it still compiles.
        const user = await seed();
        const ctx = await repo.loadForWrite(user._id);
        expect(ctx.same).toBe(false);
        ctx.account.avatarUrl = 'https://x/two.png';
        ctx.franchise.isUpdated = false;
        await repo.saveBoth(ctx);

        expect((await Account.findById(user._id).lean()).avatarUrl).toBe('https://x/two.png');
        expect((await Franchise.findOne({ accountId: user._id }).lean()).isUpdated).toBe(false);
        // The users row is a leftover, not a destination.
        expect((await User.findById(user._id).lean()).avatarUrl).toBe('https://example.com/a.jpg');
    });

    test('a handler edits one account field and one franchise field blind', async () => {
        // The contract that lets every call site be written once: a handler sets
        // a field on each side without knowing which collection either lives in.
        const user = await seed();
        const ctx = await repo.loadForWrite(user._id);
        ctx.account.avatarUrl = 'https://x/same.png';
        ctx.franchise.seasons.find(s => Number(s.season) === 2026).franchiseName = 'Renamed';
        await repo.saveBoth(ctx);

        const back = await repo.byAccountId(user._id);
        expect(back.avatarUrl).toBe('https://x/same.png');
        expect(back.seasons.find(s => Number(s.season) === 2026).franchiseName).toBe('Renamed');
    });

    test('league picks WHICH franchise, once a person holds two', async () => {
        // Nothing passes two franchises today, so this is about the shape the
        // split exists to allow — one login holding a football team and a
        // basketball team. Without the filter, findOne returns whichever sorts
        // first in natural order and the handler edits the wrong sport's roster.
        const user = await seed();
        await Franchise.create({ accountId: user._id, league: 'hoops-league', seasons: [] });

        const football = await repo.loadForWrite(user._id, { league: 'graham-league' });
        const hoops = await repo.loadForWrite(user._id, { league: 'hoops-league' });
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

    test('an unknown id is null, not a throw', async () => {
        expect(await repo.loadForWrite(new mongoose.Types.ObjectId())).toBeNull();
    });

    test('an account with no franchise yields a null franchise, not a throw', async () => {
        const a = await Account.create({ firstName: 'Hoops', lastName: 'Only', color: '#fff' });
        const ctx = await repo.loadForWrite(a._id);
        expect(ctx.account).toBeTruthy();
        expect(ctx.franchise).toBeNull();
        await repo.saveBoth(ctx);   // must not throw
    });
});

describe('loadForWrite with a projection and a season', () => {
    // What the two PATCH middlewares in routes/users.js need. The projection is
    // not only about bytes: PATCH /:id relies on mongoose REFUSING to save a
    // document that both edits a scalar and replaces an array wholesale under an
    // $elemMatch projection, so a body carrying cumulativeScore AND weeklyScore
    // throws instead of writing half. Reproducing the projection on the
    // franchise is what keeps that true.
    const FIELDS = ['firstName', 'lastName', 'league', 'lastUpdated', 'color', 'seasons'];

    test('narrows to ONE season', async () => {
        const user = await seed();
        const ctx = await repo.loadForWrite(user._id, { season: 2026, fields: FIELDS });
        expect(ctx.franchise.seasons).toHaveLength(1);
        expect(Number(ctx.franchise.seasons[0].season)).toBe(2026);
    });

    test('a season the manager never played is null, which is the callers 404', async () => {
        // The filter, not the projection. Returning a document with an empty
        // roster instead would turn a 404 into a write against nothing.
        const user = await seed();
        expect(await repo.loadForWrite(user._id, { season: 1999, fields: FIELDS })).toBeNull();
    });

    test('a past season projects the past season, not the active one', async () => {
        const user = await seed();
        const ctx = await repo.loadForWrite(user._id, { season: 2025, fields: FIELDS });
        expect(ctx.franchise.seasons.map(x => Number(x.season))).toEqual([2025]);
    });

    test('the account side carries the response fields, and only those', async () => {
        const user = await seed();
        const ctx = await repo.loadForWrite(user._id, { season: 2026, fields: FIELDS });
        expect(ctx.account.firstName).toBe('Garrett');
        expect(ctx.account.color).toBe('#ED5858');
        // authSub and the devices are not in the field list and must not ride along.
        expect(ctx.account.authSub).toBeUndefined();
        expect(ctx.account.pushSubscriptions).toBeUndefined();
    });

    test('an edit through the projected context is written and read back', async () => {
        const user = await seed();
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

        const docs = await repo.rosteredForWrite();
        expect(docs).toHaveLength(1);
        expect(String(docs[0].seasons[0].teams[0].id)).toBe('251');
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
        const [doc] = await repo.rosteredForWrite();
        doc.seasons[0].teams[0].school = 'Texas';
        await doc.save();
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

    test('it creates the PAIR, and the account id is the id callers get', async () => {
        const made = await repo.createManager(NEW);
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

    test('the result is still User-shaped, which is what every caller reads', async () => {
        const made = await repo.createManager(NEW);
        expect(made.firstName).toBe('Ann');
        expect(made.league).toBe('graham-league');
        expect(made._id).toBeTruthy();
    });

    test('a failed franchise deletes the account it just made', async () => {
        // An orphan Account is NOT an inert half-record. decideInvite reads a
        // missing league as "no league constraint", so an account with no
        // franchise can claim an invite minted for any league. Rolling back is
        // safe because the account is one call old and nothing points at it.
        const boom = jest.spyOn(Franchise, 'create').mockRejectedValueOnce(new Error('write failed'));
        await expect(repo.createManager(NEW)).rejects.toThrow('write failed');
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

        await expect(repo.createManager(NEW)).rejects.toThrow('franchise write failed');

        boom.mockRestore(); noDelete.mockRestore();
    });

    test('a field routed to neither document is refused, not dropped', async () => {
        // The failure mode the migration already guards in its dry run: a new
        // User field nobody routed just vanishes. Here it throws instead, and
        // nothing is written on the way out.
        await expect(repo.createManager(
            Object.assign({}, NEW, { favouriteSnack: 'pretzels' })
        )).rejects.toThrow(/routed to neither/);
        expect(await User.countDocuments({})).toBe(0);
        expect(await Account.countDocuments({})).toBe(0);
    });
});
