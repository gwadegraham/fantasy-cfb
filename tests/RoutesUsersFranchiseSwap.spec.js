// The /users endpoints must return byte-identical JSON with FRANCHISE_READS off
// and on (#313 phase 2).
//
// This is the contract the whole rollout rests on. The client calls a handful of
// /users/* endpoints; if their responses are identical, every page keeps working
// with no change, and flipping the flag in production is a non-event. So rather
// than assert a shape, these hit the real routes twice — once per flag position
// — and diff the responses against each other.
//
// The offline script does this against production data; this holds the same
// property in CI, so a regression fails a build instead of waiting for someone
// to remember to run a script.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const migration = require('../modules/account-migration');
const usersRouter = require('../routes/users');
const franchiseRepo = require('../modules/franchise-repo');

const app = express();
app.use(express.json());
app.use('/users', usersRouter);

useMongo();

const ORIGINAL = process.env.FRANCHISE_READS;

beforeEach(async () => {
    delete process.env.FRANCHISE_READS;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    activeSeason._reset();
    await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
    await activeSeason.prime();
});

afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL === undefined) delete process.env.FRANCHISE_READS;
    else process.env.FRANCHISE_READS = ORIGINAL;
});

async function seedLeague() {
    await User.create([
        {
            firstName: 'Garrett', lastName: 'Graham', email: 'g@example.com',
            league: 'graham-league', color: '#ED5858', authSub: 'google-oauth2|123',
            avatarUrl: 'https://example.com/a.jpg', profilePrompted: true,
            isUpdated: true, lastUpdated: '9/7/2026, 11:42:28 PM',
            pushSubscriptions: [{ endpoint: 'https://push/x', keys: { p256dh: 'k', auth: 'a' } }],
            seasons: [
                { season: 2025, cumulativeScore: 163, franchiseName: 'Acuff Me Up' },
                { season: 2026, cumulativeScore: 34, franchiseName: 'Name, Image, & Sadness',
                  weeklyScore: [{ week: 1, score: 8, season: 'regular', scoreByTeam: [{ teamId: 251, gameId: 1, score: 8 }] }],
                  captains: [{ week: 1, teamId: 251 }] }
            ]
        },
        {
            firstName: 'Brock', lastName: 'McCord', email: 'b@example.com',
            league: 'graham-league', color: '#71D28D',
            seasons: [{ season: 2025, cumulativeScore: 247 }, { season: 2026, cumulativeScore: 41 }]
        },
        {
            firstName: 'Jeff', lastName: 'Claunts', email: 'j@example.com',
            league: 'claunts-league', color: '#64B5F6',
            seasons: [{ season: 2026, cumulativeScore: 12 }]
        }
    ]);
    await migration.migrate({ apply: true });
}

// Hit a path with the flag off, then on, and return both bodies.
async function bothWays(path) {
    process.env.FRANCHISE_READS = 'false';
    const off = await request(app).get(path);
    process.env.FRANCHISE_READS = 'true';
    const on = await request(app).get(path);
    return { off, on };
}

// Subdocument ids differ between the two copies and are referenced nowhere.
const strip = (v) => JSON.parse(JSON.stringify(v, (k, val) => (k === '_id' || k === '__v' ? undefined : val)));

describe('responses are identical with the flag off and on', () => {
    test.each([
        ['GET /users/season/:year', '/users/season/2026'],
        ['GET /users/league/:code', '/users/league/graham-league'],
        ['GET /users/league/:code (other league)', '/users/league/claunts-league'],
        ['GET /users/league/:code?season= (past season)', '/users/league/graham-league?season=2025'],
        ['GET /users (every manager)', '/users'],
        ['GET /users/league/:code/all (membership, any season)', '/users/league/graham-league/all']
    ])('%s', async (_label, path) => {
        await seedLeague();
        const { off, on } = await bothWays(path);

        expect(on.status).toBe(off.status);
        expect(on.status).toBe(200);
        expect(strip(on.body)).toEqual(strip(off.body));
        // Guard against both sides being trivially empty.
        expect(on.body.length).toBeGreaterThan(0);
    });

    test('an empty result is empty both ways, not an error', async () => {
        await seedLeague();
        const { off, on } = await bothWays('/users/league/graham-league?season=2019');
        expect(on.status).toBe(off.status);
        expect(on.body).toEqual([]);
        expect(off.body).toEqual([]);
    });
});

describe('what the responses must and must not contain', () => {
    test('one season only — callers index seasons[0]', async () => {
        // public/season-of.js reads the projected entry positionally, so a full
        // seasons array would quietly serve the wrong year.
        await seedLeague();
        const { on } = await bothWays('/users/league/graham-league');
        on.body.forEach(u => expect(u.seasons).toHaveLength(1));
        expect(on.body[0].seasons[0].season).toBe(2026);
    });

    test('?season= projects the PAST season, not the active one', async () => {
        await seedLeague();
        const { on } = await bothWays('/users/league/graham-league?season=2025');
        expect(on.body.find(u => u.firstName === 'Garrett').seasons[0]).toMatchObject({
            season: 2025, franchiseName: 'Acuff Me Up'
        });
    });

    test('the unprojected listings expose what they always exposed — parity, not an improvement', async () => {
        // GET /users and /league/:code/all ran User.find() with NO projection,
        // so they returned whole documents including authSub. Narrowing them
        // here would be a behaviour change smuggled inside a storage change; if
        // the old response carried a field, the new one has to as well. The
        // over-exposure is real and worth fixing where it reads as a fix.
        await seedLeague();
        const { off, on } = await bothWays('/users/league/graham-league/all');
        const offGarrett = off.body.find(u => u.firstName === 'Garrett');
        const onGarrett = on.body.find(u => u.firstName === 'Garrett');
        expect(offGarrett.authSub).toBe('google-oauth2|123');
        expect(onGarrett.authSub).toBe(offGarrett.authSub);
    });

    test.each(['authSub', 'pushSubscriptions', 'pushPrefs'])(
        'no %s reaches the browser', async (field) => {
            await seedLeague();
            const { off, on } = await bothWays('/users/league/graham-league');
            on.body.forEach(u => expect(u[field]).toBeUndefined());
            // And it was not there before either — this is parity, not a new rule.
            off.body.forEach(u => expect(u[field]).toBeUndefined());
        }
    );

    test('scores and rosters survive the swap intact', async () => {
        await seedLeague();
        const { on } = await bothWays('/users/season/2026');
        const garrett = on.body.find(u => u.firstName === 'Garrett');
        expect(garrett.seasons[0].weeklyScore[0].scoreByTeam[0]).toMatchObject({ teamId: 251, score: 8 });
    });
});

// Compare a route's CURRENT response against the query it replaced, written out
// verbatim. Flag-off-vs-flag-on cannot see a widening that affects both paths —
// which is how five call sites regressed while every check stayed green.
async function originalVsRoute(path, originalQuery) {
    const original = await originalQuery();
    process.env.FRANCHISE_READS = 'false';
    const off = await request(app).get(path);
    process.env.FRANCHISE_READS = 'true';
    const on = await request(app).get(path);
    return { original, off: off.body, on: on.body };
}

describe('responses match the query they replaced, not just each other', () => {
    test('GET /users/:id/season exposes no credentials', async () => {
        // It spread an unprojected document, and /users has no per-id ownership
        // check — so any signed-in manager could read anyone else's Auth0
        // subject and their devices' push encryption keys by id.
        await seedLeague();
        const garrett = await User.findOne({ firstName: 'Garrett' }).lean();
        const { original, off, on } = await originalVsRoute(
            `/users/${garrett._id}/season`,
            () => User.find({ _id: garrett._id, 'seasons.season': { $eq: 2026 } },
                { firstName: 1, lastName: 1, league: 1, lastUpdated: 1, color: 1,
                  seasons: { $elemMatch: { season: { $eq: 2026 } } } }).lean()
        );
        for (const body of [off, on]) {
            expect(Object.keys(body[0]).sort()).toEqual(Object.keys(original[0]).sort());
            expect(body[0].authSub).toBeUndefined();
            expect(body[0].pushSubscriptions).toBeUndefined();
        }
    });

    test('GET /users/me/push does not pull the roster subtree', async () => {
        // The route's own comment: an unprojected read "would pull ~100KB to
        // decide one boolean". Asking for `seasons` instead of `seasons.season`
        // did exactly that — 110 bytes to 107KB.
        await seedLeague();
        const garrett = await User.findOne({ firstName: 'Garrett' }).lean();
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            const got = await franchiseRepo.byAccountId(garrett._id,
                { fields: ['pushSubscriptions', 'pushPrefs', 'seasons.season'] });
            expect(got.seasons.every(sn => sn.teams === undefined)).toBe(true);
            expect(got.seasons.every(sn => sn.weeklyScore === undefined)).toBe(true);
        }
    });

    test('the admin roster keeps its projection', async () => {
        await seedLeague();
        for (const on of [false, true]) {
            process.env.FRANCHISE_READS = on ? 'true' : 'false';
            const rows = await franchiseRepo.byLeague('graham-league', { fields: [
                'firstName', 'lastName', 'color', 'email', 'authSub',
                'seasons.season', 'seasons.teams.id', 'seasons.weeklyScore.scoreByTeam'
            ] });
            // Selected BY NAME, not by position. Asserting on rows[0] made this
            // both flaky and vacuous: Mongo's natural order varies between runs,
            // and the other manager has no franchiseName, so half the time it
            // asserted that an absent field was absent and proved nothing.
            const got = rows.find(u => u.firstName === 'Garrett');
            expect(got).toBeDefined();
            expect(got.seasons.length).toBeGreaterThan(0);

            // authSub is wanted here — it becomes `linked` on the admin panel —
            // but the heavy parts of a season must not ride along.
            expect(got.authSub).toBe('google-oauth2|123');
            got.seasons.forEach(sn => {
                expect(sn.franchiseName).toBeUndefined();
                expect(sn.captains).toBeUndefined();
            });
        }
    });
});

describe('the reads that are not plain lists', () => {
    test('GET /users/:id returns an ARRAY, as User.find() did', async () => {
        // The client indexes [0]. Returning the bare object would break every
        // caller silently rather than loudly.
        await seedLeague();
        const garrett = await User.findOne({ firstName: 'Garrett' }).lean();
        const { off, on } = await bothWays(`/users/${garrett._id}`);
        expect(Array.isArray(on.body)).toBe(true);
        expect(strip(on.body)).toEqual(strip(off.body));
        expect(on.body[0].firstName).toBe('Garrett');
    });

    test('GET /users/:id carries the FULL seasons array, not one season', async () => {
        await seedLeague();
        const garrett = await User.findOne({ firstName: 'Garrett' }).lean();
        const { on } = await bothWays(`/users/${garrett._id}`);
        expect(on.body[0].seasons.map(sn => sn.season).sort()).toEqual([2025, 2026]);
    });

    test('a membership listing spans seasons, unlike the season-scoped one', async () => {
        // /league/:code/all has no season filter — a manager who only played a
        // past season still belongs to the league.
        await seedLeague();
        const { off, on } = await bothWays('/users/league/graham-league/all');
        expect(strip(on.body)).toEqual(strip(off.body));
        expect(on.body.length).toBe(2);
    });

    test('an unknown id is handled the same way both ways', async () => {
        await seedLeague();
        const mongoose = require('mongoose');
        const { off, on } = await bothWays(`/users/${new mongoose.Types.ObjectId()}`);
        expect(on.status).toBe(off.status);
        expect(strip(on.body)).toEqual(strip(off.body));
    });
});
