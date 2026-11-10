// Games CBBD has dropped are pruned after a clean pull
// (modules/hoops-prune-dropped.js, wired into routes/hoopsGames.js).
//
// On 10 Nov 2026 eight Tulsa women's games CBBD had once filed under the
// men's team, and since dropped, blocked H2H week 1 from settling: the import
// only ever upserted. What these pin down is the other half — that a BAD pull
// never deletes, and a played or referenced game is never deleted at all.
//
// cbbd.fetchGamesInRange is always stubbed: jest loads the real .env, and an
// unstubbed call would bill the shared pool.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const HoopsGame = require('../models/hoopsGame');
const HoopsBoxScore = require('../models/hoopsBoxScore');
const HoopsShots = require('../models/hoopsShots');
const Franchise = require('../models/franchise');
const User = require('../models/user');
const hoopsGames = require('../routes/hoopsGames');
const cbbd = require('../modules/cbbd-client');
const prune = require('../modules/hoops-prune-dropped');

useMongo();

const SEASON = 2027;
const START = new Date('2026-11-10T00:00:00Z');
const END = new Date('2026-11-12T00:00:00Z');
const IN = '2026-11-11T00:00:00Z';

const stored = (id, iso = IN, o = {}) => Object.assign({
    id, season: SEASON, seasonType: 'regular', startDate: new Date(iso), status: 'scheduled', week: 1,
    homeTeamId: 1, homeTeam: 'Tulsa', awayTeamId: 2, awayTeam: 'Rice'
}, o);
const cbbdGame = (id, iso = IN, o = {}) => Object.assign({
    id, season: SEASON, seasonLabel: '20262027', seasonType: 'regular', startDate: iso, startTimeTbd: false,
    status: 'scheduled', homeTeamId: 1, homeTeam: 'Tulsa', awayTeamId: 2, awayTeam: 'Rice', homePoints: 0, awayPoints: 0
}, o);

function stubFetch(result) {
    return jest.spyOn(cbbd, 'fetchGamesInRange').mockImplementation(async () => {
        if (result instanceof Error) throw result;
        return Object.assign({ games: [], windows: 1, remainingCalls: 29000, capHits: [] }, result);
    });
}
const refresh = () => hoopsGames.refreshResults({ season: SEASON, seasonType: 'regular', start: START, end: END });
const ids = async () => (await HoopsGame.find({}, { id: 1, _id: 0 }).sort({ id: 1 }).lean()).map(g => g.id);

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the nightly / look-ahead refresh', () => {
    test('a stored game CBBD no longer lists is deleted, and named in the answer', async () => {
        await HoopsGame.create([stored(1), stored(2, IN, { homeTeam: 'Southern Utah', awayTeam: 'Bethesda' })]);
        stubFetch({ games: [cbbdGame(1), cbbdGame(3)] });

        const out = await refresh();

        expect(out.code).toBe(200);
        expect(await ids()).toEqual([1, 3]);
        expect(out.body.prune).toEqual({
            pruned: [{ id: 2, matchup: 'Bethesda @ Southern Utah', date: '2026-11-11' }], kept: [], refused: null
        });
        expect(prune.pruneNote(out.body.prune)).toBe('pruned 1 dropped by CBBD: 2 Bethesda @ Southern Utah 2026-11-11');
    });

    test('a failed pull deletes nothing', async () => {
        await HoopsGame.create([stored(1), stored(2)]);
        stubFetch(Object.assign(new Error('Could not reach CBBD'), { unreachable: true }));

        const out = await refresh();

        expect(out.code).toBe(502);
        expect(await ids()).toEqual([1, 2]);
    });

    test('a cap hit deletes nothing, though the partial answer lacks the game', async () => {
        await HoopsGame.create([stored(1), stored(2)]);
        stubFetch({ games: [cbbdGame(1)], capHits: ['2026-11-10..2026-11-12'] });

        const out = await refresh();

        expect(out.code).toBe(500);
        expect(await ids()).toEqual([1, 2]);
    });

    test('an empty answer while games are due deletes nothing', async () => {
        await HoopsGame.create([stored(1), stored(2)]);
        stubFetch({ games: [] });

        const out = await refresh();

        expect(out.code).toBe(422);
        expect(await ids()).toEqual([1, 2]);
    });

    test('a failed write deletes nothing', async () => {
        await HoopsGame.create([stored(1), stored(2)]);
        stubFetch({ games: [cbbdGame(1)] });
        jest.spyOn(HoopsGame, 'bulkWrite').mockRejectedValue(new Error('connection reset'));

        const out = await refresh();

        expect(out.code).toBe(500);
        expect(await ids()).toEqual([1, 2]);
    });

    test('a played or live game is never deleted, even once CBBD drops it', async () => {
        await HoopsGame.create([
            stored(1),
            stored(2, IN, { status: 'final', homePoints: 70, awayPoints: 60 }),
            stored(3, IN, { status: 'in_progress' }),
            // Points on a non-final row: something wrote a score, so keep it.
            stored(4, IN, { status: 'scheduled', homePoints: 31, awayPoints: 28 })
        ]);
        stubFetch({ games: [cbbdGame(1)] });

        const out = await refresh();

        expect(out.code).toBe(200);
        expect(await ids()).toEqual([1, 2, 3, 4]);
        expect(out.body.prune.pruned).toEqual([]);
    });

    test('a final with no points stored is still never deleted', async () => {
        await HoopsGame.create([stored(1), stored(2, IN, { status: 'final' })]);
        stubFetch({ games: [cbbdGame(1)] });

        await refresh();

        expect(await ids()).toEqual([1, 2]);
    });

    test('a game that goes live between the read and the delete survives', async () => {
        await HoopsGame.create([stored(1), stored(2)]);
        stubFetch({ games: [cbbdGame(1)] });
        // The reference lookups run between the two; tip the game off there.
        const real = HoopsBoxScore.distinct.bind(HoopsBoxScore);
        jest.spyOn(HoopsBoxScore, 'distinct').mockImplementation(async (...a) => {
            await HoopsGame.updateOne({ id: 2 }, { $set: { status: 'in_progress' } });
            return real(...a);
        });

        await refresh();

        expect(await ids()).toEqual([1, 2]);
    });

    // CBBD keeps a TBD game at midnight Eastern; ESPN gave us the real (late)
    // tip, which lands on the NEXT UTC day. A pull starting that UTC day does
    // not ask CBBD for the placeholder, so the game is "missing" — wrongly.
    test('an ESPN-timed row whose CBBD placeholder sits before the pulled window is not judged', async () => {
        await HoopsGame.create([
            stored(1),
            // Eastern day 10 Nov: placeholder 05:00Z on the 10th, ESPN tip 22:00 ET = 03:00Z on the 11th.
            stored(2, '2026-11-11T03:00:00Z', { startTimeSource: 'espn' }),
            // Same time, CBBD's own (not ESPN's): judged as usual.
            stored(3, '2026-11-11T03:00:00Z')
        ]);
        stubFetch({ games: [cbbdGame(1)] });

        const out = await hoopsGames.refreshResults({ season: SEASON, seasonType: 'regular',
            start: new Date('2026-11-11T01:00:00Z'), end: END });

        expect(await ids()).toEqual([1, 2]);
        expect(out.body.prune.pruned.map(g => g.id)).toEqual([3]);
    });

    test('an ESPN-timed row IS judged once the pull reaches back to its placeholder', async () => {
        await HoopsGame.create([stored(1), stored(2, '2026-11-11T03:00:00Z', { startTimeSource: 'espn' })]);
        stubFetch({ games: [cbbdGame(1)] });

        await refresh();   // from 10 Nov 00:00Z: CBBD was asked for the 10th

        expect(await ids()).toEqual([1]);
    });

    test('only the window, season and season type just pulled are touched', async () => {
        await HoopsGame.create([
            stored(1),
            stored(2, '2026-11-09T23:59:00Z'), // a minute before the window
            stored(3, '2026-11-12T00:01:00Z'), // a minute after it
            stored(4, IN, { seasonType: 'postseason' }),
            stored(5, IN, { season: 2026 })
        ]);
        stubFetch({ games: [cbbdGame(1)] });

        const out = await refresh();

        expect(out.code).toBe(200);
        expect(await ids()).toEqual([1, 2, 3, 4, 5]);
    });

    test('a game CBBD still lists is kept, however odd (the double listings #512 hides)', async () => {
        await HoopsGame.create([stored(1), stored(2, IN, { homeTeam: 'Towson', awayTeam: 'Morgan State' })]);
        stubFetch({ games: [cbbdGame(1), cbbdGame(2, IN, { homeTeam: 'Towson', awayTeam: 'Morgan State' })] });

        await refresh();

        expect(await ids()).toEqual([1, 2]);
    });
});

describe('references keep a row', () => {
    test('scored weekly rows, box scores, shot charts and sent alerts each keep their game', async () => {
        await HoopsGame.create([
            stored(1), stored(10), stored(11), stored(12), stored(13), stored(14),
            stored(15, IN, { pushAlerts: ['tipoff'] }), stored(16)
        ]);
        const weekly = (gameId) => ({ season: SEASON, weeklyScore: [{ week: 1, teams: [{ teamId: 1, gameId, score: 3 }] }] });
        // Raw inserts: the reference is all that matters here, not a valid franchise.
        await Franchise.collection.insertOne({ league: 'hh', seasons: [weekly(10)] });
        await User.collection.insertOne({ seasons: [weekly(11)] });
        await HoopsBoxScore.collection.insertOne({ gameId: 12 });
        await HoopsShots.collection.insertOne({ gameId: 13 });
        stubFetch({ games: [cbbdGame(1)] });

        const out = await refresh();

        expect(await ids()).toEqual([1, 10, 11, 12, 13, 15]);
        expect(out.body.prune.pruned.map(g => g.id)).toEqual([14, 16]);
        expect(out.body.prune.kept.map(g => [g.id, g.refs])).toEqual([
            [10, ['weekly score']], [11, ['weekly score (user)']], [12, ['box score']],
            [13, ['shot chart']], [15, ['push alert sent']]
        ]);
        expect(prune.pruneNote(out.body.prune)).toMatch(/kept 5 dropped but referenced: 10 Rice @ Tulsa 2026-11-11 \(weekly score\)/);
    });
});

describe('refusals', () => {
    test('when every missing row is referenced, nothing is deleted and each is reported', async () => {
        await HoopsGame.create([stored(1), stored(12)]);
        await HoopsBoxScore.collection.insertOne({ gameId: 12 });
        stubFetch({ games: [cbbdGame(1)] });

        const out = await refresh();

        expect(await ids()).toEqual([1, 12]);
        expect(out.body.prune).toEqual({ pruned: [], refused: null,
            kept: [{ id: 12, matchup: 'Rice @ Tulsa', date: '2026-11-11', refs: ['box score'] }] });
    });

    test(`more than ${prune.MAX_PRUNE} missing rows deletes NONE of them`, async () => {
        const n = prune.MAX_PRUNE + 1;
        await HoopsGame.create([stored(1), ...Array.from({ length: n }, (_, i) => stored(100 + i))]);
        stubFetch({ games: [cbbdGame(1)] });

        const out = await refresh();

        expect(out.code).toBe(200);
        expect(await HoopsGame.countDocuments()).toBe(n + 1);
        expect(out.body.prune.pruned).toEqual([]);
        expect(out.body.prune.refused).toMatch(new RegExp(`^${n} stored game\\(s\\) missing`));
    });

    test('exactly the cap still prunes', async () => {
        const n = prune.MAX_PRUNE;
        await HoopsGame.create([stored(1), ...Array.from({ length: n }, (_, i) => stored(100 + i))]);
        stubFetch({ games: [cbbdGame(1)] });

        const out = await refresh();

        expect(out.body.prune.pruned).toHaveLength(n);
        expect(await ids()).toEqual([1]);
    });

    test('a returned game with no id makes the pull unprovable — nothing deleted', async () => {
        await HoopsGame.create([stored(1), stored(2)]);
        const out = await prune.pruneDroppedGames({
            season: SEASON, seasonType: 'regular', start: START, end: END,
            returned: [cbbdGame(1), cbbdGame(undefined)]
        });
        expect(out.refused).toMatch(/no id/);
        expect(await ids()).toEqual([1, 2]);
    });

    test('a prune that throws is reported as refused, and the refresh still answers 200', async () => {
        await HoopsGame.create([stored(1), stored(2)]);
        stubFetch({ games: [cbbdGame(1)] });
        jest.spyOn(HoopsGame, 'deleteMany').mockRejectedValue(new Error('connection reset'));

        const out = await refresh();

        expect(out.code).toBe(200);
        expect(out.body.prune.refused).toBe('prune failed: connection reset');
    });
});

describe('the full-season Schedule ingest', () => {
    const app = express();
    app.use(express.json());
    app.use('/hoops/games', hoopsGames);

    test('prunes across the whole season it pulled', async () => {
        // Its roster import is one billable call; answer "nothing numbered".
        jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path) => {
            if (path === '/teams/roster') return { data: [], remainingCalls: null };
            throw new Error(`unexpected CBBD call ${path}`);
        });
        await HoopsGame.create([stored(1), stored(373100, '2026-12-09T00:00:00Z', { homeTeam: 'Ball State', awayTeam: 'Evansville' }),
            stored(377106, '2027-02-01T00:00:00Z', { homeTeam: 'Lafayette', awayTeam: 'Holy Cross' })]);
        stubFetch({ games: [cbbdGame(1), cbbdGame(378206, '2026-12-09T00:00:00Z')] });

        const res = await request(app).post(`/hoops/games/${SEASON}/schedule`).send({});

        expect(res.status).toBe(200);
        expect(res.body.prune.pruned.map(g => g.id)).toEqual([373100, 377106]);
        expect(await ids()).toEqual([1, 378206]);
    });
});
