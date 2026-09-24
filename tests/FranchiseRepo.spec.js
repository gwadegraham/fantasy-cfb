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
        // Present so the credential-omission tests below can actually fail.
        // Without these, three of the five cases asserted that a field the
        // fixture never had was absent — true whatever the code does.
        //
        // pushSubscriptions is deliberately NOT here: findManagers uses an
        // unsubscribed manager as its "fails the account filter" case, and
        // seeding one everywhere would quietly delete that contrast. Tests that
        // need a subscription add it themselves.
        pushPrefs: { score: true, final: false },
        captainReminders: [{ season: 2026, week: 1, sentAt: new Date('2026-09-05T12:00:00Z') }],
        recapNotices: [{ season: 2026, week: 1, sentAt: new Date('2026-09-08T12:00:00Z') }],
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

describe('projectSeason: false means the whole document', () => {
    test('it replaces an UNPROJECTED find, so it must not narrow', async () => {
        // routes/scores.js and routes/playoffs.js both ran User.find() with no
        // projection. Returning the list shape here would be the same parity
        // break as on the two listing endpoints, just quieter — nothing would
        // fail, a caller would simply stop seeing a field.
        const user = await seedManager();
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            const [got] = await repo.bySeason(2026, { projectSeason: false });
            expect(got.authSub).toBe('google-oauth2|123');
            expect(got.seasons.map(sn => sn.season).sort()).toEqual([2025, 2026]);
        }
        expect(user).toBeDefined();
    });

    test('the default stays narrowed', async () => {
        await seedManager();
        const [got] = await repo.bySeason(2026);
        expect(got.authSub).toBeUndefined();
        expect(got.seasons).toHaveLength(1);
    });
});

describe('findManagers — conditions split across both documents', () => {
    // The case the convenience methods cannot express. push-notify wants
    // managers who have a push subscription (an ACCOUNT field) AND a rostered
    // team playing this week (a FRANCHISE field) — one `find` while both lived
    // on the same document, two queries and an intersection afterwards.
    const subscribed = { pushSubscriptions: { $exists: true, $ne: [] } };

    async function seedSubscribed(over = {}) {
        return seedManager(Object.assign({
            pushSubscriptions: [{ endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }]
        }, over));
    }

    test('requires BOTH halves, on both flag positions', async () => {
        await seedSubscribed();                                   // subscribed + rostered
        await seedManager({ firstName: 'NoSub', lastName: 'Here', email: 'n@example.com' });

        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            const got = await repo.findManagers({
                accountFilter: subscribed,
                franchiseFilter: { seasons: { $elemMatch: { season: 2026 } } },
                fields: ['firstName', 'pushSubscriptions']
            });
            expect(got.map(u => u.firstName)).toEqual(['Garrett']);
        }
    });

    test('an account failing its filter drops its franchise too', async () => {
        // The original was one document: failing either condition meant no row.
        // Matching franchises first and intersecting has to give the same answer.
        await seedManager();   // rostered, NOT subscribed
        const got = await repo.findManagers({
            accountFilter: subscribed,
            franchiseFilter: { seasons: { $elemMatch: { season: 2026 } } }
        });
        expect(got).toEqual([]);
    });

    test('a franchise failing its filter is excluded even when subscribed', async () => {
        await seedSubscribed();
        const got = await repo.findManagers({
            accountFilter: subscribed,
            franchiseFilter: { seasons: { $elemMatch: { season: 2099 } } }
        });
        expect(got).toEqual([]);
    });

    test('an _id narrowing on the account side still applies', async () => {
        // PUSH_RECIPIENT_IDS narrows delivery by account id; losing that would
        // notify people the operator meant to exclude.
        const a = await seedSubscribed();
        await seedSubscribed({ firstName: 'Brock', lastName: 'McCord', email: 'b@example.com' });
        const got = await repo.findManagers({
            accountFilter: Object.assign({ _id: { $in: [a._id] } }, subscribed),
            franchiseFilter: { seasons: { $elemMatch: { season: 2026 } } },
            fields: ['firstName']
        });
        expect(got.map(u => u.firstName)).toEqual(['Garrett']);
    });

    test('keeps the roster projection narrow', async () => {
        // push-notify measured seasons: 1 at 108,610 bytes per manager against
        // 1,208 for the projected form, on a cluster capped near 85 KB/s.
        await seedSubscribed();
        const [got] = await repo.findManagers({
            accountFilter: subscribed,
            franchiseFilter: { seasons: { $elemMatch: { season: 2026 } } },
            fields: ['firstName', 'pushSubscriptions', 'seasons.season', 'seasons.teams.id']
        });
        expect(got.seasons).toBeDefined();
        expect(got.seasons[0].weeklyScore).toBeUndefined();
        expect(got.league).toBeUndefined();
    });

    test('nothing matching is an empty array, not a throw', async () => {
        expect(await repo.findManagers({ franchiseFilter: { league: 'nobody' } })).toEqual([]);
    });
});

describe('byAccountId trims to the fields asked for', () => {
    test('adds no key the caller did not request, on either path', async () => {
        // It was the only fields-taking read that skipped keepOnly, so flag-on
        // carried a `seasons: []` that flag-off did not. A silent widening, and
        // the one fix in its commit with no test — reverting it left every spec
        // green and only the offline script noticed.
        const user = await seedManager();
        const fields = ['league', 'firstName', 'lastName', 'authSub'];
        const shapes = [];
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            shapes.push(Object.keys(await repo.byAccountId(user._id, { fields })).sort());
        }
        expect(shapes[1]).toEqual(shapes[0]);
        expect(shapes[0]).toEqual(['_id', 'authSub', 'firstName', 'lastName', 'league']);
    });

    test('still trims when only account-side fields are asked for', async () => {
        // The branch that skips the franchise query entirely.
        const user = await seedManager();
        process.env.FRANCHISE_READS = 'true';
        const got = await repo.byAccountId(user._id, { fields: ['firstName', 'color'] });
        expect(Object.keys(got).sort()).toEqual(['_id', 'color', 'firstName']);
    });
});

describe('an explicit field list beats the list default', () => {
    // LIST_ACCOUNT_FIELDS keeps credentials off the broad listings, and it is a
    // DEFAULT for callers that name nothing — not a ceiling. Intersecting an
    // explicit request with it silently drops what was asked for: the admin
    // Manager Logins panel computes `linked: !!u.authSub`, so a dropped authSub
    // reports every manager as never having logged in, on the panel an admin
    // reads before minting an invite link.
    //
    // byIds is the read that exercises this — it hydrates with list: true.
    test('byIds returns authSub when authSub is asked for', async () => {
        const user = await seedManager();
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            const [got] = await repo.byIds([user._id], { fields: ['firstName', 'authSub'] });
            expect(got.authSub).toBe('google-oauth2|123');
        }
    });

    test('but a caller that names nothing still gets the narrow list', async () => {
        const user = await seedManager();
        process.env.FRANCHISE_READS = 'true';
        const [got] = await repo.byIds([user._id]);
        expect(got.authSub).toBeUndefined();
        expect(got.pushSubscriptions).toBeUndefined();
    });

    test('findManagers honours an explicit credential request too', async () => {
        const user = await seedManager({
            pushSubscriptions: [{ endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }]
        });
        const [got] = await repo.findManagers({
            franchiseFilter: { league: 'graham-league' },
            fields: ['firstName', 'pushSubscriptions']
        });
        expect(got.pushSubscriptions).toHaveLength(1);
        expect(user).toBeDefined();
    });
});

describe('subfield projections survive', () => {
    test('seasons.franchiseName does not drag the rosters along', async () => {
        // routes/betting-groups.js records this exact projection as
        // "418KB -> 1KB, 4.4s -> 75ms". Widening it to `seasons` would undo that
        // silently, with every test still green.
        const user = await seedManager();
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            const [got] = await repo.byIds([user._id],
                { fields: ['firstName', 'league', 'seasons.season', 'seasons.franchiseName'] });
            expect(got.firstName).toBe('Garrett');
            expect(got.seasons.map(sn => sn.season).sort()).toEqual([2025, 2026]);
            expect(got.seasons[0].franchiseName).toBeDefined();
            // The expensive part must NOT be there.
            expect(got.seasons[0].weeklyScore).toBeUndefined();
            expect(got.seasons[0].teams).toBeUndefined();
        }
    });

    test('byIds returns only the accounts asked for', async () => {
        const a = await seedManager();
        await seedManager({ firstName: 'Brock', lastName: 'McCord', email: 'b@example.com' });
        const got = await repo.byIds([a._id], { fields: ['firstName'] });
        expect(got).toHaveLength(1);
        expect(got[0].firstName).toBe('Garrett');
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

// A rostered team as the user schema demands it: abbreviation, conference and a
// complete location are all required, and every one of them is weight this
// aggregate exists to leave on the server.
const LOC = { venue_id: 7, name: 'Autzen', city: 'Eugene', state: 'OR', zip: '97401',
              latitude: 44, longitude: -123, capacity: 54000, grass: true, dome: false };
const rosterTeam = (o) => Object.assign({
    id: 251, school: 'Texas', mascot: 'Longhorns', abbreviation: 'TEX',
    conference: 'SEC', color: '#BF5700', logos: ['a.png', 'b.png'], location: LOC
}, o);

describe('the aggregation reads — standings projections and the H2H pass', () => {
    // These two are the only reads that run a $lookup rather than assembling a
    // document from two finds, so they can fail in ways the rest cannot.

    test('projectionManagers answers identically from either source', async () => {
        await seedManager();
        await seedManager({ firstName: 'Brock', lastName: 'McCord', email: 'b@example.com',
            color: '#f9a857', authSub: 'auth0|9',
            seasons: [{ season: 2026, cumulativeScore: 12, franchiseName: 'Second Best',
                        teams: [rosterTeam({ id: 333, school: 'Georgia' })] }] });

        const off = await withFlag(false, () => repo.projectionManagers('graham-league', 2026));
        const on = await withFlag(true, () => repo.projectionManagers('graham-league', 2026));
        expect(on.length).toBe(2);
        expect(sortByName(on)).toEqual(sortByName(off));
    });

    test('projectionManagers keeps _id as the ACCOUNT id', async () => {
        const user = await seedManager();
        const [got] = await repo.projectionManagers('graham-league', 2026);
        expect(String(got._id)).toBe(String(user._id));
    });

    test('projectionManagers slims each team to id and school', async () => {
        // The reason this is an aggregate at all: a rostered team carries its
        // logos, venue and colours, and six managers of them came to 106KB on a
        // cluster where latency tracks bytes.
        await seedManager({ seasons: [{ season: 2026, franchiseName: 'Heavy',
            teams: [rosterTeam()] }] });
        const [got] = await repo.projectionManagers('graham-league', 2026);
        expect(got.seasons[0].teams).toEqual([{ id: 251, school: 'Texas' }]);
    });

    test('projectionManagers returns only the season asked for', async () => {
        // seedManager holds 2025 and 2026. Callers index seasons[0].
        await seedManager();
        const [got] = await repo.projectionManagers('graham-league', 2026);
        expect(got.seasons.map(sn => sn.season)).toEqual([2026]);
    });

    test('h2hManagers keeps weeklyScore WHOLE', async () => {
        // Not a nicety: routes/scores.js reads this array, edits four fields and
        // writes the whole thing back with $set. Anything trimmed off the read
        // is deleted from the stored document on the next H2H pass — scoreByTeam
        // and the Captain fields included.
        await seedManager();
        const [got] = await repo.h2hManagers('graham-league', 2026);
        expect(strip(got.seasons[0].weeklyScore)).toEqual([{
            week: 1, score: 8, season: 'regular',
            scoreByTeam: [{ teamId: 251, gameId: 1, score: 8 }]
        }]);
    });

    test('h2hManagers carries no account fields at all', async () => {
        // A regression test with a specific bug behind it. The join projected
        // `{ _id: 0 }` for the no-fields case, which is an EXCLUSION projection
        // and therefore returns every other field — so this read merged whole
        // accounts, authSub and email included, into a result the H2H pass hands
        // to computeH2HAwards. It is `{ _id: 1 }`, the inclusion form, now.
        await seedManager();
        const [got] = await repo.h2hManagers('graham-league', 2026);
        expect(Object.keys(got).sort()).toEqual(['_id', 'seasons']);
    });

    test('h2hManagers keeps _id as the ACCOUNT id', async () => {
        // The H2H pass writes back with updateOne({ _id: user._id }). A
        // franchise id here matches nothing and the bonus is silently not stored.
        const user = await seedManager();
        const [got] = await repo.h2hManagers('graham-league', 2026);
        expect(String(got._id)).toBe(String(user._id));
    });

    test('h2hManagers answers identically from either source', async () => {
        await seedManager();
        const off = await withFlag(false, () => repo.h2hManagers('graham-league', 2026));
        const on = await withFlag(true, () => repo.h2hManagers('graham-league', 2026));
        expect(strip(on)).toEqual(strip(off));
    });

    test('a franchise whose account vanished is dropped from both aggregates', async () => {
        // Membership, not decoration. The H2H pass PAIRS managers against each
        // other, so an extra entry does not add a row — it re-partners everyone
        // else for that week.
        const user = await seedManager();
        await Account.deleteOne({ _id: user._id });
        expect(await repo.h2hManagers('graham-league', 2026)).toEqual([]);
        expect(await repo.projectionManagers('graham-league', 2026)).toEqual([]);
    });

    test('leaguesWithSeason agrees across both sources and skips empty leagues', async () => {
        await seedManager();
        await seedManager({ firstName: 'Jeff', lastName: 'Claunts', email: 'j@example.com',
            league: 'claunts-league', authSub: 'auth0|7',
            seasons: [{ season: 2025, cumulativeScore: 1 }] });

        const off = await withFlag(false, () => repo.leaguesWithSeason(2026));
        const on = await withFlag(true, () => repo.leaguesWithSeason(2026));
        expect(on).toEqual(off);
        // claunts-league has a 2025 entry and no 2026 one, so it must not appear.
        expect(on).toEqual(['graham-league']);
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

    test('anyFranchise and leaguesFor answer from users when the flag is off', async () => {
        // These two were the last uncovered lines in the module, and both were
        // the FLAG-OFF branch — the one running in production right now. A
        // suite that only exercises the new source proves nothing about the
        // path that is actually live.
        const user = await seedManager();

        expect(await withFlag(false, () => repo.anyFranchise({ league: 'graham-league' }))).toBe(true);
        expect(await withFlag(false, () => repo.anyFranchise({ league: 'nobody-league' }))).toBe(false);
        expect(await withFlag(false, () => repo.leaguesFor(user._id))).toEqual(['graham-league']);
        expect(await withFlag(true, () => repo.anyFranchise({ league: 'graham-league' }))).toBe(true);
        expect(await withFlag(true, () => repo.anyFranchise({ league: 'nobody-league' }))).toBe(false);

        // Prove it is genuinely reading users, not franchises, by making the
        // two disagree — otherwise this passes whichever branch runs.
        await Franchise.updateOne({ accountId: user._id }, { $set: { league: 'tampered-league' } });
        expect(await withFlag(false, () => repo.leaguesFor(user._id))).toEqual(['graham-league']);
        expect(await withFlag(true, () => repo.leaguesFor(user._id))).toEqual(['tampered-league']);
    });

    test('leaguesFor is empty for an unknown account on the users path too', async () => {
        const mongoose = require('mongoose');
        expect(await withFlag(false, () => repo.leaguesFor(new mongoose.Types.ObjectId()))).toEqual([]);
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

// projectionManagers returns managers in whatever order the collection yields,
// and the two sources are two different collections.
function sortByName(docs) {
    return strip(docs).slice().sort((a, b) => String(a.firstName).localeCompare(String(b.firstName)));
}
