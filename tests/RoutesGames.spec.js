// HTTP-level tests for routes/games.js against an in-memory Mongo. DB-read
// endpoints run for real; the CFBD-calling endpoints (/info, mass-create,
// schedule, media) have their single network seam — the global fetch — stubbed,
// so we cover the handler logic (validation, upsert, response shaping) without
// touching collegefootballdata.com.

process.env.YEAR = '2025';   // read by the week-scoped GET query

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Game = require('../models/game');
const gamesRouter = require('../routes/games');

const app = express();
app.use(express.json());
app.use('/games', gamesRouter);

useMongo();

// A complete, valid Game document (all required fields present).
function gameDoc(o) {
    return Object.assign({
        id: 401, season: 2025, week: 1, seasonType: 'regular',
        startDate: '2025-08-30T00:00:00.000Z', startTimeTbd: false,
        neutralSite: false, conferenceGame: false,
        homeId: 1, homeTeam: 'Oregon', awayId: 2, awayTeam: 'Duke',
        homePoints: 30, awayPoints: 10
    }, o);
}
// The CFBD shape (startTimeTBD casing) the ingest endpoints expect.
function cfbdGame(o) {
    return Object.assign({
        id: 501, season: 2025, week: 1, seasonType: 'regular',
        startDate: '2025-08-30T00:00:00.000Z', startTimeTBD: false,
        neutralSite: false, conferenceGame: true,
        homeId: 1, homeTeam: 'Oregon', awayId: 2, awayTeam: 'Duke',
        homePoints: 30, awayPoints: 10
    }, o);
}
// Minimal fetch Response stub.
function fetchOk(body, headers = {}) {
    return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(body),
        headers: { get: (h) => headers[h] }
    });
}

const realFetch = global.fetch;
beforeEach(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

describe('GET reads', () => {
    test('GET /games returns all games', async () => {
        await Game.create([gameDoc(), gameDoc({ id: 402, homeTeam: 'Iowa' })]);
        const res = await request(app).get('/games');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
    });

    test('GET /games/season/:season/team/:team filters by team and season', async () => {
        await Game.create([
            gameDoc({ id: 402, homeTeam: 'Iowa', awayTeam: 'Duke' }),
            gameDoc({ id: 403, homeTeam: 'Oregon', awayTeam: 'Ohio State' })
        ]);
        const res = await request(app).get('/games/season/2025/team/Duke');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].id).toBe(402);
    });

    // A team with no game that week is an empty result, not a client error. It
    // used to 400, which logged one console error per rostered team on every
    // postseason Standings load (most drafted teams play no bowl game).
    test('week-scoped lookup finds a game, and 200s with [] when there is none', async () => {
        await Game.create(gameDoc({ homeId: 7, awayId: 8 }));
        const hit = await request(app).get('/games/seasonType/regular/week/1/team/7');
        expect(hit.status).toBe(200);
        expect(hit.body[0].id).toBe(401);

        const miss = await request(app).get('/games/seasonType/regular/week/9/team/7');
        expect(miss.status).toBe(200);
        expect(miss.body).toEqual([]);
    });
});

describe('POST /games (single create)', () => {
    test('creates a complete game (201)', async () => {
        const res = await request(app).post('/games').send(gameDoc());
        expect(res.status).toBe(201);
        expect(res.body.id).toBe(401);
        expect(await Game.countDocuments()).toBe(1);
    });

    test('rejects an incomplete game with null homePoints (400)', async () => {
        const res = await request(app).post('/games').send(gameDoc({ homePoints: null }));
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/not complete/);
    });

    test('rejects a duplicate id (400)', async () => {
        await Game.create(gameDoc());
        const res = await request(app).post('/games').send(gameDoc());
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/already exists/);
    });
});

describe('GET /games/info (CFBD passthrough)', () => {
    test('returns the CFBD info payload', async () => {
        global.fetch = jest.fn(() => fetchOk({ remaining: 812 }));
        const res = await request(app).get('/games/info');
        expect(res.status).toBe(200);
        expect(res.body.remaining).toBe(812);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});

describe('POST /games/week/mass-create', () => {
    test('validates missing week for a regular-season request before any fetch', async () => {
        global.fetch = jest.fn();
        const res = await request(app).post('/games/week/mass-create').send({ seasonType: 'regular' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/week is required/);
        expect(global.fetch).not.toHaveBeenCalled();   // short-circuits before the network
    });

    test('ingests new games from CFBD and surfaces the remaining-calls header', async () => {
        global.fetch = jest.fn(() => fetchOk([cfbdGame()], { 'x-calllimit-remaining': '4321' }));
        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });
        expect(res.status).toBe(201);
        expect(res.body.newGames).toHaveLength(1);
        expect(res.body.remainingCalls).toBe(4321);
        expect(await Game.countDocuments()).toBe(1);
    });

    test('surfaces a CFBD failure as a 400', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: false, status: 429,
            json: () => Promise.resolve({ message: 'rate limited' }),
            headers: { get: () => null }
        }));
        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/rate limited/);
    });

    test('updates an existing game in place and reports it as existing', async () => {
        await Game.create(gameDoc({ id: 501, homePoints: 0, awayPoints: 0, completed: false }));
        global.fetch = jest.fn(() => fetchOk([cfbdGame({ homePoints: 30, awayPoints: 10, completed: true })]));
        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });
        expect(res.status).toBe(201);
        expect(res.body.existingGames).toHaveLength(1);
        expect(res.body.newGames).toHaveLength(0);
        expect(await Game.countDocuments()).toBe(1);
        const saved = await Game.findOne({ id: 501 }).lean();
        expect(saved).toMatchObject({ homePoints: 30, completed: true });
    });

    // This route is a second path to completed:true, and the live poller cannot
    // be counted on to clear the scoreboard-only fields afterwards: /scoreboard
    // only returns games in its current window, and the poller's games-live gate
    // stops firing the moment the last live game reads final. Without this the
    // leftover down-and-distance renders as a live strip under a final score.
    test('clears situation and lastPlay when a game arrives completed', async () => {
        await Game.create(gameDoc({
            id: 501, completed: false,
            situation: '3rd & 7 at LSU 32', lastPlay: 'Nussmeier pass complete for 8 yds'
        }));
        global.fetch = jest.fn(() => fetchOk([cfbdGame({ homePoints: 31, awayPoints: 24, completed: true })]));

        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });
        expect(res.status).toBe(201);

        const saved = await Game.findOne({ id: 501 }).lean();
        expect(saved.completed).toBe(true);
        expect(saved.situation ?? null).toBe(null);
        expect(saved.lastPlay ?? null).toBe(null);
    });

    test('leaves situation and lastPlay alone while a game is still in progress', async () => {
        await Game.create(gameDoc({
            id: 501, completed: false,
            situation: '3rd & 7 at LSU 32', lastPlay: 'Nussmeier pass complete for 8 yds'
        }));
        global.fetch = jest.fn(() => fetchOk([cfbdGame({ homePoints: 21, awayPoints: 17, completed: false })]));

        await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });

        const saved = await Game.findOne({ id: 501 }).lean();
        expect(saved.situation).toBe('3rd & 7 at LSU 32');
        expect(saved.lastPlay).toBe('Nussmeier pass complete for 8 yds');
    });

    // The regression that made a fourth-quarter game advertise its kickoff time.
    // CFBD's /games sends null points until a game is final, and `$set: game`
    // wrote those over the live score the /scoreboard poller had just stored —
    // for the ~2 minutes until the next poll, buildGameCard saw a not-completed
    // game with no score and rendered the pre-game card. The nightly 23:00 full
    // update lands mid-game on any weeknight kickoff.
    test('does not overwrite a live score with the nulls CFBD sends mid-game', async () => {
        await Game.create(gameDoc({
            id: 501, completed: false,
            homePoints: 27, awayPoints: 24,
            homeLineScores: [7, 3, 7, 10], awayLineScores: [7, 7, 3, 7]
        }));
        global.fetch = jest.fn(() => fetchOk([cfbdGame({
            homePoints: null, awayPoints: null,
            homeLineScores: null, awayLineScores: null, completed: false
        })]));

        await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });

        const saved = await Game.findOne({ id: 501 }).lean();
        expect(saved.homePoints).toBe(27);
        expect(saved.awayPoints).toBe(24);
        expect(saved.homeLineScores).toEqual([7, 3, 7, 10]);
        // The rest of the row still updates — the guard is per-field, not a
        // skip of the whole game.
        expect(saved.conferenceGame).toBe(true);
    });

    // A game that truly hasn't kicked off must still ingest with no score,
    // rather than the guard leaving a stale value behind on a fresh insert.
    test('ingests an upcoming game with no score at all', async () => {
        global.fetch = jest.fn(() => fetchOk([cfbdGame({
            id: 505, homePoints: null, awayPoints: null, completed: false
        })]));

        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });
        expect(res.status).toBe(201);

        const saved = await Game.findOne({ id: 505 }).lean();
        expect(saved.homePoints ?? null).toBe(null);
        expect(saved.awayPoints ?? null).toBe(null);
    });

    // The race this route has to survive. The Saturday job fires at 15:00/18:00/
    // 22:00 on the minute and the live poller fires on every :00 mark, so two runs
    // land together three times a Saturday. Under the old find-then-insertMany
    // both could decide the same game was new and insert it twice — and a second
    // doc with the same CFBD id makes the per-team week lookup return the game
    // twice, which scoring adds twice, doubling that team's points for the week.
    test('two concurrent ingests of the same slate leave exactly one doc per game', async () => {
        global.fetch = jest.fn(() => fetchOk([cfbdGame(), cfbdGame({ id: 502, homeTeam: 'Iowa' })]));
        const send = () => request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });

        const [a, b] = await Promise.all([send(), send()]);

        expect(a.status).toBe(201);
        expect(b.status).toBe(201);
        expect(await Game.countDocuments()).toBe(2);
        expect(await Game.countDocuments({ id: 501 })).toBe(1);
        expect(await Game.countDocuments({ id: 502 })).toBe(1);
    });

    test('one unsaveable game does not take the rest of the slate down', async () => {
        // homeTeam is required, so this row can't save — the other one still must.
        global.fetch = jest.fn(() => fetchOk([
            cfbdGame({ id: 503, homeTeam: undefined }),
            cfbdGame({ id: 504, homeTeam: 'Iowa' })
        ]));
        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });
        expect(res.status).toBe(201);
        expect(await Game.countDocuments({ id: 504 })).toBe(1);
        expect(await Game.countDocuments({ id: 503 })).toBe(0);
    });
});

describe('POST /games/:season/schedule', () => {
    test('rejects a non-4-digit season (400)', async () => {
        const res = await request(app).post('/games/20xx/schedule').send({});
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Invalid season/);
    });

    test('bulk-upserts a season schedule and reports created/updated counts', async () => {
        await Game.create(gameDoc({ id: 501 }));   // pre-existing → should update, not duplicate
        global.fetch = jest.fn(() => fetchOk([cfbdGame({ id: 501 }), cfbdGame({ id: 502, homeTeam: 'Iowa' })]));
        const res = await request(app).post('/games/2025/schedule').send({});
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ season: 2025, seasonType: 'regular', created: 1, updated: 1, total: 2 });
        expect(await Game.countDocuments()).toBe(2);   // no duplicate for id 501
    });
});

describe('POST /games/:season/media', () => {
    test('rejects a non-4-digit season (400)', async () => {
        const res = await request(app).post('/games/xx/media').send({});
        expect(res.status).toBe(400);
    });

    test('attaches broadcast info to matching games, preferring a TV outlet', async () => {
        await Game.create(gameDoc({ id: 601 }));
        global.fetch = jest.fn(() => fetchOk([
            { id: 601, mediaType: 'web', outlet: 'ESPN+' },
            { id: 601, mediaType: 'tv', outlet: 'ABC' }    // tv preferred over the web row
        ]));
        const res = await request(app).post('/games/2025/media').send({});
        expect(res.status).toBe(200);
        expect(res.body.updated).toBe(1);
        const g = await Game.findOne({ id: 601 }).lean();
        expect(g.outlet).toBe('ABC');
        expect(g.mediaType).toBe('tv');
    });
});
