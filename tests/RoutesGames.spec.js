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

    // THREE consumers read these documents, and the third has no UI:
    // modules/scoring.js fetches this route over HTTP, once per rostered team
    // per week, and hands the raw game to calculateScoreV1/V2 ->
    // buildContext(), which reads conferenceGame / homeConference /
    // awayConference. Dropping those does not throw — it silently banks the
    // wrong rule (a conference win scores as non-conference) and makes
    // isPowerFiveUpset(undefined, undefined) false, re-opening the non-P5 upset
    // loophole. A QA pass caught exactly that before this shipped.
    it('carries the conference fields the scoring engine reads, which have no UI', async () => {
        const { GAME_READ_FIELDS } = require('../routes/games');
        ['conferenceGame', 'homeConference', 'awayConference'].forEach(f => {
            expect(GAME_READ_FIELDS[f]).toBe(1);
        });
    });

    // Asserts the RESPONSE carries every key of the projection, against a
    // fixture that sets them all.
    //
    // Two weaker versions of this test came before it, and both were green
    // against a deliberately broken projection. The first listed 18 fields by
    // hand and silently omitted five that were in the constant. The second
    // compared the query's second argument to the exported constant — a
    // tautology: it only proves the route passes its own object, never what is
    // in it. Deleting `weather: 1` left all 35 tests passing while killing the
    // weather emoji on both My Team and Standings.
    //
    // Driving it off Object.keys means a field added to the projection is
    // automatically asserted, and a field deleted from it fails here.
    it('answers every field the projection claims to carry', async () => {
        const { GAME_READ_FIELDS } = require('../routes/games');
        // One value per projected field, so a missing key means the PROJECTION
        // dropped it rather than the fixture never having set it.
        await Game.create(gameDoc({
            id: 802, season: 2025, week: 1, seasonType: 'regular',
            homeId: 1, awayId: 2, completed: true, status: 'completed',
            startTimeTbd: false, period: 4, clock: '00:00',
            possession: 'Oregon', situation: '1st & 10',
            notes: 'Week 1', outlet: 'ESPN', highlights: 'http://x/clip',
            lastUpdated: '9/19/2025, 11:00:00 PM',
            conferenceGame: true, homeConference: 'Big Ten', awayConference: 'ACC',
            weather: { temp: 68, wind: 5, condition: 'Clear', emoji: '☀️' }
        }));

        const res = await request(app).get('/games/seasonType/regular/week/1/team/1?season=2025');
        const g = res.body.find(x => x.id === 802);
        expect(g).toBeDefined();

        // This list is INDEPENDENT of GAME_READ_FIELDS on purpose, and that is
        // the whole point. A third version of this test drove the assertion off
        // Object.keys(GAME_READ_FIELDS) — which deletes the assertion along with
        // the field, so removing `weather: 1` still passed. The contract lives
        // here, spelled out, and changing the projection means changing this too.
        const EXPECTED = [
            'id', 'season', 'week', 'seasonType',
            'startDate', 'startTimeTbd', 'completed', 'status',
            'homeId', 'homeTeam', 'homePoints',
            'awayId', 'awayTeam', 'awayPoints',
            'period', 'clock', 'possession', 'situation',
            'notes', 'outlet', 'weather', 'highlights', 'lastUpdated',
            // no UI — modules/scoring.js reads these off the raw game
            'conferenceGame', 'homeConference', 'awayConference'
        ];
        EXPECTED.forEach(f => expect(g).toHaveProperty(f));

        // ...and the projection carries nothing this list has forgotten. Sorted
        // both sides so the assertion is about membership, not declaration order.
        expect(Object.keys(GAME_READ_FIELDS).sort()).toEqual(EXPECTED.slice().sort());
    });

    it('still answers an empty array for a team with no game that week', async () => {
        const res = await request(app).get('/games/seasonType/regular/week/9/team/1?season=2025');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });
});

// public/current-week.js is the app's single source for "what week is it". It
// used to read the number off the FULL scoreboard payload — 4.3s against the M0
// tier — for one integer. The betting page pays that BEFORE it can fetch
// anything, because the week decides which games to ask for.
// The batched sibling of the per-team route. Standings for a classic league
// loops EVERY manager's roster — 60 requests, 8918ms in the browser — and the
// requests do not parallelise away, because they queue behind the M0 tier's
// ceiling. One query over the same 60 ids is 669ms.
describe('GET /games/seasonType/:type/week/:week/teams', () => {
    beforeEach(async () => {
        await Game.create([
            gameDoc({ id: 901, week: 1, homeId: 1, awayId: 2, homeTeam: 'Oregon', awayTeam: 'Duke' }),
            gameDoc({ id: 902, week: 1, homeId: 3, awayId: 9, homeTeam: 'Iowa', awayTeam: 'Rutgers' }),
            gameDoc({ id: 903, week: 2, homeId: 1, awayId: 4, homeTeam: 'Oregon', awayTeam: 'UCLA' })
        ]);
    });

    it('answers every listed team\'s games for that week in one response', async () => {
        const res = await request(app).get('/games/seasonType/regular/week/1/teams?ids=1,3&season=2025');
        expect(res.status).toBe(200);
        expect(res.body.map(g => g.id).sort()).toEqual([901, 902]);
        // ...and nothing from another week.
        expect(res.body.some(g => g.id === 903)).toBe(false);
    });

    // A game between two rostered teams must come back ONCE. The per-team route
    // returned it separately to each side; the clients regroup it to both, so
    // the response itself must not duplicate it.
    it('returns a game between two listed teams only once', async () => {
        const res = await request(app).get('/games/seasonType/regular/week/1/teams?ids=1,2&season=2025');
        expect(res.body.filter(g => g.id === 901)).toHaveLength(1);
    });

    it('answers an empty array when no listed team played that week', async () => {
        const res = await request(app).get('/games/seasonType/regular/week/9/teams?ids=1,2&season=2025');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    // The guard this route shipped with was broken and failed QUIETLY:
    // Number('') is 0 and finite, so a missing or blank list produced [0]
    // rather than [], the 400 was unreachable, and `ids=1,2,` queried for a
    // team id of 0. Each of these cases would have passed the old filter.
    describe('id parsing', () => {
        const bad = [
            ['missing', ''],
            ['blank', '?ids='],
            ['whitespace', '?ids=%20%20'],
            ['non-numeric', '?ids=abc'],
            ['negative', '?ids=-3'],
            ['fractional', '?ids=1.5']
        ];
        bad.forEach(([label, qs]) => {
            it(`rejects ${label} rather than querying for team 0`, async () => {
                const res = await request(app).get(`/games/seasonType/regular/week/1/teams${qs}`);
                expect(res.status).toBe(400);
                expect(res.body.message).toMatch(/ids is required/);
            });
        });

        it('ignores a trailing comma instead of injecting team 0', async () => {
            const res = await request(app).get('/games/seasonType/regular/week/1/teams?ids=1,2,&season=2025');
            expect(res.status).toBe(200);
            expect(res.body.map(g => g.id)).toEqual([901]);
        });

        it('caps the list rather than accepting an unbounded $in', async () => {
            const many = Array.from({ length: 201 }, (_, i) => i + 1).join(',');
            const res = await request(app).get(`/games/seasonType/regular/week/1/teams?ids=${many}`);
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/too many ids/);
        });

        // The boundary the chunking scheme rests on. modules/scoring.js splits
        // its requests at exactly MAX_TEAM_IDS, so a FULL chunk has to be
        // accepted — lowering this cap without lowering that chunk size 400s
        // every scoring run, and the two constants are not shared.
        it('accepts a chunk of exactly the cap', async () => {
            const { MAX_TEAM_IDS } = require('../routes/games');
            expect(MAX_TEAM_IDS).toBe(200);

            const exact = Array.from({ length: MAX_TEAM_IDS }, (_, i) => i + 1).join(',');
            const res = await request(app).get(`/games/seasonType/regular/week/1/teams?ids=${exact}&season=2025`);

            // Accepted, not 400 — that is the whole assertion. The id range
            // covers several fixture teams, so the result set is incidental.
            expect(res.status).toBe(200);
            expect(res.body.map(g => g.id)).toContain(901);
        });

        // A team whose id does not survive the filter is simply absent from the
        // response. modules/scoring.js is a caller now, and an absent team scores
        // 0 for the week — so a PARTIAL drop must not be silent. (A total drop
        // 400s above, and scoring throws on that.)
        it('logs the ids it drops instead of dropping them silently', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const res = await request(app).get('/games/seasonType/regular/week/1/teams?ids=1,abc,2&season=2025');

            expect(res.status).toBe(200);
            expect(spy).toHaveBeenCalledWith(expect.stringMatching(/Ignored 1 non-numeric team id\(s\).*abc/));
            spy.mockRestore();
        });

        it('does not log when every id is valid', async () => {
            const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await request(app).get('/games/seasonType/regular/week/1/teams?ids=1,2&season=2025');

            // A trailing comma is not a dropped id — it is empty, and stripped
            // before the check, so it must not raise a false alarm every run.
            await request(app).get('/games/seasonType/regular/week/1/teams?ids=1,2,&season=2025');

            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    it('projects the same fields as the per-team route', async () => {
        const { GAME_READ_FIELDS } = require('../routes/games');
        const spy = jest.spyOn(Game, 'find');
        await request(app).get('/games/seasonType/regular/week/1/teams?ids=1&season=2025');
        expect(spy.mock.calls[0][1]).toBe(GAME_READ_FIELDS);
        spy.mockRestore();
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

    // Same exposure as the schedule route, and this one runs on every scoring
    // job — three times a Saturday.
    test('answers 502 when CFBD is unreachable instead of throwing', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('socket hang up')));

        const res = await request(app).post('/games/week/mass-create').send({ week: 1, seasonType: 'regular' });

        expect(res.status).toBe(502);
        expect(res.body.message).toMatch(/socket hang up/);
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

    // The point of running this weekly: a future game's kickoff is TBD until
    // ~12 days out, and nothing else re-dates a week that isn't the current one.
    test('rewrites a stored kickoff when CFBD firms up a TBD date', async () => {
        await Game.create(gameDoc({
            id: 501, week: 7,
            startDate: '2025-10-18T04:00:00.000Z', startTimeTbd: true
        }));
        global.fetch = jest.fn(() => fetchOk([cfbdGame({
            id: 501, week: 7,
            startDate: '2025-10-18T19:30:00.000Z', startTimeTBD: false
        })]));

        const res = await request(app).post('/games/2025/schedule').send({});

        expect(res.status).toBe(201);
        const g = await Game.findOne({ id: 501 }).lean();
        expect(g.startDate.toISOString ? g.startDate.toISOString() : g.startDate)
            .toBe('2025-10-18T19:30:00.000Z');
        expect(g.startTimeTbd).toBe(false);
    });

    // Batched in one bulkWrite rather than a findOne + findOneAndUpdate per
    // game: at ~800 games a season the old per-game loop was ~1600 sequential
    // Atlas round trips, past Heroku's 30s ceiling on the M0 tier.
    test('writes the whole slate in one bulkWrite', async () => {
        const spy = jest.spyOn(Game, 'bulkWrite');
        global.fetch = jest.fn(() => fetchOk([
            cfbdGame({ id: 501 }), cfbdGame({ id: 502 }), cfbdGame({ id: 503 })
        ]));

        await request(app).post('/games/2025/schedule').send({});

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toHaveLength(3);
        expect(await Game.countDocuments()).toBe(3);
    });

    // Same guard mass-create has: CFBD sends null points for a game that isn't
    // final, and this route writes the row wholesale. A weekly run landing
    // mid-game must not wipe the live score the poller just wrote.
    test('does not overwrite a live score with CFBD nulls', async () => {
        await Game.create(gameDoc({ id: 501, homePoints: 21, awayPoints: 17, completed: false }));
        global.fetch = jest.fn(() => fetchOk([
            cfbdGame({ id: 501, homePoints: null, awayPoints: null })
        ]));

        await request(app).post('/games/2025/schedule').send({});

        const g = await Game.findOne({ id: 501 }).lean();
        expect(g.homePoints).toBe(21);
        expect(g.awayPoints).toBe(17);
    });

    // The counts drive a cron job's health check, so they have to describe what
    // was WRITTEN, not what was attempted. Counting the assembled ops meant a
    // bulkWrite that wrote nothing still answered "2 created" with a 201, and
    // the enrichment job filed that as a clean run.
    test('a failed bulkWrite reports zero written and a non-2xx, not a full success', async () => {
        jest.spyOn(Game, 'bulkWrite').mockRejectedValue(new Error('connection timed out'));
        global.fetch = jest.fn(() => fetchOk([cfbdGame({ id: 501 }), cfbdGame({ id: 502 })]));

        const res = await request(app).post('/games/2025/schedule').send({});

        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ created: 0, updated: 0, total: 2 });
        expect(res.body.message).toMatch(/connection timed out/);
        expect(await Game.countDocuments()).toBe(0);
    });

    // A duplicate-key loss is another run winning the same upsert — that game IS
    // written, so it must not fail the slate the way a real write error does.
    test('a duplicate-key collision with a concurrent run still succeeds', async () => {
        const err = new Error('E11000 duplicate key');
        err.writeErrors = [{ code: 11000 }];
        err.result = { upsertedCount: 1, matchedCount: 0 };
        jest.spyOn(Game, 'bulkWrite').mockRejectedValue(err);
        global.fetch = jest.fn(() => fetchOk([cfbdGame({ id: 501 }), cfbdGame({ id: 502 })]));

        const res = await request(app).post('/games/2025/schedule').send({});

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ created: 1, updated: 0 });   // what actually landed
    });

    // A rejected fetch (DNS, TLS reset, socket hangup) never reaches
    // gamesResponseError. Unguarded it is an unhandled rejection in an Express 4
    // async handler, which with no process-level handler kills the dyno.
    test('answers 502 when CFBD is unreachable instead of throwing', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('ECONNRESET')));

        const res = await request(app).post('/games/2025/schedule').send({});

        expect(res.status).toBe(502);
        expect(res.body.message).toMatch(/ECONNRESET/);
    });

    // A malformed CFBD row must be skipped, not written over a good doc — the
    // validator that insertMany used to provide for free.
    test('skips an invalid row and still writes the rest', async () => {
        global.fetch = jest.fn(() => fetchOk([
            cfbdGame({ id: 501 }),
            cfbdGame({ id: 502, homeTeam: undefined })   // required field missing
        ]));

        const res = await request(app).post('/games/2025/schedule').send({});

        expect(res.body.total).toBe(2);
        expect(res.body.created).toBe(1);
        expect(await Game.countDocuments({ id: 502 })).toBe(0);
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
