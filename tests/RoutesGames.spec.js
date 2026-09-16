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

// public/current-week.js is the app's single source for "what week is it". It
// used to read the number off the FULL scoreboard payload — 4.3s against the M0
// tier — for one integer. The betting page pays that BEFORE it can fetch
// anything, because the week decides which games to ask for.
// My Team calls this once per rostered team, from three places, so the set runs
// 2-3 times a load. Unprojected it returned every field of every game —
// including wpSnapshots (a row per live-poller tick) and livePlays (~50KB a game
// once the gamecast has run). Measured against production data: 10 requests for
// week 2 cost 410KB and 5325ms; projected, 5KB and 675ms.
describe('GET /games/seasonType/:type/week/:week/team/:team', () => {
    // Asserted on the QUERY. The route answers the documents directly, so a
    // response-shape assertion would pass either way on data that happens to
    // have no livePlays yet — which is every game in a fresh test database.
    // Verified: this fails when the projection is removed.
    it('projects away the poller payload the pages never read', async () => {
        const spy = jest.spyOn(Game, 'find');
        await request(app).get('/games/seasonType/regular/week/1/team/1?season=2025');

        const projection = spy.mock.calls[0][1];
        expect(projection).toBeDefined();
        // The heavy fields must not be asked for.
        ['wpSnapshots', 'livePlays', 'teamStats', 'playerStats',
         'homeLineScores', 'awayLineScores'].forEach(f => {
            expect(projection[f]).toBeUndefined();
        });
        spy.mockRestore();
    });

    // The union both consumers read: public/userHome.js (buildGameCard,
    // batchTeamLogos, the 30s live patch) and public/standings.js
    // (displaySchedule). A field dropped here goes silently undefined in the UI
    // rather than throwing, so it is pinned explicitly.
    it('still carries every field My Team and Standings read', async () => {
        // Every asserted field is set here on purpose: Mongo omits fields a
        // document doesn't have, so a fixture that leaves one unset would fail
        // this for a reason that has nothing to do with the projection.
        await Game.create(gameDoc({
            id: 801, season: 2025, week: 1, seasonType: 'regular',
            homeId: 1, awayId: 2, completed: true, notes: 'Week 1',
            period: 2, clock: '07:15', possession: 'Oregon',
            situation: '3rd & 7', outlet: 'ESPN'
        }));
        const res = await request(app).get('/games/seasonType/regular/week/1/team/1?season=2025');
        expect(res.status).toBe(200);
        const g = res.body.find(x => x.id === 801);
        expect(g).toBeDefined();
        ['id', 'season', 'week', 'seasonType', 'startDate', 'completed',
         'homeId', 'homeTeam', 'homePoints', 'awayId', 'awayTeam', 'awayPoints',
         'notes', 'period', 'clock', 'possession', 'situation', 'outlet'].forEach(f => {
            expect(g).toHaveProperty(f);
        });
    });

    it('still answers an empty array for a team with no game that week', async () => {
        const res = await request(app).get('/games/seasonType/regular/week/9/team/1?season=2025');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

describe('GET /games/current-week/:season', () => {
    test('answers the week without the rest of the scoreboard payload', async () => {
        await Game.create([
            gameDoc({ id: 701, week: 1, startDate: '2025-08-30T00:00:00.000Z' }),
            gameDoc({ id: 702, week: 2, startDate: '2025-09-06T00:00:00.000Z' })
        ]);
        const res = await request(app).get('/games/current-week/2025');
        expect(res.status).toBe(200);
        expect(typeof res.body.week === 'number' || res.body.week === null).toBe(true);
        // The point of the endpoint: it carries the week and nothing heavy.
        expect(Object.keys(res.body).sort()).toEqual(['season', 'seasonType', 'week']);
        expect(res.body.games).toBeUndefined();
        expect(res.body.conferences).toBeUndefined();
    });

    // Must not drift from the week /scoreboard lands on — they share
    // weekWindows/defaultWeek precisely so this holds.
    test('agrees with the scoreboard route', async () => {
        await Game.create([
            gameDoc({ id: 703, week: 1, startDate: '2025-08-30T00:00:00.000Z' }),
            gameDoc({ id: 704, week: 2, startDate: '2025-09-06T00:00:00.000Z' })
        ]);
        const cheap = await request(app).get('/games/current-week/2025');
        const full = await request(app).get('/games/scoreboard/graham-league/2025');
        expect(cheap.body.week).toBe(full.body.week);
    });

    test('rejects a non-numeric season', async () => {
        const res = await request(app).get('/games/current-week/notayear');
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/Invalid season/);
    });

    test('answers null rather than erroring when the season has no games', async () => {
        const res = await request(app).get('/games/current-week/1999');
        expect(res.status).toBe(200);
        expect(res.body.week).toBeNull();
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

    // The Heroku H12 that killed two nights of scoring in Sep 2026. The route
    // used to do `Game.find({ id })` and then `findOneAndUpdate` per game — 172
    // sequential Atlas round trips for an 86-game week, which ran 75s against a
    // 30s router ceiling. The router answered its HTML error page, the calling
    // job JSON.parsed it, and doFullUpdate died before it ever reached scoring.
    // Guard the shape of the fix, not the wall-clock: round trips must not grow
    // with the size of the slate.
    test('issues a constant number of DB round trips no matter how big the slate', async () => {
        const slate = Array.from({ length: 60 }, (_, i) =>
            cfbdGame({ id: 600 + i, homeTeam: `Home ${i}`, awayTeam: `Away ${i}` }));
        global.fetch = jest.fn(() => fetchOk(slate));

        const find = jest.spyOn(Game, 'find');
        const bulkWrite = jest.spyOn(Game, 'bulkWrite');

        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });

        expect(res.status).toBe(201);
        expect(await Game.countDocuments()).toBe(60);
        // One $in lookup for what already exists, one read-back for the response.
        expect(find).toHaveBeenCalledTimes(2);
        // One write for the whole slate.
        expect(bulkWrite).toHaveBeenCalledTimes(1);
        expect(bulkWrite.mock.calls[0][0]).toHaveLength(60);
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


// ---------------------------------------------------------------------------
// GET /games/detail/:gameId — the pre-game Season Averages comparison
// ---------------------------------------------------------------------------
//
// Points are the one row that cannot come from CFBD's season-stats aggregate:
// that payload has 57 keys and not one of them is scoring. (The team page read
// a `totalPoints` field that has never existed and rendered a flat 0.0 for it.)
// The server sums points off the games instead, and ships its own games count
// with them so the average isn't divided by a denominator it wasn't summed over.
describe('GET /games/detail/:gameId — season scoring', () => {
    const TeamSeasonStat = require('../models/teamSeasonStat');

    async function seedStats() {
        await TeamSeasonStat.create([
            { season: 2025, team: 'Oregon', games: 2, stats: { totalYards: 800 } },
            { season: 2025, team: 'Duke', games: 2, stats: { totalYards: 600 } }
        ]);
    }

    test('sums points for and against from whichever side the team played on', async () => {
        await Game.create([
            gameDoc({ id: 401, week: 1, homeId: 1, homeTeam: 'Oregon', awayId: 2, awayTeam: 'Duke', homePoints: 30, awayPoints: 10 }),
            // Oregon on the road: its points are the AWAY column here.
            gameDoc({ id: 402, week: 2, homeId: 3, homeTeam: 'Utah', awayId: 1, awayTeam: 'Oregon', homePoints: 14, awayPoints: 21 })
        ]);
        await seedStats();

        const res = await request(app).get('/games/detail/401');

        expect(res.status).toBe(200);
        expect(res.body.seasonStats.home.scoring).toEqual({ games: 2, pointsFor: 51, pointsAgainst: 24 });
        expect(res.body.seasonStats.away.scoring).toEqual({ games: 1, pointsFor: 10, pointsAgainst: 30 });
    });

    test('ignores games that have not been played', async () => {
        await Game.create([
            gameDoc({ id: 401, week: 1, homePoints: 30, awayPoints: 10 }),
            gameDoc({ id: 403, week: 3, homeId: 1, homeTeam: 'Oregon', awayId: 4, awayTeam: 'UCLA', homePoints: null, awayPoints: null })
        ]);
        await seedStats();

        const res = await request(app).get('/games/detail/401');

        expect(res.body.seasonStats.home.scoring.games).toBe(1);
        expect(res.body.seasonStats.home.scoring.pointsFor).toBe(30);
    });

    // The other rows divide by CFBD's regular-season games count, so this has to
    // be summed over the same slate or the two halves of the card disagree.
    test('counts the regular season only', async () => {
        await Game.create([
            gameDoc({ id: 401, week: 1, homePoints: 30, awayPoints: 10 }),
            gameDoc({ id: 404, week: 1, seasonType: 'postseason', homeId: 1, homeTeam: 'Oregon', awayId: 5, awayTeam: 'Ohio State', homePoints: 60, awayPoints: 3 })
        ]);
        await seedStats();

        const res = await request(app).get('/games/detail/401');

        expect(res.body.seasonStats.home.scoring).toEqual({ games: 1, pointsFor: 30, pointsAgainst: 10 });
    });

    test('reports zeros rather than dividing by nothing before kickoff', async () => {
        await Game.create(gameDoc({ id: 401, homePoints: null, awayPoints: null }));
        await seedStats();

        const res = await request(app).get('/games/detail/401');

        expect(res.body.seasonStats.home.scoring).toEqual({ games: 0, pointsFor: 0, pointsAgainst: 0 });
    });
});
