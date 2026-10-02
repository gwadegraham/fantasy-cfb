// A league that exists only in Mongo has to WORK, not merely be listed.
//
// #319 part 2 replaced one `LEAGUES.map(...)` in server.js with a catalog, and
// a review found four more places still enumerating the hardcoded
// scoring-defaults array. The worst of them hard-blocked the whole feature:
//
//   POST /users is the ONLY path in the app that creates a franchise. While it
//   validated against the array, a basketball league could be created, named
//   and selected — and then never have a single member. No member, no second
//   franchise, so the member league switcher the part exists to deliver was
//   unreachable for exactly the leagues the catalog was added to support.
//
// This repo has been bitten by this shape before (the non-P5 upset bonus went
// through six places that each swallowed a new config field), so each migrated
// route is exercised against a Mongo-only league here.

const express = require('express');
const request = require('supertest');
const { useMongo, mirrorUsers } = require('./helpers/mongo');
const League = require('../models/league');
const User = require('../models/user');
const Franchise = require('../models/franchise');

useMongo();

const HOOPS = 'hoops-league';
const BALL = 'graham-league';

// An Admin session, as server.js's devRole middleware leaves it.
const asAdmin = (router, mount) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const user = { sub: 'auth0|a', user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: 'a' } } };
        req.oidc = { isAuthenticated: () => true, user };
        req.effUser = user;
        next();
    });
    app.use(mount, router);
    return app;
};

beforeEach(async () => {
    await League.create({ code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('POST /users — the only franchise-creation path there is', () => {
    const app = () => asAdmin(require('../routes/users'), '/users');

    test('a manager CAN be created in a database-only league', async () => {
        // The finding. Without this the member switcher can never happen,
        // because nobody can ever hold a second franchise.
        const res = await request(app()).post('/users').send({
            firstName: 'Ann', lastName: 'T', email: 'ann@example.com', league: HOOPS
        });
        expect(res.status).toBeLessThan(300);

        const f = await Franchise.findOne({ league: HOOPS }).lean();
        expect(f).not.toBeNull();
    });

    test('and the hardcoded leagues still work', async () => {
        const res = await request(app()).post('/users').send({
            firstName: 'Bo', lastName: 'H', email: 'bo@example.com', league: BALL
        });
        expect(res.status).toBeLessThan(300);
    });

    test('but a league that does not exist is still refused', async () => {
        // The guard is widened, not removed: canManageLeague answers true for
        // an Admin whatever it is handed, so a missing league would otherwise
        // create a manager belonging to no league at all.
        for (const league of [undefined, '', 'nonsense']) {
            const res = await request(app()).post('/users').send({
                firstName: 'Cy', lastName: 'K', email: 'cy@example.com', league
            });
            expect(res.status).toBe(400);
        }
        expect(await Franchise.countDocuments({ league: 'nonsense' })).toBe(0);
    });

    test('an ARCHIVED league is not a valid destination', async () => {
        await League.create({ code: 'old-league', name: 'Retired', status: 'archived' });
        const res = await request(app()).post('/users').send({
            firstName: 'Di', lastName: 'M', email: 'di@example.com', league: 'old-league'
        });
        expect(res.status).toBe(400);
    });
});

describe('GET/PATCH /leagues — naming', () => {
    const app = () => asAdmin(require('../routes/leagues'), '/leagues');

    test('a database-only league is listed', async () => {
        const res = await request(app()).get('/leagues');
        expect(res.body.map(l => l.code)).toContain(HOOPS);
    });

    test('and can be RENAMED', async () => {
        // The one editable thing about a league is the name the switcher
        // shows. It used to 404 for anything outside the hardcoded array,
        // so a new league was stuck with whatever its insert set.
        const res = await request(app()).patch(`/leagues/${HOOPS}`).send({ name: 'Hoops Dreams' });
        expect(res.status).toBe(200);
        expect((await League.findOne({ code: HOOPS }).lean()).name).toBe('Hoops Dreams');
    });

    test('an unknown league still 404s', async () => {
        expect((await request(app()).patch('/leagues/nonsense').send({ name: 'X' })).status).toBe(404);
    });
});

describe('GET /audit-log — scope', () => {
    test('an Admin sees every league, including the database-only one', async () => {
        const app = asAdmin(require('../routes/auditLog'), '/audit-log');
        const res = await request(app).get('/audit-log');
        expect(res.status).toBe(200);
        // `seesAll` is computed as visible.length === all.length; with the
        // hardcoded array as the denominator a Mongo-only league made the two
        // disagree, which would have silently scoped an Admin's own view.
        expect(res.body.scope === undefined || res.body.scope.includes(HOOPS)).toBe(true);
    });
});
