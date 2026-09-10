// GET /games/plays/:gameId — the on-demand drive chart / advanced box score.
//
// The behavior worth pinning is cost, not shape. The route has three answers
// and only one of them spends a billable CFBD call, so these tests assert which
// branch was taken by counting fetches: a stored final must never fetch, a
// second viewer inside the TTL must never fetch, and a game that finals must be
// persisted so it never fetches again.
//
// Runs against an in-memory Mongo with the real model and the real route.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Game = require('../models/game');
const livePlays = require('../modules/live-plays');
const gamesRouter = require('../routes/games');

const app = express();
app.use(express.json());
app.use('/games', gamesRouter);

useMongo();

const GAME_ID = 401858212;

function payload({ status = 'Final' } = {}) {
    return {
        id: GAME_ID,
        status,
        period: status === 'Final' ? null : 3,
        clock: status === 'Final' ? '' : '07:14',
        possession: status === 'Final' ? '' : 'home',
        down: null, distance: null, yardsToGoal: null,
        teams: [
            { teamId: 52, team: 'Florida State', homeAway: 'home', lineScores: [7, 3, 7, 7], points: 24, epaPerPlay: 0.104, deserveToWin: 0.225 },
            { teamId: 2567, team: 'SMU', homeAway: 'away', lineScores: [0, 7, 3, 7], points: 17, epaPerPlay: -0.02, deserveToWin: 0.775 }
        ],
        drives: [{
            id: '4018582121',
            offense: 'SMU', offenseId: 2567, defense: 'Florida State', defenseId: 52,
            playCount: 6, yards: 44,
            startPeriod: 1, startClock: '15:00', startYardsToGoal: 75,
            endPeriod: 1, endClock: '12:24', endYardsToGoal: 35,
            duration: '2:36', scoringOpportunity: true, result: 'Fumble', pointsGained: 0,
            plays: [{ id: 'p1', playType: 'Rush', playText: 'a run', yardsGained: 4 }]
        }]
    };
}

function stubFetch({ status = 200, body = payload() } = {}) {
    const fn = jest.fn(async () => ({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (h) => (h === 'x-calllimit-remaining' ? '29747' : null) },
        json: async () => body,
        text: async () => JSON.stringify(body)
    }));
    global.fetch = fn;
    return fn;
}

async function seedGame(extra = {}) {
    await Game.create({
        id: GAME_ID, season: 2026, week: 1, seasonType: 'regular',
        startDate: '2026-09-07T23:30:00.000Z',
        homeId: 52, homeTeam: 'Florida State', awayId: 2567, awayTeam: 'SMU',
        homePoints: 24, awayPoints: 17,
        conferenceGame: false, neutralSite: false, startTimeTbd: false,
        ...extra
    });
}

describe('GET /games/plays/:gameId', () => {
    beforeEach(() => livePlays._reset());
    afterEach(() => { delete global.fetch; });

    it('rejects a non-numeric id without touching CFBD', async () => {
        const f = stubFetch();
        const res = await request(app).get('/games/plays/not-a-game');
        expect(res.status).toBe(400);
        expect(f).not.toHaveBeenCalled();
    });

    it('404s an unknown game without touching CFBD', async () => {
        const f = stubFetch();
        const res = await request(app).get(`/games/plays/${GAME_ID}`);
        expect(res.status).toBe(404);
        // No point paying for plays for a game we don't have.
        expect(f).not.toHaveBeenCalled();
    });

    it('fetches, then persists a completed game', async () => {
        await seedGame({ completed: true });
        const f = stubFetch();

        const res = await request(app).get(`/games/plays/${GAME_ID}`);

        expect(res.status).toBe(200);
        expect(res.body.source).toBe('cfbd');
        expect(res.body.status).toBe('final');
        expect(f).toHaveBeenCalledTimes(1);

        const stored = await Game.findOne({ id: GAME_ID }).lean();
        expect(stored.livePlays.drives).toHaveLength(1);
        expect(stored.livePlays.teams).toHaveLength(2);
        // Drive-level only — the per-play array is what makes the payload big.
        expect(stored.livePlays.drives[0].plays).toBeUndefined();
        expect(stored.livePlays.drives[0].result).toBe('Fumble');
        expect(stored.livePlays.fetchedAt).toBeTruthy();
    });

    it('serves a stored game from Mongo forever, for zero calls', async () => {
        await seedGame({ completed: true });
        stubFetch();
        await request(app).get(`/games/plays/${GAME_ID}`);

        // A fresh cache, so only the DB can answer — which is the situation
        // after any dyno restart.
        livePlays._reset();
        const f = stubFetch();
        const res = await request(app).get(`/games/plays/${GAME_ID}`);

        expect(res.body.source).toBe('db');
        expect(res.body.drives).toHaveLength(1);
        expect(f).not.toHaveBeenCalled();
    });

    it('gives live viewers the untrimmed drives but stores nothing', async () => {
        await seedGame();
        stubFetch({ body: payload({ status: 'In Progress' }) });

        const res = await request(app).get(`/games/plays/${GAME_ID}`);

        expect(res.body.status).toBe('live');
        // Per-play detail is available while the game is on...
        expect(res.body.drives[0].plays).toHaveLength(1);
        expect(res.body.clock).toBe('07:14');

        // ...but a live payload must never be persisted, or the stored-final
        // short-circuit would freeze the game mid-third-quarter forever.
        const stored = await Game.findOne({ id: GAME_ID }).lean();
        expect(stored.livePlays).toBeFalsy();
    });

    it('collapses concurrent viewers into one call', async () => {
        await seedGame();
        const f = stubFetch({ body: payload({ status: 'In Progress' }) });

        await request(app).get(`/games/plays/${GAME_ID}`);
        const second = await request(app).get(`/games/plays/${GAME_ID}`);

        expect(f).toHaveBeenCalledTimes(1);
        expect(second.body.source).toBe('cache');
    });

    it('answers pre-kickoff with an explicit empty result, not an error', async () => {
        await seedGame();
        stubFetch({ status: 400, body: { message: 'No plays found for game.' } });

        const res = await request(app).get(`/games/plays/${GAME_ID}`);

        // Every game is in this state before it starts; the client renders
        // "no plays yet" from it.
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('none');
        expect(res.body.drives).toEqual([]);
    });

    it('502s an upstream failure with nothing cached', async () => {
        await seedGame();
        stubFetch({ status: 503, body: { message: 'down' } });

        const res = await request(app).get(`/games/plays/${GAME_ID}`);

        // The game page is fine, the upstream isn't — the client treats this as
        // "try again next tick".
        expect(res.status).toBe(502);
    });

    it('does not re-store a game whose summary is already saved', async () => {
        await seedGame({
            completed: true,
            livePlays: { fetchedAt: new Date('2026-09-08'), teams: [], drives: [{ id: 'd1', result: 'TD' }] }
        });
        const f = stubFetch();

        const res = await request(app).get(`/games/plays/${GAME_ID}`);

        expect(res.body.source).toBe('db');
        expect(res.body.drives[0].result).toBe('TD');
        expect(f).not.toHaveBeenCalled();
    });

    it('ignores an empty stored summary and fetches', async () => {
        // A write that landed with no drives must not permanently mask the
        // game — otherwise one bad response poisons it forever.
        await seedGame({ completed: true, livePlays: { fetchedAt: new Date(), teams: [], drives: [] } });
        const f = stubFetch();

        const res = await request(app).get(`/games/plays/${GAME_ID}`);

        expect(f).toHaveBeenCalledTimes(1);
        expect(res.body.source).toBe('cfbd');
    });
});
