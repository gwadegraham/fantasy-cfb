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

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // The schedule ingest also imports the season's roster (one billable
    // /teams/roster call, modules/hoops-roster.js). Unstubbed, every schedule
    // test here would spend a real call from the laptop. Its behaviour is
    // tested in HoopsRoster.spec.js; here it answers "nothing numbered yet".
    jest.spyOn(client, 'cbbdGet').mockImplementation(async (path) => {
        if (path === '/teams/roster') return { data: [], remainingCalls: null };
        throw new Error(`unexpected CBBD call ${path}`);
    });
});
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

// The week stamping had NO route-level coverage when it shipped — the calendar
// module was well tested and the route that uses it was not, which is how the
// origin-drift and stale-week bugs below got through a 98%-covered file. Line
// coverage was reassuring and wrong: the route tests EXECUTED resolveSeasonStart
// without ever asserting its result.
describe('the week stamped at ingest (#315)', () => {
    const cal = require('../modules/hoops-calendar');
    const on = (iso, over = {}) => game(Object.assign({ startDate: iso }, over));

    test('every ingested game carries its week', async () => {
        stubFetch({ games: [
            on('2026-11-02T05:00:00Z', { id: 1 }),   // Mon, week 1
            on('2026-11-08T23:00:00Z', { id: 2 }),   // Sun evening, still week 1
            on('2026-11-09T05:00:00Z', { id: 3 })    // Mon, week 2
        ] });
        await request(app).post('/hoops/games/2027/schedule').send({});
        const byId = Object.fromEntries((await HoopsGame.find({}).lean()).map(g => [g.id, g.week]));
        expect(byId).toEqual({ 1: 1, 2: 1, 3: 2 });
    });

    test('a Sunday-evening game is NOT pushed into the next week by UTC', async () => {
        // 2026-11-09T03:00Z is Monday in UTC and Sunday 22:00 in Eastern.
        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 }), on('2026-11-09T03:00:00Z', { id: 2 })] });
        await request(app).post('/hoops/games/2027/schedule').send({});
        expect((await HoopsGame.findOne({ id: 2 }).lean()).week).toBe(1);
    });

    // ⚠️ The origin can move, and the rows already stored are the ones that go wrong.
    test('a game earlier than anything stored RE-STAMPS the whole season', async () => {
        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 }), on('2026-11-10T05:00:00Z', { id: 2 })] });
        await request(app).post('/hoops/games/2027/schedule').send({});
        expect((await HoopsGame.findOne({ id: 1 }).lean()).week).toBe(1);

        // A game the week before turns up — an exhibition, or a late CBBD addition.
        stubFetch({ games: [on('2026-10-30T23:00:00Z', { id: 9 })] });
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });

        expect(res.body.restamped).toBeGreaterThan(0);
        const byId = Object.fromEntries((await HoopsGame.find({}).lean()).map(g => [g.id, g.week]));
        // Week 1 must hold exactly one slate, not two.
        expect(byId).toEqual({ 9: 1, 1: 2, 2: 3 });
    });

    test('ingesting the POSTSEASON first does not leave two week 1s', async () => {
        // The workflow this feature explicitly plans for: the bracket is
        // published later, and someone ingests it before re-running the season.
        stubFetch({ games: [on('2027-03-16T23:00:00Z', { id: 50 }), on('2027-04-05T23:00:00Z', { id: 51 })] });
        await request(app).post('/hoops/games/2027/schedule').send({ seasonType: 'postseason' });
        expect((await HoopsGame.findOne({ id: 50 }).lean()).week).toBe(1);   // wrong, but expected here

        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 })] });
        await request(app).post('/hoops/games/2027/schedule').send({});

        const weeks = (await HoopsGame.find({}).lean()).map(g => g.week).sort((a, b) => a - b);
        expect(new Set(weeks).size).toBe(weeks.length);   // no duplicate week 1
        expect((await HoopsGame.findOne({ id: 1 }).lean()).week).toBe(1);
        expect((await HoopsGame.findOne({ id: 50 }).lean()).week).toBe(20);
    });

    // Nothing can sit before week 1 — the anchor moves instead. This started as
    // a test that a pre-season game gets a null week, which failed because the
    // premise is impossible: re-anchoring is what happens, and it is better.
    test('a game moved earlier RE-ANCHORS the season rather than falling outside it', async () => {
        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 }), on('2026-11-10T05:00:00Z', { id: 2 })] });
        await request(app).post('/hoops/games/2027/schedule').send({});
        expect((await HoopsGame.findOne({ id: 2 }).lean()).week).toBe(2);

        // Rescheduled earlier than anything stored. The anchor moves to the
        // Monday of that week, and EVERY row is re-numbered — the moved game
        // becomes week 1 and the one that was week 1 becomes week 2.
        stubFetch({ games: [on('2026-10-20T23:00:00Z', { id: 2 })] });
        await request(app).post('/hoops/games/refresh').send({ season: 2027, start: '2026-10-19', end: '2026-10-21' });

        const byId = Object.fromEntries((await HoopsGame.find({}).lean()).map(g => [g.id, g.week]));
        expect(byId).toEqual({ 2: 1, 1: 3 });   // 19 Oct anchor: 20 Oct = wk1, 2 Nov = wk3
        // And no row is left carrying a week that no longer matches its date.
        expect(Object.values(byId).every(w => w >= 1)).toBe(true);
    });

    test('games ingested before weeks existed get numbered by the next refresh', async () => {
        // `moved` is false for them — the anchor has not changed, they simply
        // have no week. Without this a /refresh numbers only its own window and
        // leaves the rest of the season blank forever.
        await HoopsGame.create([
            { id: 90, season: 2027, seasonType: 'regular', startDate: new Date('2026-11-02T05:00:00Z'), status: 'scheduled' },
            { id: 91, season: 2027, seasonType: 'regular', startDate: new Date('2026-11-10T05:00:00Z'), status: 'scheduled' }
        ]);
        expect(await HoopsGame.countDocuments({ week: { $in: [null, undefined] } })).toBe(2);

        stubFetch({ games: [on('2026-11-17T05:00:00Z', { id: 92 })] });
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });

        expect(res.body.restamped).toBeGreaterThan(0);
        const byId = Object.fromEntries((await HoopsGame.find({}).lean()).map(g => [g.id, g.week]));
        expect(byId).toEqual({ 90: 1, 91: 2, 92: 3 });
    });

    // ⚠️ One dateless row used to destroy a season's numbering and return 200.
    test('a game with no startDate does not re-anchor the season', async () => {
        // Mongo sorts a missing field FIRST, so a dateless row became the
        // "earliest game", the DB read was skipped, and the anchor fell back to
        // the refresh window — unsetting the week on everything before it.
        // Reachable because bulkWrite does not run `required` validators.
        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 }), on('2026-11-10T05:00:00Z', { id: 2 })] });
        await request(app).post('/hoops/games/2027/schedule').send({});
        await HoopsGame.collection.insertOne({ id: 77, season: 2027, seasonType: 'regular', status: 'scheduled' });

        stubFetch({ games: [on('2026-12-21T05:00:00Z', { id: 3 })] });
        const res = await request(app).post('/hoops/games/refresh')
            .send({ season: 2027, start: '2026-12-21', end: '2026-12-22' });

        expect(res.status).toBe(200);
        const byId = Object.fromEntries((await HoopsGame.find({ id: { $ne: 77 } }).lean()).map(g => [g.id, g.week]));
        expect(byId).toEqual({ 1: 1, 2: 2, 3: 8 });
    });

    // ⚠️ A single typo'd year must not renumber a season.
    test('an implausible anchor jump is ignored, not applied', async () => {
        // CFBD has shipped a year typo in a calendar before; this job is
        // unattended. A season is ~26 weeks, so a jump implying a longer one is
        // a bad row rather than a long season.
        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 }), on('2026-11-10T05:00:00Z', { id: 2 })] });
        await request(app).post('/hoops/games/2027/schedule').send({});

        stubFetch({ games: [on('2025-11-03T05:00:00Z', { id: 99 })] });   // year typo
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });

        expect(res.status).toBe(200);
        const byId = Object.fromEntries((await HoopsGame.find({}).lean()).map(g => [g.id, g.week]));
        expect(byId[1]).toBe(1);   // the real season keeps its numbering
        expect(byId[2]).toBe(2);
        expect(byId[99] == null).toBe(true);   // and the bad row gets no week
    });

    // ⚠️ A FORWARD move was invisible: `moved` is computed before the write.
    test('postponing the season opener renumbers from the new opener', async () => {
        stubFetch({ games: [
            on('2026-11-02T05:00:00Z', { id: 1 }), on('2026-11-10T05:00:00Z', { id: 2 }), on('2026-11-17T05:00:00Z', { id: 3 })
        ] });
        await request(app).post('/hoops/games/2027/schedule').send({});

        stubFetch({ games: [on('2026-11-30T05:00:00Z', { id: 1 })] });   // opener postponed
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });

        expect(res.status).toBe(200);
        const byId = Object.fromEntries((await HoopsGame.find({}).lean()).map(g => [g.id, g.week]));
        // Week 1 must not be left empty, and the numbering must be a function
        // of the data rather than of ingest history.
        expect(byId).toEqual({ 2: 1, 3: 2, 1: 4 });
    });

    test('a Mongo failure while re-stamping does not hang or crash the request', async () => {
        // Express 4 does not route an async rejection and there is no
        // process-level handler, so an unguarded throw here sends NO response
        // and takes the dyno down. The games landed; only the numbering is
        // behind, so it reports rather than fails.
        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 })] });
        await request(app).post('/hoops/games/2027/schedule').send({});

        jest.spyOn(HoopsGame, 'find').mockImplementationOnce(() => { throw new Error('connection reset'); });
        stubFetch({ games: [on('2026-10-26T05:00:00Z', { id: 5 })] });
        const res = await request(app).post('/hoops/games/refresh').send({ season: 2027 });

        expect(res.status).toBe(200);
        expect(res.body.restampError).toMatch(/connection reset/);
    });

    test('a Mongo failure resolving the anchor is a 500, not a hang', async () => {
        jest.spyOn(HoopsGame, 'findOne').mockImplementationOnce(() => { throw new Error('anchor read failed'); });
        stubFetch({ games: [on('2026-11-02T05:00:00Z', { id: 1 })] });
        const res = await request(app).post('/hoops/games/2027/schedule').send({});
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/season anchor/);
    });

    test('the stored week always matches a weekBounds query', async () => {
        // The invariant the two halves of hoops-calendar must share. A
        // midnight-ET game in an EDT week used to fall outside its own bounds.
        stubFetch({ games: [
            on('2026-11-02T05:00:00Z', { id: 1 }),
            on('2027-03-15T04:00:00Z', { id: 2 }),   // midnight ET, EDT
            on('2027-04-05T04:00:00Z', { id: 3 })
        ] });
        await request(app).post('/hoops/games/2027/schedule').send({});

        const start = cal.seasonStartFrom(new Date('2026-11-02T05:00:00Z'));
        for (const g of await HoopsGame.find({}).lean()) {
            const b = cal.weekBounds(g.week, start);
            expect(g.startDate >= b.start && g.startDate < b.end).toBe(true);
        }
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
