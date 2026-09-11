// HTTP-level tests for routes/seasons.js — the season rollover.
//
// Why this route exists at all: #312 moved the active season out of
// process.env.YEAR and into Mongo, and the boot seed deliberately never
// overwrites a stored season. Without a write path there would be NO way to
// roll the season over, and the old runbook pivot (set YEAR, restart) would
// silently do nothing while the app kept scoring last season. So the tests that
// matter most here are the ones about actually changing the season, and about
// refusing to change it in the destructive direction.
//
// The router is mounted on a bare Express app backed by in-memory Mongo.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const seasonsRouter = require('../routes/seasons');

// Admin is resolved through modules/dev-role effectiveRoles, which reads the
// OIDC user off the request. Fake one per test via a middleware switch.
let roles = [];
const app = express();
app.use(express.json());
app.use((req, res, next) => {
    // isAuthenticated() is required, not optional: modules/dev-role calls it
    // before reading roles. Omitting it threw inside the async handler, which
    // in Express 4 hangs the request instead of failing it.
    req.oidc = { isAuthenticated: () => true, user: { user_metadata: { roles } } };
    next();
});
app.use('/seasons', seasonsRouter);

useMongo();

beforeEach(() => {
    roles = ['Admin'];
    activeSeason._reset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('GET /seasons', () => {
    test('lists every sport and where it is in its year', async () => {
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: 2027, status: 'preseason' }
        ]);
        const res = await request(app).get('/seasons');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([
            { sport: 'basketball', season: 2027, status: 'preseason' },
            { sport: 'football', season: 2026, status: 'in-season' }
        ]);
    });

    test('one sport, which is the shape the standalone jobs consume', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        const res = await request(app).get('/seasons/football');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ sport: 'football', season: 2026 });
    });

    test('404 for a sport with nothing stored, so a job can tell the difference', async () => {
        const res = await request(app).get('/seasons/basketball');
        expect(res.status).toBe(404);
    });

    test('400 for a sport that is not a sport', async () => {
        const res = await request(app).get('/seasons/curling');
        expect(res.status).toBe(400);
    });
});

describe('PUT /seasons/:sport — the rollover', () => {
    test('moves the season forward and the cache reflects it without a restart', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        await activeSeason.prime();

        const res = await request(app).put('/seasons/football').send({ season: 2027, status: 'preseason' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: 2027, status: 'preseason' });
        // setActiveSeason re-primes this process — a rollover that needed a
        // deploy to take effect would be no better than the env var.
        expect(activeSeason.activeSeason('football')).toBe(2027);
    });

    test('creates a sport that has no row yet (how basketball gets its first season)', async () => {
        const res = await request(app).put('/seasons/basketball').send({ season: 2027, status: 'preseason' });
        expect(res.status).toBe(200);
        expect(await SportSeason.countDocuments({ sport: 'basketball' })).toBe(1);
    });

    test('refuses to move a season BACKWARDS without force', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        const res = await request(app).put('/seasons/football').send({ season: 2025 });
        // Going back makes the nightly job overwrite a finished season's scores,
        // and a typo is likelier than intent.
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/back from 2026 to 2025/);
        const row = await SportSeason.findOne({ sport: 'football' }).lean();
        expect(row.season).toBe(2026);
    });

    test('allows it with force, for a deliberate rollback', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        const res = await request(app).put('/seasons/football').send({ season: 2025, force: true });
        expect(res.status).toBe(200);
        expect(res.body.season).toBe(2025);
    });

    test('status alone, leaving the season where it is', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'preseason' });
        const res = await request(app).put('/seasons/football').send({ status: 'in-season' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: 2026, status: 'in-season' });
    });

    test('admin only — this decides which season scoring writes into', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        roles = ['League Manager'];
        const res = await request(app).put('/seasons/football').send({ season: 2027 });
        expect(res.status).toBe(403);
        const row = await SportSeason.findOne({ sport: 'football' }).lean();
        expect(row.season).toBe(2026);
    });

    test('rejects a season that is not a plausible year', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        for (const season of ['soon', 1999, 2101, 2026.5]) {
            const res = await request(app).put('/seasons/football').send({ season });
            expect(res.status).toBe(400);
        }
    });

    test('rejects an unknown status and an empty body', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        expect((await request(app).put('/seasons/football').send({ status: 'halftime' })).status).toBe(400);
        expect((await request(app).put('/seasons/football').send({})).status).toBe(400);
    });
});
