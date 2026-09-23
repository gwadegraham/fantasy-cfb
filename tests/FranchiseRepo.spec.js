// Coverage for modules/franchise-repo.js — reading managers out of
// Account + Franchise in the shape the app already expects (#313 phase 2).
//
// The contract under test is "byte-identical to what the User read returned",
// because that is what lets the endpoints swap underneath without a single
// client change. So most of these assert shape and equivalence rather than
// behaviour: a field silently missing here is a blank on someone's page.

const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Account = require('../models/account');
const Franchise = require('../models/franchise');
const migration = require('../modules/account-migration');
const repo = require('../modules/franchise-repo');

useMongo();

// Default the flag ON for the body of this file — these tests are about the new
// source. The switch itself gets its own block at the bottom, where both
// positions are exercised against the same data.
const ORIGINAL_FLAG = process.env.FRANCHISE_READS;
beforeEach(() => { process.env.FRANCHISE_READS = 'true'; });
afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.FRANCHISE_READS;
    else process.env.FRANCHISE_READS = ORIGINAL_FLAG;
});

async function seedManager(overrides = {}) {
    const user = await User.create(Object.assign({
        firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com',
        league: 'graham-league', color: '#ED5858', authSub: 'google-oauth2|123',
        avatarUrl: 'https://example.com/a.jpg', profilePrompted: true,
        isUpdated: true, lastUpdated: '9/7/2026, 11:42:28 PM',
        seasons: [
            { season: 2025, cumulativeScore: 163, franchiseName: 'Acuff Me Up', weeklyScore: [] },
            { season: 2026, cumulativeScore: 34, franchiseName: 'Name, Image, & Sadness',
              weeklyScore: [{ week: 1, score: 8, season: 'regular', scoreByTeam: [{ teamId: 251, gameId: 1, score: 8 }] }],
              captains: [{ week: 1, teamId: 251 }] }
        ]
    }, overrides));
    await migration.migrate({ apply: true });
    return user;
}

describe('the shape matches what the User read returned', () => {
    test('_id is the ACCOUNT id — the one Auth0 and every existing link hold', async () => {
        const user = await seedManager();
        const got = await repo.byAccountId(user._id);
        expect(String(got._id)).toBe(String(user._id));
        // Emphatically not the franchise's own id.
        const franchise = await Franchise.findOne({ accountId: user._id }).lean();
        expect(String(got._id)).not.toBe(String(franchise._id));
    });

    test('person fields and league fields arrive on one flat document', async () => {
        const user = await seedManager();
        const got = await repo.byAccountId(user._id);
        expect(got).toMatchObject({
            firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com',
            color: '#ED5858', authSub: 'google-oauth2|123', profilePrompted: true,
            league: 'graham-league', isUpdated: true, lastUpdated: '9/7/2026, 11:42:28 PM'
        });
    });

    test('rosters, scores, franchise names and captains survive intact', async () => {
        const user = await seedManager();
        const got = await repo.byAccountId(user._id);
        const s2026 = got.seasons.find(s => s.season === 2026);
        expect(s2026.franchiseName).toBe('Name, Image, & Sadness');
        expect(s2026.cumulativeScore).toBe(34);
        expect(s2026.weeklyScore[0].scoreByTeam[0]).toMatchObject({ teamId: 251, gameId: 1, score: 8 });
        expect(s2026.captains[0]).toMatchObject({ week: 1, teamId: 251 });
    });

    test('every field the old read exposed is present', async () => {
        // The comparison that actually protects the swap: anything the User doc
        // had, the assembled doc must have.
        const user = await seedManager();
        const before = await User.findById(user._id).lean();
        const after = await repo.byAccountId(user._id);
        Object.keys(before).forEach(k => {
            if (['_id', '__v', 'createdAt', 'updatedAt'].includes(k)) return;
            expect(after).toHaveProperty(k);
        });
    });
});

describe('season projection', () => {
    test('byLeagueAndSeason returns ONE season, the requested one', async () => {
        // Callers index seasons[0] via public/season-of.js, so handing them a
        // full array would quietly serve the wrong year.
        await seedManager();
        const [got] = await repo.byLeagueAndSeason('graham-league', 2026);
        expect(got.seasons).toHaveLength(1);
        expect(got.seasons[0].season).toBe(2026);
        expect(got.seasons[0].franchiseName).toBe('Name, Image, & Sadness');
    });

    test('a past season projects that season, not the active one', async () => {
        await seedManager();
        const [got] = await repo.byLeagueAndSeason('graham-league', 2025);
        expect(got.seasons[0].season).toBe(2025);
        expect(got.seasons[0].franchiseName).toBe('Acuff Me Up');
    });

    test('a manager with no entry for that season is not returned', async () => {
        await seedManager();
        expect(await repo.byLeagueAndSeason('graham-league', 2024)).toEqual([]);
    });

    test('byAccountId returns the FULL seasons array, as findById did', async () => {
        const user = await seedManager();
        const got = await repo.byAccountId(user._id);
        expect(got.seasons.map(s => s.season)).toEqual([2025, 2026]);
    });

    test('bySeason spans leagues', async () => {
        await seedManager();
        await seedManager({ firstName: 'Jeff', lastName: 'Claunts', email: 'j@example.com',
            league: 'claunts-league', seasons: [{ season: 2026, cumulativeScore: 1 }] });
        const all = await repo.bySeason(2026);
        expect(all).toHaveLength(2);
        expect(all.map(u => u.league).sort()).toEqual(['claunts-league', 'graham-league']);
    });
});

describe('leaguesFor — what replaces the Auth0 gg/cl flag', () => {
    test('names the league a manager plays in', async () => {
        const user = await seedManager();
        expect(await repo.leaguesFor(user._id)).toEqual(['graham-league']);
    });

    test('returns BOTH once a person holds two franchises', async () => {
        // The whole point of the split. Today impossible; this is the assertion
        // that proves the plumbing is ready for it.
        const user = await seedManager();
        await Franchise.create({ accountId: user._id, league: 'hardwood-league', seasons: [] });
        expect((await repo.leaguesFor(user._id)).sort()).toEqual(['graham-league', 'hardwood-league']);
    });

    test('is empty for an account with no franchise, which is a normal state', async () => {
        const account = await Account.create({ firstName: 'Hoops', lastName: 'Only' });
        expect(await repo.leaguesFor(account._id)).toEqual([]);
    });
});

describe('projections are preserved, because the documents are heavy', () => {
    // A manager carries their full roster — every team object with its venue
    // subdocument — so an unprojected read is ~100KB. Several callers project
    // down to a few keys precisely for that reason, and dropping the projection
    // while moving the storage would undo deliberate work on a free-tier
    // cluster that also serves a 30-second poller.
    test('fields narrows the document on BOTH flag positions', async () => {
        const user = await seedManager();
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            const got = await repo.byAccountId(user._id, { fields: ['pushSubscriptions', 'pushPrefs'] });
            expect(got.firstName).toBeUndefined();
            expect(got.seasons).toBeUndefined();
            expect(got.authSub).toBeUndefined();
        }
    });

    test('a franchise-side field can be asked for alongside an account-side one', async () => {
        const user = await seedManager();
        const got = await repo.byAccountId(user._id, { fields: ['color', 'league', 'seasons'] });
        expect(got).toMatchObject({ color: '#ED5858', league: 'graham-league' });
        expect(got.seasons).toHaveLength(2);
        expect(got.firstName).toBeUndefined();
    });

    test('usedColors reads colours, not rosters', async () => {
        await seedManager();
        await seedManager({ firstName: 'Brock', lastName: 'McCord', email: 'b@example.com', color: '#71D28D' });
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            expect((await repo.usedColors('graham-league')).sort()).toEqual(['#71D28D', '#ED5858']);
        }
    });

    test('usedColors is empty for a league nobody is in', async () => {
        expect(await repo.usedColors('nobody-league')).toEqual([]);
    });
});

describe('a list read does not leak credentials', () => {
    // The old list endpoints project these out. Assembling from the account
    // without narrowing would have started shipping the Auth0 subject and the
    // push endpoints + encryption keys to every manager's Standings page.
    test.each(['authSub', 'pushSubscriptions', 'pushPrefs', 'captainReminders', 'recapNotices'])(
        'byLeagueAndSeason omits %s', async (field) => {
            await seedManager({ pushSubscriptions: [{ endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }] });
            const [got] = await repo.byLeagueAndSeason('graham-league', 2026);
            expect(got[field]).toBeUndefined();
        }
    );

    test('bySeason omits them too — it feeds the scoring pass, not a page', async () => {
        await seedManager();
        const [got] = await repo.bySeason(2026);
        expect(got.authSub).toBeUndefined();
        expect(got.pushSubscriptions).toBeUndefined();
    });

    test('but the single-document read still carries them, as findById did', async () => {
        // The admin roster needs authSub to report whether a manager is linked,
        // and /users/me/push needs the subscriptions. Narrowing this one would
        // break both.
        const user = await seedManager();
        const got = await repo.byAccountId(user._id);
        expect(got.authSub).toBe('google-oauth2|123');
    });
});

describe('missing data', () => {
    test('an unknown account id is null, not a throw', async () => {
        const mongoose = require('mongoose');
        expect(await repo.byAccountId(new mongoose.Types.ObjectId())).toBeNull();
    });

    test('an account with no franchise still returns the person', async () => {
        // A basketball-only manager before their league exists, or an account
        // mid-onboarding. The person is real even when the entry is not.
        const account = await Account.create({ firstName: 'Hoops', lastName: 'Only', color: '#fff' });
        const got = await repo.byAccountId(account._id);
        expect(got).toMatchObject({ firstName: 'Hoops', color: '#fff' });
        expect(got.league).toBeUndefined();
        expect(got.seasons).toBeUndefined();
    });

    test('a franchise whose account vanished is dropped rather than half-rendered', async () => {
        const user = await seedManager();
        await Account.deleteOne({ _id: user._id });
        expect(await repo.bySeason(2026)).toEqual([]);
    });
});

describe('the switch', () => {
    test('UNSET reads from users — so deploying this changes nothing', async () => {
        // The property the whole rollout rests on: shipping the flag is inert.
        const user = await seedManager();
        delete process.env.FRANCHISE_READS;
        expect(repo.readsFromFranchises()).toBe(false);

        // Prove it is genuinely the users collection by making the two disagree.
        await Franchise.updateOne({ accountId: user._id }, { $set: { league: 'tampered-league' } });
        const got = await repo.byAccountId(user._id);
        expect(got.league).toBe('graham-league');
    });

    test('only the exact string "true" turns it on', async () => {
        for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
            process.env.FRANCHISE_READS = value;
            expect(repo.readsFromFranchises()).toBe(false);
        }
        process.env.FRANCHISE_READS = 'true';
        expect(repo.readsFromFranchises()).toBe(true);
    });

    test('is read PER CALL, so a flip needs no module reload', async () => {
        const user = await seedManager();
        await Franchise.updateOne({ accountId: user._id }, { $set: { league: 'tampered-league' } });

        process.env.FRANCHISE_READS = 'false';
        expect((await repo.byAccountId(user._id)).league).toBe('graham-league');
        process.env.FRANCHISE_READS = 'true';
        expect((await repo.byAccountId(user._id)).league).toBe('tampered-league');
    });

    test('both positions return the same thing on real, untampered data', async () => {
        // The assertion the offline diff makes against prod, held here so a
        // regression fails CI rather than waiting for someone to run a script.
        await seedManager();
        await seedManager({ firstName: 'Jeff', lastName: 'Claunts', email: 'j@example.com',
            league: 'claunts-league', seasons: [{ season: 2026, cumulativeScore: 1 }] });

        const off = await withFlag(false, () => repo.bySeason(2026));
        const on = await withFlag(true, () => repo.bySeason(2026));
        expect(strip(on)).toEqual(strip(off));

        const offLeague = await withFlag(false, () => repo.byLeagueAndSeason('graham-league', 2026));
        const onLeague = await withFlag(true, () => repo.byLeagueAndSeason('graham-league', 2026));
        expect(strip(onLeague)).toEqual(strip(offLeague));
    });
});

function withFlag(on, fn) {
    process.env.FRANCHISE_READS = on ? 'true' : 'false';
    return Promise.resolve(fn());
}

// Subdocument ids differ between the two copies and are referenced nowhere.
function strip(value) {
    return JSON.parse(JSON.stringify(value, (k, v) => (k === '_id' || k === '__v' ? undefined : v)));
}
