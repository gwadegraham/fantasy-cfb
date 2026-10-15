// POST /rankings/retrieveRankings — the lazy per-week poll ingest the scoring
// pipeline calls when a rankings doc is missing.
//
// Two things went wrong here, and both cost CFBD calls against a 1,000/month
// budget. CFBD answers `[]` for a poll it hasn't published yet, and reading
// `data[0].polls` off that threw a TypeError which surfaced as an opaque 400 —
// so the caller kept retrying it, one CFBD call at a time, for as long as the
// poll stayed unpublished. And the handler always INSERTED, so two runs racing on
// the same missing week (the Saturday job and the live poller collide on the :00
// mark) could each create a doc for it.
//
// The CFBD client is mocked; the route, model and Mongo are real.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Ranking = require('../models/ranking');

// cfb.js hangs getRankings off the INSTANCE, not the prototype, and the route
// constructs its own client at import — so the module is the only seam.
const mockGetRankings = jest.fn();
jest.mock('cfb.js', () => ({
    ApiClient: { instance: { authentications: { ApiKeyAuth: {} } } },
    RankingsApi: function RankingsApi() { this.getRankings = (...args) => mockGetRankings(...args); }
}));
const getRankings = mockGetRankings;

const rankingsRouter = require('../routes/rankings');
const app = express();
app.use(express.json());
app.use('/rankings', rankingsRouter);

useMongo();
// Build the unique index before the race test runs, rather than relying on
// mongoose's background build finishing in time.
beforeAll(() => Ranking.init());

const POLLS = [{ poll: 'AP Top 25', ranks: [{ school: 'Oregon', rank: 1 }] }];
const body = { season: '2026', seasonType: 'regular', week: '3' };
const send = () => request(app).post('/rankings/retrieveRankings').send(body);

beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { getRankings.mockReset(); jest.restoreAllMocks(); });

describe('POST /rankings/retrieveRankings', () => {
    test('stores a newly published poll', async () => {
        getRankings.mockResolvedValue([{ polls: POLLS }]);
        const res = await send();
        expect(res.status).toBe(201);
        expect(res.body.polls[0].poll).toBe('AP Top 25');
        expect(await Ranking.countDocuments()).toBe(1);
    });

    test('re-running updates in place instead of creating a second doc', async () => {
        getRankings.mockResolvedValue([{ polls: POLLS }]);
        await send();
        getRankings.mockResolvedValue([{ polls: [{ poll: 'AP Top 25', ranks: [{ school: 'Ohio State', rank: 1 }] }] }]);
        await send();

        expect(await Ranking.countDocuments()).toBe(1);
        const saved = await Ranking.findOne({ season: 2026, seasonType: 'regular', week: 3 }).lean();
        expect(saved.polls[0].ranks[0].school).toBe('Ohio State');
    });

    // The race: the Saturday job and the live poller both fire on the :00 mark,
    // and a missing week sends both of them here at once.
    test('two concurrent calls leave exactly one doc', async () => {
        getRankings.mockResolvedValue([{ polls: POLLS }]);
        const [a, b] = await Promise.all([send(), send()]);
        expect(a.status).toBe(201);
        expect(b.status).toBe(201);
        expect(await Ranking.countDocuments()).toBe(1);
    });

    // The race, forced rather than hoped for (the concurrent test above passes
    // most runs even with no index at all). The first upsert is replaced by:
    // the OTHER caller's doc landing, then this caller's insert of the same
    // week — which fails with E11000 only because the unique index exists.
    // The handler must retry onto the winner's doc and answer 201: not a 400,
    // and not a second doc.
    test('losing the race updates the winner\'s doc', async () => {
        getRankings.mockResolvedValue([{ polls: POLLS }]);
        const real = Ranking.findOneAndUpdate.bind(Ranking);
        let first = true;
        jest.spyOn(Ranking, 'findOneAndUpdate').mockImplementation((...args) => {
            if (!first) return real(...args);
            first = false;
            return Ranking.create({ season: 2026, seasonType: 'regular', week: 3, polls: [] })
                .then(() => Ranking.collection.insertOne({ season: 2026, seasonType: 'regular', week: 3 }));
        });
        const res = await send();
        expect(res.status).toBe(201);
        expect(res.body.polls[0].poll).toBe('AP Top 25');
        expect(await Ranking.countDocuments()).toBe(1);
    });

    // CFBD publishes no postseason poll until after the title game, so this is
    // what the pipeline used to hit on every single run all bowl season.
    test('says so when CFBD has not published the poll, instead of a bare 400', async () => {
        getRankings.mockResolvedValue([]);
        const res = await request(app).post('/rankings/retrieveRankings')
            .send({ season: '2026', seasonType: 'postseason', week: '1' });
        expect(res.status).toBe(404);
        expect(res.body.message).toMatch(/no rankings for season 2026 postseason week 1/i);
        expect(await Ranking.countDocuments()).toBe(0);
    });

    test('handles a row with no polls the same way', async () => {
        getRankings.mockResolvedValue([{}]);
        const res = await send();
        expect(res.status).toBe(404);
        expect(await Ranking.countDocuments()).toBe(0);
    });

    test('surfaces a CFBD failure as a 400', async () => {
        getRankings.mockRejectedValue(new Error('rate limited'));
        const res = await send();
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/rate limited/);
    });
});

// Postseason scoring needs the poll as it stood going INTO the bowls — the final
// regular-season doc, which is where CFBD publishes the selection-day Playoff
// Committee Rankings. Before this the engine asked for week 1 of the regular
// season: the AUGUST PRESEASON poll, published before a game had been played.
describe('GET /rankings/:season/latest/:seasonType', () => {
    const poll = (school) => [{ poll: 'Playoff Committee Rankings', ranks: [{ school, rank: 1 }] }];

    beforeEach(async () => {
        await Ranking.create([
            { season: 2025, seasonType: 'regular', week: 1, polls: [{ poll: 'AP Top 25', ranks: [{ school: 'Preseason No1', rank: 1 }] }] },
            { season: 2025, seasonType: 'regular', week: 15, polls: poll('Ohio State') },
            { season: 2025, seasonType: 'regular', week: 16, polls: poll('Indiana') },
            { season: 2025, seasonType: 'postseason', week: 1, polls: [{ poll: 'AP Top 25', ranks: [{ school: 'Final AP No1', rank: 1 }] }] },
            { season: 2024, seasonType: 'regular', week: 16, polls: poll('Oregon') }
        ]);
    });

    test('returns the highest week on file, not the first', async () => {
        const res = await request(app).get('/rankings/2025/latest/regular');
        expect(res.status).toBe(200);
        expect(res.body.week).toBe(16);
        expect(res.body.polls[0].ranks[0].school).toBe('Indiana');   // selection-day CFP, not the August AP
    });

    test('is scoped to the season and seasonType asked for', async () => {
        expect((await request(app).get('/rankings/2024/latest/regular')).body.week).toBe(16);
        expect((await request(app).get('/rankings/2024/latest/regular')).body.polls[0].ranks[0].school).toBe('Oregon');
        expect((await request(app).get('/rankings/2025/latest/postseason')).body.week).toBe(1);
    });

    test('an explicit week still wins over the latest', async () => {
        const res = await request(app).get('/rankings/2025/1/regular');
        expect(res.body.week).toBe(1);
        expect(res.body.polls[0].ranks[0].school).toBe('Preseason No1');
    });

    test('400s when the season has nothing on file', async () => {
        const res = await request(app).get('/rankings/2099/latest/regular');
        expect(res.status).toBe(400);
    });
});

// POST /rankings/:season/refresh — the admin's whole-season pull. It writes
// the same per-week docs as retrieveRankings, so it races it on the same
// unique index.
describe('POST /rankings/:season/refresh', () => {
    const CFBD = [
        { season: 2026, seasonType: 'regular', week: 3, polls: POLLS },
        { season: 2026, seasonType: 'regular', week: 4, polls: POLLS }
    ];
    beforeEach(() => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CFBD) }));
    });
    afterEach(() => { delete global.fetch; });
    const refresh = () => request(app).post('/rankings/2026/refresh');

    test('inserts new weeks and updates existing ones', async () => {
        await Ranking.create({ season: 2026, seasonType: 'regular', week: 3, polls: [] });
        const res = await refresh();
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ weeks: 2, created: 1, updated: 1 });
        expect(await Ranking.countDocuments()).toBe(2);
        const wk3 = await Ranking.findOne({ week: 3 }).lean();
        expect(wk3.polls[0].poll).toBe('AP Top 25');
    });

    // retrieveRankings inserts week 3 between this pass's read and its write.
    // That used to throw E11000 out of the loop: a 500, with week 4 never
    // written.
    test('a week inserted mid-pass is updated, and the pass carries on', async () => {
        // The winner lands just before this pass's first write, whichever way
        // the pass writes: an insert (save) collides outright; an upsert
        // (updateOne) is made to collide by forcing the duplicate insert.
        const winner = () => Ranking.collection.insertOne({ season: 2026, seasonType: 'regular', week: 3, polls: [] });
        const realSave = Ranking.prototype.save;
        let saved = false;
        jest.spyOn(Ranking.prototype, 'save').mockImplementation(function (...args) {
            if (saved) return realSave.apply(this, args);
            saved = true;
            return winner().then(() => realSave.apply(this, args));
        });
        const real = Ranking.updateOne.bind(Ranking);
        let first = true;
        jest.spyOn(Ranking, 'updateOne').mockImplementation((...args) => {
            if (!first) return real(...args);
            first = false;
            return Ranking.create({ season: 2026, seasonType: 'regular', week: 3, polls: [] })
                .then(() => Ranking.collection.insertOne({ season: 2026, seasonType: 'regular', week: 3 }));
        });
        const res = await refresh();
        expect(res.status).toBe(201);
        expect(await Ranking.countDocuments()).toBe(2);
        expect((await Ranking.findOne({ week: 3 }).lean()).polls[0].poll).toBe('AP Top 25');
        expect(await Ranking.exists({ week: 4 })).toBeTruthy();
    });
});
