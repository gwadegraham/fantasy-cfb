// HTTP-level tests for routes/playoffs.js against an in-memory Mongo. The read
// endpoint runs for real; the refresh endpoint's single network seam — the
// global fetch — is stubbed with the REAL CFBD payload from tests/fixtures, so
// the handler is exercised end to end without touching
// collegefootballdata.com.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const CfpBracket = require('../models/cfpBracket');
const playoffsRouter = require('../routes/playoffs');

const raw2025 = require('./fixtures/cfp-bracket-2025.json');
const clone = (o) => JSON.parse(JSON.stringify(o));

const app = express();
app.use(express.json());
app.use('/playoffs', playoffsRouter);

useMongo();

function fetchWith(body, { ok = true, status = 200 } = {}) {
    return jest.fn(() => Promise.resolve({
        ok: ok, status: status,
        json: () => Promise.resolve(body)
    }));
}

const realFetch = global.fetch;
beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

describe('GET /playoffs/cfp/:season', () => {
    test('returns the stored bracket', async () => {
        await CfpBracket.create({
            season: 2025, format: 'twelve_team_2025',
            games: [{ gameId: 401769072, round: 'quarterfinal' }]
        });
        const res = await request(app).get('/playoffs/cfp/2025');
        expect(res.status).toBe(200);
        expect(res.body.season).toBe(2025);
        expect(res.body.games[0].gameId).toBe(401769072);
    });

    test('404s when no bracket is on file for the season', async () => {
        const res = await request(app).get('/playoffs/cfp/2019');
        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/No CFP bracket found/);
    });

    test('a malformed season is a 400, not a Mongo cast failure', async () => {
        const res = await request(app).get('/playoffs/cfp/latest');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid season');
    });

    test('a failed read is a 500', async () => {
        jest.spyOn(CfpBracket, 'findOne').mockRejectedValue(new Error('db down'));
        const res = await request(app).get('/playoffs/cfp/2025');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('db down');
    });
});

describe('POST /playoffs/cfp/:season/refresh', () => {
    test('ingests the real CFBD payload in one call', async () => {
        global.fetch = fetchWith(raw2025);

        const res = await request(app).post('/playoffs/cfp/2025/refresh');
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ season: 2025, created: true, games: 11, participants: 12, status: 'completed' });

        // One CFBD call, to the parent endpoint (NOT /playoffs/cfp/games).
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe('https://api.collegefootballdata.com/playoffs/cfp?year=2025');

        const stored = await CfpBracket.findOne({ season: 2025 }).lean();
        expect(stored.games).toHaveLength(11);
        const qf1 = stored.games.find(g => g.gameId === 401769072);
        expect(qf1.round).toBe('quarterfinal');
        expect(qf1.teams.find(t => t.teamId === 84).firstRoundBye).toBe(true);
        expect(stored.retrievedAt).toBeInstanceOf(Date);
    });

    test('re-running replaces the snapshot instead of duplicating it', async () => {
        global.fetch = fetchWith(raw2025);
        await request(app).post('/playoffs/cfp/2025/refresh');

        // Second run mid-tournament: the championship hasn't been played yet.
        const partial = clone(raw2025);
        partial.status = 'in_progress';
        partial.champion = null;
        partial.rounds.find(r => r.code === 'championship').matchups[0].game = null;
        global.fetch = fetchWith(partial);

        const res = await request(app).post('/playoffs/cfp/2025/refresh');
        expect(res.status).toBe(201);
        expect(res.body.created).toBe(false);
        expect(await CfpBracket.countDocuments({ season: 2025 })).toBe(1);

        const stored = await CfpBracket.findOne({ season: 2025 }).lean();
        expect(stored.status).toBe('in_progress');
        expect(stored.games).toHaveLength(10);
        expect(stored.champion).toBeUndefined();
    });

    // `maxAgeHours` throttles the scheduled callers. Without it every caller of
    // runFullUpdate re-pulls — including the live poller, every 10 minutes.
    describe('maxAgeHours throttle', () => {
        test('skips the CFBD call when the stored bracket is fresh', async () => {
            global.fetch = fetchWith(raw2025);
            await request(app).post('/playoffs/cfp/2025/refresh');
            global.fetch = fetchWith(raw2025);   // fresh spy

            const res = await request(app).post('/playoffs/cfp/2025/refresh').send({ maxAgeHours: 24 });
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ season: 2025, skipped: true, reason: 'fresh' });
            expect(res.body.ageHours).toBeLessThan(1);
            expect(global.fetch).not.toHaveBeenCalled();
        });

        test('re-pulls once the stored bracket is older than the window', async () => {
            global.fetch = fetchWith(raw2025);
            await request(app).post('/playoffs/cfp/2025/refresh');
            await CfpBracket.updateOne({ season: 2025 },
                { retrievedAt: new Date(Date.now() - 25 * 3600000) });
            global.fetch = fetchWith(raw2025);

            const res = await request(app).post('/playoffs/cfp/2025/refresh').send({ maxAgeHours: 24 });
            expect(res.status).toBe(201);
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        test('a hand-run refresh (no maxAgeHours) is never skipped', async () => {
            global.fetch = fetchWith(raw2025);
            await request(app).post('/playoffs/cfp/2025/refresh');
            global.fetch = fetchWith(raw2025);

            const res = await request(app).post('/playoffs/cfp/2025/refresh');
            expect(res.status).toBe(201);
            expect(global.fetch).toHaveBeenCalledTimes(1);
        });

        test('a nonsense maxAgeHours does not throttle', async () => {
            global.fetch = fetchWith(raw2025);
            await request(app).post('/playoffs/cfp/2025/refresh');

            for (const bad of [{ maxAgeHours: 'soon' }, { maxAgeHours: 0 }, { maxAgeHours: -5 }]) {
                global.fetch = fetchWith(raw2025);
                const res = await request(app).post('/playoffs/cfp/2025/refresh').send(bad);
                expect(res.status).toBe(201);
                expect(global.fetch).toHaveBeenCalledTimes(1);
            }
        });

        test('nothing stored yet means nothing to skip', async () => {
            global.fetch = fetchWith(raw2025);
            const res = await request(app).post('/playoffs/cfp/2025/refresh').send({ maxAgeHours: 24 });
            expect(res.status).toBe(201);
            expect(res.body.created).toBe(true);
        });
    });

    test('a rejected bracket is a 400 and leaves the stored one alone', async () => {
        global.fetch = fetchWith(raw2025);
        await request(app).post('/playoffs/cfp/2025/refresh');

        // Two CFBD signals now disagree about who had a bye.
        const contradictory = clone(raw2025);
        contradictory.participants.find(p => p.team.id === 84).firstRoundBye = false;
        global.fetch = fetchWith(contradictory);

        const res = await request(app).post('/playoffs/cfp/2025/refresh');
        expect(res.status).toBe(400);
        expect(res.body.rejected).toBe(true);
        expect(res.body.message).toMatch(/not flagged firstRoundBye/);

        const stored = await CfpBracket.findOne({ season: 2025 }).lean();
        expect(stored.games).toHaveLength(11);   // the good snapshot survived
    });

    test('an unpublished bracket is a 400, not a stored empty one', async () => {
        const empty = clone(raw2025);
        empty.status = 'scheduled';
        empty.rounds.forEach(r => r.matchups.forEach(m => { m.game = null; }));
        global.fetch = fetchWith(empty);

        const res = await request(app).post('/playoffs/cfp/2026/refresh');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/no scheduled games yet/);
        expect(await CfpBracket.countDocuments({ season: 2026 })).toBe(0);
    });

    test('stores under the requested season, not the one CFBD echoes', async () => {
        const wrongYear = clone(raw2025);
        wrongYear.season = 1999;
        global.fetch = fetchWith(wrongYear);

        await request(app).post('/playoffs/cfp/2025/refresh');
        expect(await CfpBracket.countDocuments({ season: 1999 })).toBe(0);
        expect(await CfpBracket.countDocuments({ season: 2025 })).toBe(1);
    });

    test('rejects a malformed season without spending a CFBD call', async () => {
        global.fetch = fetchWith(raw2025);
        const res = await request(app).post('/playoffs/cfp/20x5/refresh');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Invalid season');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('surfaces a CFBD failure as a 400 with its message', async () => {
        global.fetch = fetchWith({ message: 'Unauthorized' }, { ok: false, status: 401 });
        const res = await request(app).post('/playoffs/cfp/2025/refresh');
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Unauthorized');
    });

    test('a CFBD failure with no message body still reports the status', async () => {
        global.fetch = fetchWith(null, { ok: false, status: 503 });
        const res = await request(app).post('/playoffs/cfp/2025/refresh');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/CFBD request failed \(503\)/);
    });

    test('a thrown fetch is a 500', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('socket hang up')));
        const res = await request(app).post('/playoffs/cfp/2025/refresh');
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('socket hang up');
    });
});
