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

// A row already in the database, in the shape buildUpsertOp writes.
const buildDoc = () => ({
    id: 900, season: 2027, seasonType: 'regular',
    startDate: new Date('2026-11-03T00:00:00Z'), status: 'scheduled'
});

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

describe('a partial bulkWrite', () => {
    // { ordered: false } still THROWS on a partial failure, but the successful
    // ops did write and err.result carries their counts. routes/games.js:897
    // works this out; the first version of this route did not, and would have
    // told the cron a run failed when it wrote 5,014 of 5,015 games.
    function bulkError({ upserted = 0, matched = 0, codes = [11000] }) {
        const err = new Error('E11000 duplicate key error collection: hoopsgames index: id_1');
        err.result = { upsertedCount: upserted, matchedCount: matched };
        err.writeErrors = codes.map(code => ({ code }));
        return err;
    }

    test('a duplicate-key loss to a concurrent run is a SUCCESS with real counts', async () => {
        stubFetch({ games: [game(), game({ id: 2 })] });
        jest.spyOn(HoopsGame, 'bulkWrite').mockRejectedValue(bulkError({ upserted: 1, codes: [11000] }));

        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ created: 1 });
    });

    test('a non-duplicate write error is a 500 that still reports what landed', async () => {
        stubFetch({ games: [game(), game({ id: 2 })] });
        jest.spyOn(HoopsGame, 'bulkWrite').mockRejectedValue(bulkError({ upserted: 1, codes: [121] }));

        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(500);
        // The counts go out with the failure: a partial write is not a no-op,
        // and the cron needs to know what landed before it retries.
        expect(res.body).toMatchObject({ created: 1 });
    });

    test('a batch that failed wholesale, with no writeErrors, is a 500', async () => {
        stubFetch({ games: [game()] });
        const err = new Error('connection timed out');
        jest.spyOn(HoopsGame, 'bulkWrite').mockRejectedValue(err);
        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/timed out/);
    });

    test('the same tolerance applies on /refresh', async () => {
        stubFetch({ games: [game()] });
        jest.spyOn(HoopsGame, 'bulkWrite').mockRejectedValue(bulkError({ upserted: 1, codes: [11000] }));
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });
        expect(res.status).toBe(200);
    });
});

describe('the guards on the route that runs unattended', () => {
    test('/refresh 422s when the stored schedule says games were due', async () => {
        // The ending-year trap would otherwise hide here for months: wired with
        // the FOOTBALL season number, every nightly refresh answers 200
        // {games: 0} from November to March and no score is ever ingested.
        await HoopsGame.create(Object.assign(buildDoc(), { id: 900, season: 2027,
            startDate: new Date('2026-11-03T00:00:00Z') }));
        stubFetch({ games: [] });

        const res = await request(app).post('/hoops/games/refresh')
            .send({ season: 2027, start: '2026-11-02', end: '2026-11-04' });
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({ expected: 1, returned: 0 });
        expect(res.body.message).toMatch(/ENDING year/);
    });

    test('but a genuinely quiet night with nothing scheduled is still a 200', async () => {
        stubFetch({ games: [] });
        const res = await request(app).post('/hoops/games/refresh')
            .send({ season: 2027, start: '2027-07-01', end: '2027-07-02' });
        expect(res.status).toBe(200);
    });

    test('/schedule 500s when games came back but none could be mapped', async () => {
        // CBBD renames `id`: every op is null. The unguarded bulkWrite threw
        // "Invalid BulkOperation, Batch cannot be empty", a cryptic 500 for
        // what is a field rename.
        stubFetch({ games: [{ season: 2027, homeTeam: 'Duke' }, { season: 2027 }] });
        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/none of which carried an id/);
    });

    test('/refresh reports what was WRITABLE, not what was fetched', async () => {
        // The one pair of numbers in this route that could report a healthy run
        // while nothing landed.
        stubFetch({ games: [{ season: 2027, status: 'final' }, game({ id: 5 })] });
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });
        expect(res.body).toMatchObject({ games: 1, fetched: 2, finals: 0 });
    });

    test('an over-wide refresh range is a 400 naming the reason', async () => {
        const e = new Error('Range 2000-01-01..2026-01-01 needs more than 16 30-day windows. '
            + '/games is billable; narrow the range.');
        e.rangeTooWide = true;
        jest.spyOn(client, 'fetchGamesInRange').mockRejectedValue(e);
        const res = await request(app).post('/hoops/games/refresh')
            .send({ season: 2027, start: '2000-01-01', end: '2026-01-01' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/billable/);
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
