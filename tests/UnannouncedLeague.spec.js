// A league can exist in the database without the league finding out.
//
// #319 part 2 made the app read leagues from Mongo instead of a hardcoded
// array — which is what lets a basketball league exist at all. The same change
// put every league in the database on two surfaces that any logged-in member
// can reach:
//
//   window.CC_LEAGUE, emitted by the navbar into EVERY page's source
//   GET /leagues, whose commissioner gate in server.js lets all GETs through
//
// Neither RENDERS the league, so nothing looks wrong — it is in view-source
// and one fetch away. That matters because a league is built, seeded and
// tested for weeks before anyone is told about it, and "the data is not
// wired up yet" is not the same as "nobody can see it exists".
//
// The rule: you learn a league exists by being IN it (or by being an Admin).

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const League = require('../models/league');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const migration = require('../modules/account-migration');
const selection = require('../modules/league-selection');

useMongo();

const BALL = 'graham-league';
const SECRET = 'hoops-league';
const SECRET_NAME = 'Hardwood Heroes';

const reqFor = (accountId, roles = []) => {
    const user = {
        user_metadata: { roles, metadata: { league: 'gg', userId: accountId ? String(accountId) : undefined } }
    };
    return { oidc: { isAuthenticated: () => true, user }, effUser: user, headers: {} };
};

async function member(league, { second } = {}) {
    const u = await User.create({ firstName: 'Ann', lastName: 'T', league, seasons: [{ season: 2026 }] });
    await migration.migrate({ apply: true });
    if (second) await Franchise.create({ accountId: u._id, league: second, seasons: [{ season: 2026 }] });
    return u;
}

beforeEach(async () => {
    // The unannounced league: real, named, with nothing pointing at it.
    await League.create({ code: SECRET, name: SECRET_NAME, sport: 'basketball' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the client seed', () => {
    // leagueSeed.all lands in window.CC_LEAGUE on every page, so anything in
    // it is in view-source for anyone signed in.
    // viewerContext().seed is verbatim what server.js serialises into
    // window.CC_LEAGUE — asserted structurally at the bottom of this file,
    // because a middleware that rebuilds it inline is how the scoping gets
    // lost again.
    const seedFor = async (req) =>
        (await selection.viewerContext(req, await require('../modules/league-catalog').catalog(req))).seed.all;

    test('a member is not told the league exists', async () => {
        const u = await member(BALL);
        const seeded = await seedFor(reqFor(u._id));
        expect(seeded.map(l => l.code)).toEqual([BALL]);
        expect(JSON.stringify(seeded)).not.toContain(SECRET);
        expect(JSON.stringify(seeded)).not.toContain(SECRET_NAME);
    });

    test('a League Manager is not either', async () => {
        // The role carries authority over their OWN league, not a window
        // into every league in the database.
        const u = await member(BALL);
        const seeded = await seedFor(reqFor(u._id, ['League Manager']));
        expect(JSON.stringify(seeded)).not.toContain(SECRET);
    });

    test('but a member who has been ADDED to it is', async () => {
        // This is the intended way to find out: holding a franchise.
        const u = await member(BALL, { second: SECRET });
        const seeded = await seedFor(reqFor(u._id));
        expect(seeded.map(l => l.code)).toEqual([BALL, SECRET]);
        expect(seeded.find(l => l.code === SECRET).name).toBe(SECRET_NAME);
    });

    test('and an Admin always is', async () => {
        const seeded = await seedFor(reqFor(null, ['Admin']));
        expect(seeded.map(l => l.code)).toContain(SECRET);
    });
});

describe('GET /leagues', () => {
    // server.js's commissioner gate lets every GET through, so this route is
    // readable by any signed-in member.
    const app = (req) => {
        const a = express();
        a.use(express.json());
        a.use((r, res, next) => { Object.assign(r, req); next(); });
        a.use('/leagues', require('../routes/leagues'));
        return a;
    };

    test('does not list a league the caller is not in', async () => {
        const u = await member(BALL);
        const res = await request(app(reqFor(u._id))).get('/leagues');
        expect(res.status).toBe(200);
        expect(res.body.map(l => l.code)).toEqual([BALL]);
        expect(JSON.stringify(res.body)).not.toContain(SECRET_NAME);
    });

    test('lists it once they are in it', async () => {
        const u = await member(BALL, { second: SECRET });
        const res = await request(app(reqFor(u._id))).get('/leagues');
        expect(res.body.map(l => l.code).sort()).toEqual([BALL, SECRET].sort());
    });

    test('and an Admin sees every league, so the rename panel still works', async () => {
        const res = await request(app(reqFor(null, ['Admin']))).get('/leagues');
        expect(res.body.map(l => l.code)).toContain(SECRET);
        expect(res.body.find(l => l.code === SECRET).name).toBe(SECRET_NAME);
    });
});

describe('the switcher', () => {
    test('a member with one league still gets no switcher at all', async () => {
        // The feature must not announce itself by appearing, empty, for
        // people who are in exactly one league.
        const u = await member(BALL);
        const ctx = await selection.viewerContext(reqFor(u._id), await require('../modules/league-catalog').catalog());
        expect(ctx.canSwitch).toBe(false);
    });
});

describe('the page actually serialises the scoped seed', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

    test('server.js hands window.CC_LEAGUE viewerContext’s seed, nothing rebuilt', () => {
        expect(src).toContain('safeJson(viewer.seed)');
        // The specific regression: re-assembling the seed from the catalog.
        expect(src).not.toMatch(/leagueSeed = safeJson\(\{/);
        expect(src).not.toMatch(/all: res\.locals\.leagues/);
    });

    test('and the navbar emits that seed and no other league list', () => {
        const nav = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'views', 'partials', 'navbar.ejs'), 'utf8');
        expect(nav).toContain('window.CC_LEAGUE');
        // `leagues` is the full catalog. The navbar must only ever read
        // viewerLeagues and the seed.
        expect(nav).not.toMatch(/<%[-=][^%]*\bleagues\b(?!Seed)/);
    });
});
