// Basketball schedule and score ingest (#314, Hardwood B1).
//
// Three of these exist because the live API was probed before the code was
// written, and it disagreed with the obvious assumptions in three places. Each
// trap gets a test that fails if the guard is removed.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const HoopsGame = require('../models/hoopsGame');
const hoopsRouter = require('../routes/hoopsGames');
const client = require('../modules/cbbd-client');

const app = express();
app.use(express.json());
app.use('/hoops/games', hoopsRouter);

useMongo();

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

// A CBBD row, exactly as the live API shapes one.
const game = (over = {}) => Object.assign({
    id: 374580, sourceId: '401918976', seasonLabel: '20262027', season: 2027,
    seasonType: 'regular', tournament: null,
    startDate: '2026-11-03T00:00:00.000Z', startTimeTbd: false,
    neutralSite: false, conferenceGame: false, gameType: 'STD',
    status: 'scheduled', gameNotes: null, attendance: null,
    homeTeamId: 74, homeTeam: 'East Carolina', homeConferenceId: 5, homeConference: 'American',
    homeSeed: null, homePoints: 0, homePeriodPoints: null, homeWinner: null,
    homeTeamEloStart: null, homeTeamEloEnd: null,
    awayTeamId: 268, awayTeam: 'South Carolina Upstate', awayConferenceId: 9, awayConference: 'Big South',
    awaySeed: null, awayPoints: 0, awayPeriodPoints: null, awayWinner: null,
    awayTeamEloStart: null, awayTeamEloEnd: null,
    excitement: null, venueId: 1, venue: 'Minges Coliseum', city: 'Greenville', state: 'NC'
}, over);

const final = (over = {}) => game(Object.assign({
    status: 'final', homePoints: 117, awayPoints: 55,
    homePeriodPoints: [67, 50], awayPeriodPoints: [30, 25],
    homeWinner: true, awayWinner: false
}, over));

// Stub the client rather than the network: what is under test is the route's
// handling of what CBBD returns, and the shapes above were taken from the real
// API rather than imagined.
function stubFetch(result) {
    return jest.spyOn(client, 'fetchGamesInRange').mockResolvedValue(Object.assign(
        { games: [], windows: 1, remainingCalls: 28903, capHits: [] }, result));
}

describe('buildUpsertOp — the shape traps', () => {
    const build = hoopsRouter.buildUpsertOp;

    // ⚠️ The one that would have been missed by reading the football code.
    test('a SCHEDULED game stores no points, because CBBD sends 0 not null', () => {
        const op = build(game());
        expect(op.updateOne.update.$set.homePoints).toBeUndefined();
        expect(op.updateOne.update.$set.awayPoints).toBeUndefined();
        expect(op.updateOne.update.$set.status).toBe('scheduled');
    });

    test('a FINAL game stores its points', () => {
        const op = build(final());
        expect(op.updateOne.update.$set).toMatchObject({ homePoints: 117, awayPoints: 55, homeWinner: true });
    });

    test('a genuine 0-0 final would still store zeros', () => {
        // Guarding on `status`, not on truthiness — an actual 0-0 result is
        // absurd in basketball but the rule must be about the status field, or
        // it is the same bug with a different threshold.
        const op = build(final({ homePoints: 0, awayPoints: 0 }));
        expect(op.updateOne.update.$set.homePoints).toBe(0);
    });

    test('sourceId stays a string', () => {
        // It is the ESPN id and doubles as the CFBD logo CDN key. Coercing to a
        // number would drop a leading zero silently.
        expect(build(game({ sourceId: '0401918976' })).updateOne.update.$set.sourceId).toBe('0401918976');
    });

    test('upserts on the CBBD id, so re-running is safe', () => {
        expect(build(game()).updateOne.filter).toEqual({ id: 374580 });
        expect(build(game()).updateOne.upsert).toBe(true);
    });

    test('a row with no id is skipped rather than written', () => {
        expect(build({ season: 2027 })).toBeNull();
        expect(build(null)).toBeNull();
    });

    test('unknown CBBD fields are not stored', () => {
        // $set of the mapped fields, not the raw row: a field CBBD adds later
        // should arrive as a deliberate schema change, not as silent drift.
        const op = build(game({ someNewFieldCbbdAdded: 'surprise' }));
        expect(op.updateOne.update.$set.someNewFieldCbbdAdded).toBeUndefined();
    });
});

describe('POST /:season/schedule', () => {
    test('ingests and reports counts off the write result', async () => {
        stubFetch({ games: [game(), game({ id: 2, homeTeam: 'Duke' })], windows: 8 });
        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ season: 2027, created: 2, updated: 0, games: 2, windows: 8 });
        expect(await HoopsGame.countDocuments({})).toBe(2);
    });

    test('re-running updates in place rather than duplicating', async () => {
        stubFetch({ games: [game()] });
        await request(app).post('/hoops/games/2027/schedule').send({});
        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.body).toMatchObject({ created: 0, updated: 1 });
        expect(await HoopsGame.countDocuments({})).toBe(1);
    });

    // ⚠️ The 3,000-record cap.
    test('a window at the cap FAILS the ingest instead of reporting success', async () => {
        // Measured on the live API: one call for 2025-26 returns exactly 3000
        // rows ending 6 Jan, while the paged fetch returns 6,079 ending 15 Mar.
        // More than half the season, lost, on a response that looks fine.
        stubFetch({ games: [game()], capHits: ['2025-11-01..2025-11-30'] });
        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/cap/i);
        expect(await HoopsGame.countDocuments({})).toBe(0);
    });

    // ⚠️ The off-by-one season.
    test('an empty season is a FAILURE, not an empty schedule', async () => {
        // CBBD numbers a split season by its ENDING year: 2026-27 is season
        // 2027. season=2026 returns HTTP 200 and [] — verified live. Without
        // this guard the wrong number is a green ingest that wrote nothing.
        stubFetch({ games: [] });
        const res = await request(app).post('/hoops/games/2026/schedule').send({});
        expect(res.status).toBe(422);
        expect(res.body.message).toMatch(/ENDING year/);
    });

    test('an unreachable CBBD is a 502, not a crash', async () => {
        // fetch REJECTS on a network failure and Express 4 does not route an
        // async handler's rejection, so an unguarded throw takes the dyno down.
        const e = new Error('Could not reach CBBD: socket hang up'); e.unreachable = true;
        jest.spyOn(client, 'fetchGamesInRange').mockRejectedValue(e);
        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(502);
    });

    test('a CBBD error status is a 400', async () => {
        const e = new Error('CBBD /games 401: unauthorized'); e.status = 401;
        jest.spyOn(client, 'fetchGamesInRange').mockRejectedValue(e);
        expect((await request(app).post('/hoops/games/2027/schedule').send({})).status).toBe(400);
    });

    test('a non-numeric season is refused before any fetch', async () => {
        const spy = stubFetch({ games: [game()] });
        expect((await request(app).post('/hoops/games/not-a-year/schedule').send({})).status).toBe(400);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('POST /refresh', () => {
    test('writes finals and reports how many were final', async () => {
        stubFetch({ games: [final(), game({ id: 3 })] });
        const res = await request(app).post('/hoops/games/refresh')
            .send({ season: 2027, start: '2026-11-03', end: '2026-11-04' });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ games: 2, finals: 1, created: 2 });
        expect((await HoopsGame.findOne({ id: 374580 }).lean()).homePoints).toBe(117);
        expect((await HoopsGame.findOne({ id: 3 }).lean()).homePoints).toBeUndefined();
    });

    test('a quiet night is a success, unlike an empty season', async () => {
        // The empty guard belongs on the whole-season pull, where empty can only
        // mean the season number is wrong. A refresh window with no games is an
        // ordinary Tuesday in April.
        stubFetch({ games: [] });
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ games: 0, created: 0, updated: 0 });
    });

    test('a missing or non-numeric season is refused', async () => {
        expect((await request(app).post('/hoops/games/refresh').send({})).status).toBe(400);
        expect((await request(app).post('/hoops/games/refresh').send({ season: 'x' })).status).toBe(400);
    });

    test('an inverted range is refused', async () => {
        const res = await request(app).post('/hoops/games/refresh')
            .send({ season: 2027, start: '2026-11-05', end: '2026-11-01' });
        expect(res.status).toBe(400);
    });
});

describe('the client', () => {
    test('seasonRange starts in the PREVIOUS calendar year', () => {
        // Because CBBD numbers a split season by its ending year. Starting in
        // the season year would miss November and December entirely — the
        // busiest two months of the schedule.
        const { start, end } = client.seasonRange(2027);
        expect(start.toISOString().slice(0, 10)).toBe('2026-10-01');
        expect(end.toISOString().slice(0, 10)).toBe('2027-04-30');
    });
});
