// HTTP-level tests for routes/betting.js. The router is mounted on a bare
// Express app (no Auth0 — the server's auth tiers are unit-tested separately in
// Permissions.spec.js) backed by an in-memory Mongo, with req.effUser stubbed
// ahead of the router so its own group-membership middleware can run for real.

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const BettingGroup = require('../models/bettingGroup');
const Parlay = require('../models/parlay');
const Game = require('../models/game');
const bettingRouter = require('../routes/betting');

const MEMBER = new mongoose.Types.ObjectId();

const app = express();
app.use(express.json());
app.use((req, res, next) => {
    req.effUser = { user_metadata: { metadata: { userId: MEMBER.toString() } } };
    next();
});
app.use('/betting', bettingRouter);

useMongo();

let group;
beforeEach(async () => {
    group = await BettingGroup.create({ active: true, season: 2026, members: [MEMBER] });
});

// The Bettors board's data. The computation is unit-tested in
// tests/ParlayStats.spec.js; what matters here is that the route reaches the
// right slips, seeds every group member, and does not need a second round trip
// for names.
describe('GET /betting/contributor-stats/:season', () => {
    const OTHER = new mongoose.Types.ObjectId();

    beforeEach(async () => {
        await BettingGroup.findByIdAndUpdate(group._id, { members: [MEMBER, OTHER] });
        await Parlay.create([
            {
                group: group._id, season: 2026, week: 1, status: 'lost',
                legs: [
                    { contributor: MEMBER, result: 'win', odds: -150 },
                    { contributor: OTHER, result: 'loss', odds: -200 }
                ]
            },
            {
                group: group._id, season: 2026, week: 2, status: 'won',
                legs: [
                    { contributor: MEMBER, result: 'win', odds: -110 },
                    { contributor: OTHER, result: 'win', odds: -130 }
                ]
            }
        ]);
    });

    test('splits the group record out by contributor', async () => {
        const res = await request(app).get('/betting/contributor-stats/2026');

        expect(res.status).toBe(200);
        const mine = res.body.rows.find(r => r.contributor === MEMBER.toString());
        expect(mine).toMatchObject({ wins: 2, losses: 0, decided: 2, hitRate: 100 });
        expect(res.body.slips).toBe(2);
    });

    // Week 1 lost with OTHER as the only loss — that is a solo kill.
    test('surfaces the solo killer as an award', async () => {
        const res = await request(app).get('/betting/contributor-stats/2026');
        expect(res.body.superlatives.killer.contributor).toBe(OTHER.toString());
    });

    test('seeds every group member, including one with no legs', async () => {
        const THIRD = new mongoose.Types.ObjectId();
        await BettingGroup.findByIdAndUpdate(group._id, { members: [MEMBER, OTHER, THIRD] });

        const res = await request(app).get('/betting/contributor-stats/2026');

        const third = res.body.rows.find(r => r.contributor === THIRD.toString());
        expect(third).toBeDefined();
        expect(third).toMatchObject({ legs: 0, decided: 0, hitRate: null });
    });

    test('does not count another season', async () => {
        await Parlay.create({
            group: group._id, season: 2025, week: 1, status: 'lost',
            legs: [{ contributor: MEMBER, result: 'loss' }]
        });

        const res = await request(app).get('/betting/contributor-stats/2026');

        expect(res.body.rows.find(r => r.contributor === MEMBER.toString()).losses).toBe(0);
    });

    // Another group's slips are another group's business.
    test('does not count another group', async () => {
        const other = await BettingGroup.create({ active: true, season: 2026, members: [OTHER] });
        await Parlay.create({
            group: other._id, season: 2026, week: 3, status: 'lost',
            legs: [{ contributor: MEMBER, result: 'loss' }]
        });

        const res = await request(app).get('/betting/contributor-stats/2026');

        expect(res.body.rows.find(r => r.contributor === MEMBER.toString()).losses).toBe(0);
    });

    test('answers an empty board rather than an error for a season with no slips', async () => {
        const res = await request(app).get('/betting/contributor-stats/2024');

        expect(res.status).toBe(200);
        expect(res.body.slips).toBe(0);
        expect(res.body.rows.every(r => r.decided === 0)).toBe(true);
    });
});

describe('GET /betting/:id', () => {
    // Regression. This is the last route in the router, so it catches anything
    // unmatched above it and treats the segment as a parlay id. public/team.js
    // asked this router for a SEASON ("/betting/2026"), Mongoose threw a
    // CastError trying to coerce it to an ObjectId, and the catch turned that
    // into a 500 — a server fault for what is plainly a bad request. The team
    // page swallowed the failure and quietly rendered its schedule with no
    // spreads at all. Season lines live on /betting-lines/:year.
    test('rejects a segment that is not an id, instead of 500ing', async () => {
        const res = await request(app).get('/betting/2026');

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invalid parlay id/i);
    });

    test('404s for a well-formed id that matches nothing', async () => {
        const res = await request(app).get(`/betting/${new mongoose.Types.ObjectId()}`);
        expect(res.status).toBe(404);
    });

    test('returns the parlay for a real id', async () => {
        const parlay = await Parlay.create({ group: group._id, season: 2026, week: 2, wager: 20 });

        const res = await request(app).get(`/betting/${parlay._id}`);

        expect(res.status).toBe(200);
        expect(res.body.week).toBe(2);
        expect(res.body.season).toBe(2026);
    });
});

// Admin-gated routes read roles off req.oidc.user, not req.effUser, so this
// app stubs both: the group middleware needs the member id, the admin check
// needs the role.
const adminApp = express();
adminApp.use(express.json());
adminApp.use((req, res, next) => {
    req.effUser = { user_metadata: { metadata: { userId: MEMBER.toString() } } };
    req.oidc = {
        isAuthenticated: () => true,
        user: { user_metadata: { roles: ['Admin'], metadata: { userId: MEMBER.toString() } } }
    };
    next();
});
adminApp.use('/betting', bettingRouter);

describe('PATCH /betting/:id — wager and boost', () => {
    let parlay;
    beforeEach(async () => {
        parlay = await Parlay.create({
            group: group._id, season: 2026, week: 2,
            wager: 20, parlayOdds: 398, boostPct: 20, boostedOdds: 478, boostCap: 10
        });
    });

    const patch = body => request(adminApp).patch(`/betting/${parlay._id}`).send(body);

    test('records a boost cap', async () => {
        const res = await patch({ boostCap: 5 });
        expect(res.status).toBe(200);
        expect(res.body.boostCap).toBe(5);
    });

    // Regression. These fields were gated on `!= null`, so emptying a box in
    // the admin panel sent null and the route silently kept the old number —
    // a fat-fingered boost was permanent until someone edited Mongo by hand.
    test('clears a boost field when the admin empties the box', async () => {
        const res = await patch({ boostPct: null, boostedOdds: null, boostCap: null });

        expect(res.status).toBe(200);
        expect(res.body.boostPct == null).toBe(true);
        expect(res.body.boostedOdds == null).toBe(true);
        expect(res.body.boostCap == null).toBe(true);
    });

    test('leaves fields the request never mentioned alone', async () => {
        const res = await patch({ boostCap: 5 });
        expect(res.body.wager).toBe(20);
        expect(res.body.parlayOdds).toBe(398);
        expect(res.body.boostPct).toBe(20);
    });

    // Regression. Booleans and arrays coerce to numbers silently, and a
    // negative wager or boost would land in the season's net.
    test('refuses a value that is not a non-negative number', async () => {
        for (const body of [{ wager: -5 }, { boostPct: -150 }, { boostCap: true }, { parlayOdds: [] }]) {
            const res = await patch(body);
            expect(res.status).toBe(400);
        }
        const still = await request(adminApp).get(`/betting/${parlay._id}`);
        expect(still.body.wager).toBe(20);
    });

    test('refuses a non-admin', async () => {
        const res = await request(app).patch(`/betting/${parlay._id}`).send({ boostCap: 5 });
        expect(res.status).toBe(403);
    });
});

describe('PATCH /betting/:id/legs — correcting the odds', () => {
    let parlay;
    beforeEach(async () => {
        parlay = await Parlay.create({
            group: group._id, season: 2026, week: 3,
            legs: [{ contributor: MEMBER, gameId: 1, betType: 'moneyline', selection: 'LSU ML', teamSide: 'home', odds: -410, result: 'win' }]
        });
    });

    const patchLeg = body => request(adminApp)
        .patch(`/betting/${parlay._id}/legs`)
        .send(Object.assign({ contributor: MEMBER.toString() }, body));

    // Regression. The route blanket-reset result/resolvedAt on every leg patch.
    // That was tolerable when editing forced a full re-pick, but correcting the
    // odds is now one tap — and un-grading a settled leg left the parlay unable
    // to settle, with nothing in the UI to say why.
    test('keeps a graded result when only the odds change', async () => {
        const res = await patchLeg({ odds: -400 });

        expect(res.status).toBe(200);
        expect(res.body.legs[0].odds).toBe(-400);
        expect(res.body.legs[0].result).toBe('win');
    });

    test('re-grades when the pick itself changes', async () => {
        const res = await patchLeg({ selection: 'Bama ML', teamSide: 'away' });

        expect(res.status).toBe(200);
        expect(res.body.legs[0].result).toBe('pending');
    });

    test('refuses odds no board could have quoted', async () => {
        const res = await patchLeg({ odds: 45 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/\+100/);
    });
});

describe('PATCH /betting/:id/legs — alternate spreads', () => {
    let parlay;
    beforeEach(async () => {
        parlay = await Parlay.create({
            group: group._id, season: 2026, week: 3, wager: 20,
            legs: [{ contributor: MEMBER }]
        });
    });

    const patch = body => request(app)
        .patch(`/betting/${parlay._id}/legs`)
        .send({ contributor: MEMBER.toString(), gameId: 401856660, ...body });

    test('stores an alternate line off the book number as a real spread leg', async () => {
        const res = await patch({
            betType: 'spread', selection: 'LSU -6.5', line: -6.5, teamSide: 'home', odds: -181
        });

        expect(res.status).toBe(200);
        const leg = res.body.legs[0];
        expect(leg.betType).toBe('spread');
        expect(leg.line).toBe(-6.5);
        expect(leg.teamSide).toBe('home');
        expect(leg.result).toBe('pending');
    });

    // The whole point of the feature: these used to come in as betType 'custom',
    // which the resolver has no arithmetic for, so an admin graded them by hand.
    test('refuses a spread leg with no side, rather than storing one nothing can grade', async () => {
        const res = await patch({ betType: 'spread', selection: 'LSU -6.5', line: -6.5, odds: -181 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/team side/i);
    });

    test('refuses a spread leg with no line', async () => {
        const res = await patch({ betType: 'spread', selection: 'LSU', teamSide: 'home', odds: -110 });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/half-point/i);
    });

    test.each([
        ['a quarter point the board cannot produce', -6.25],
        ['a fat-fingered line', -750]
    ])('refuses %s', async (_label, line) => {
        const res = await patch({ betType: 'spread', selection: 'LSU', line, teamSide: 'home', odds: -110 });
        expect(res.status).toBe(400);
    });

    test('lets a later patch change only the odds without resupplying the line', async () => {
        await patch({ betType: 'spread', selection: 'LSU -6.5', line: -6.5, teamSide: 'home', odds: -181 });

        const res = await patch({ odds: -175 });

        expect(res.status).toBe(200);
        expect(res.body.legs[0].odds).toBe(-175);
        expect(res.body.legs[0].line).toBe(-6.5);
        expect(res.body.legs[0].teamSide).toBe('home');
    });

    test('leaves the other bet types alone', async () => {
        const res = await patch({ betType: 'moneyline', selection: 'LSU ML', teamSide: 'home', odds: -410 });

        expect(res.status).toBe(200);
        expect(res.body.legs[0].line).toBeUndefined();
        expect(res.body.legs[0].teamSide).toBe('home');
    });
});

// The weekly enrichment job calls this endpoint server-to-server: no Auth0
// session, identity carried by the X-Internal-Token header. It used to sit
// below `router.use(requireBettingGroupMember)`, which resolves the caller from
// req.effUser — so the job was refused with a 403 before its handler ever ran,
// on every run since the route existed. The failure was silent: a 403 is not a
// thrown error, so the job logged one line and reported success.
//
// Mounted on its own bare app because this route deliberately sits ABOVE the
// member gate, so the suite's effUser stub must not be in the way.
describe('POST /betting/retry-stat-legs', () => {
    const TOKEN = 'internal-token-for-tests';

    jest.mock('../modules/parlay-resolve', () => {
        const actual = jest.requireActual('../modules/parlay-resolve');
        return { ...actual, retryPendingStatLegs: jest.fn(() => Promise.resolve({ retried: 2, resolved: 1 })) };
    });
    const { retryPendingStatLegs } = require('../modules/parlay-resolve');

    // No effUser middleware: this is what a job's request actually looks like.
    const jobApp = express();
    jobApp.use(express.json());
    jobApp.use('/betting', bettingRouter);

    const OLD_ENV = process.env;
    beforeEach(() => {
        process.env = { ...OLD_ENV, INTERNAL_API_TOKEN: TOKEN, YEAR: '2026' };
        retryPendingStatLegs.mockClear();
    });
    afterEach(() => { process.env = OLD_ENV; });

    test('accepts the internal token from a session-less job', async () => {
        const res = await request(jobApp)
            .post('/betting/retry-stat-legs')
            .set('X-Internal-Token', TOKEN)
            .send({ season: 2026 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ retried: 2, resolved: 1 });
        expect(retryPendingStatLegs).toHaveBeenCalledWith(2026);
    });

    test('does not require betting-group membership to get through', async () => {
        // No active group at all — the member gate would 403 on this first.
        await BettingGroup.deleteMany({});
        const res = await request(jobApp)
            .post('/betting/retry-stat-legs')
            .set('X-Internal-Token', TOKEN)
            .send({ season: 2026 });

        expect(res.status).toBe(200);
    });

    test('falls back to the configured season when the body omits one', async () => {
        await request(jobApp)
            .post('/betting/retry-stat-legs')
            .set('X-Internal-Token', TOKEN)
            .send({});
        expect(retryPendingStatLegs).toHaveBeenCalledWith(2026);
    });

    test('still refuses a caller with neither a token nor an Admin session', async () => {
        const res = await request(jobApp).post('/betting/retry-stat-legs').send({ season: 2026 });
        expect(res.status).toBe(403);
        expect(retryPendingStatLegs).not.toHaveBeenCalled();
    });

    test('refuses a wrong token', async () => {
        const res = await request(jobApp)
            .post('/betting/retry-stat-legs')
            .set('X-Internal-Token', 'nope')
            .send({ season: 2026 });
        expect(res.status).toBe(403);
        expect(retryPendingStatLegs).not.toHaveBeenCalled();
    });

    test('an ordinary logged-in member is still not an admin', async () => {
        const memberApp = express();
        memberApp.use(express.json());
        memberApp.use((req, res, next) => {
            req.effUser = { user_metadata: { metadata: { userId: MEMBER.toString() }, roles: [] } };
            req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles: [] } } };
            next();
        });
        memberApp.use('/betting', bettingRouter);

        const res = await request(memberApp).post('/betting/retry-stat-legs').send({ season: 2026 });
        expect(res.status).toBe(403);
        expect(retryPendingStatLegs).not.toHaveBeenCalled();
    });
});

// GET /games/:season/:week reads the week's games to render a scoreboard row per
// game. It used to read them UNPROJECTED, which meant every field of every game
// — including wpSnapshots, one row appended per live-poller tick, and livePlays.
// Measured against production data:
//
//   week 1:  99 games, 1890KB, 21135ms   (wpSnapshots 1333KB)
//   week 2:  86 games, 3165KB, 33453ms   (wpSnapshots 2338KB)
//   week 3:  75 games,   52KB,   523ms   (not played yet)
//
// Worst for weeks already played, and it grows every game weekend: PR #423 cut
// the poller to 10s on 12 Sep, so week 2 was the first weekend polled at that
// cadence. Stepping back one week on the betting page took 22 seconds in prod.
describe('GET /betting/games/:season/:week', () => {
    // The assertion is on the QUERY. The route returns a shaped object, so the
    // response is identical whether it read nine fields or the whole document —
    // asserting on the body would guard nothing. Verified: this fails when the
    // projection is removed.
    it('projects the game read instead of hauling wpSnapshots and livePlays', async () => {
        const spy = jest.spyOn(Game, 'find');
        await request(app).get('/betting/games/2026/3');

        const projection = spy.mock.calls[0][1];
        expect(projection).toBeDefined();
        ['id', 'homeTeam', 'awayTeam', 'homeId', 'awayId', 'startDate',
         'completed', 'homePoints', 'awayPoints'].forEach(f => {
            expect(projection[f]).toBe(1);
        });
        // The two that made it slow must not be asked for.
        expect(projection.wpSnapshots).toBeUndefined();
        expect(projection.livePlays).toBeUndefined();
        spy.mockRestore();
    });

    it('still shapes each game the way the client reads it', async () => {
        await Game.create({
            id: 901, season: 2026, week: 3, seasonType: 'regular',
            startDate: '2026-09-19T00:00:00.000Z', startTimeTbd: false,
            neutralSite: false, conferenceGame: false,
            homeId: 1, homeTeam: 'Oregon', awayId: 2, awayTeam: 'Duke',
            homePoints: 31, awayPoints: 17, completed: true
        });
        const res = await request(app).get('/betting/games/2026/3');
        expect(res.status).toBe(200);
        const g = res.body.find(x => x.id === 901);
        expect(g).toMatchObject({
            id: 901, homeTeam: 'Oregon', awayTeam: 'Duke',
            homePoints: 31, awayPoints: 17, completed: true
        });
        expect(g).toHaveProperty('homeLogos');
        expect(g).toHaveProperty('dk');
    });
});
