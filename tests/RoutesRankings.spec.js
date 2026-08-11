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
