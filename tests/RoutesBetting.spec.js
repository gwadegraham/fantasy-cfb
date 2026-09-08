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
