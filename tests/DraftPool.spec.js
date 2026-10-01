// What a league can draft, per sport (#320).
//
// The failure this file exists for is not an error — it is a pool that renders,
// drafts fine, and is missing the teams anyone wanted. A short list, a list in
// the wrong order, or a capped list filled out of unranked rows all look
// identical to a correct one on the board.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const HoopsTeam = require('../models/hoopsTeam');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const Draft = require('../models/draft');
const activeSeason = require('../modules/active-season');
const draftPool = require('../modules/draft-pool');
const draftRouter = require('../routes/draft');

useMongo();

const HOOPS = 'hoops-league';
const BALL = 'graham-league';
const SEASON = 2027;

const app = express();
app.use(express.json());
app.use('/draft', draftRouter);

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    activeSeason._reset();
});
afterEach(() => jest.restoreAllMocks());

// The league rows are what make a league a basketball league — poolFor reads
// the sport off the cache these prime.
async function leagues() {
    await League.create([
        { code: BALL, name: 'Graham League', sport: 'football', season: 2026 },
        { code: HOOPS, name: 'Hoops League', sport: 'basketball', season: SEASON }
    ]);
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: SEASON, status: 'in-season' }
    ]);
    await activeSeason.prime();
}

const hoops = (id, school, rank, over = {}) => Object.assign({
    id, season: SEASON, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'Test', color: '#000', logos: ['a.png'],
    ...(rank == null ? {} : { preseason: { rank, barthag: 1 - rank / 400 } })
}, over);

const fbs = (id, school, over = {}) => Object.assign({
    id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'Test', color: '#000', logos: ['a.png'],
    location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1',
                latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false }
}, over);

describe('poolFor — basketball', () => {
    test('returns the top N by preseason rank, in rank order', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Worst', 300), hoops(2, 'Best', 1), hoops(3, 'Middle', 50)]);

        const pool = await draftPool.poolFor(HOOPS, { poolSize: 2 });
        expect(pool.teams.map(t => t.school)).toEqual(['Best', 'Middle']);
        expect(pool).toMatchObject({ sport: 'basketball', season: SEASON, poolSize: 2, total: 2 });
    });

    test('rank rides along, because the cap is "the top N" and the board shows it', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Best', 1)]);
        const [team] = (await draftPool.poolFor(HOOPS, { poolSize: 1 })).teams;
        expect(team.rank).toBe(1);
        // Flattened — the board should not have to reach into a subdocument.
        expect(team.preseason).toBeUndefined();
    });

    // THE ONE THAT MATTERS.
    //
    // A missing field sorts BEFORE every number in an ascending Mongo sort, so
    // sorting without filtering puts the unranked teams at the TOP and the cap
    // takes them. The pool is the right size, in a plausible order, and the
    // best teams are absent.
    test('unranked teams cannot displace ranked ones at the top of the pool', async () => {
        await leagues();
        await HoopsTeam.create([
            hoops(1, 'Unranked A', null), hoops(2, 'Unranked B', null),
            hoops(3, 'Best', 1), hoops(4, 'Second', 2)
        ]);

        const pool = await draftPool.poolFor(HOOPS, { poolSize: 2 });
        expect(pool.teams.map(t => t.school)).toEqual(['Best', 'Second']);
    });

    test('no cap means every ranked team', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 2), hoops(2, 'B', 1), hoops(3, 'No rank', null)]);
        const pool = await draftPool.poolFor(HOOPS, { poolSize: null });
        expect(pool.teams.map(t => t.school)).toEqual(['B', 'A']);
        expect(pool.poolSize).toBeNull();
    });

    test('only this season is drafted', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'This year', 1), { ...hoops(2, 'Last year', 1), season: 2026 }]);
        const pool = await draftPool.poolFor(HOOPS, { poolSize: 1 });
        expect(pool.teams.map(t => t.school)).toEqual(['This year']);
    });

    test('a cap larger than the season says to lower it, not to re-import', async () => {
        // Every team IS ranked here — the number was just typed too large, and
        // sending that commissioner to re-run an import wastes their time on a
        // script with nothing to do.
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 2)]);
        await expect(draftPool.poolFor(HOOPS, { poolSize: 5 }))
            .rejects.toThrow(/pool of 5 is larger than the 2 teams playing in 2027 — lower the cap/);
    });

    test('a season with no ranks at all REFUSES rather than drafting an arbitrary pool', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', null), hoops(2, 'B', null)]);
        await expect(draftPool.poolFor(HOOPS, { poolSize: 2 }))
            .rejects.toThrow(/None of the 2 teams for 2027 carry a preseason rank/);
    });

    test('a season with no teams at all names the ingest, not the import', async () => {
        await leagues();
        await expect(draftPool.poolFor(HOOPS, { poolSize: 2 }))
            .rejects.toThrow(/No basketball teams stored for 2027/);
    });

    // The quiet version: enough ranks to fill a smaller pool, not enough for
    // this one. It would succeed, at the right size, out of a partial import.
    test('fewer ranked teams than the cap REFUSES, rather than filling up', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 2), hoops(3, 'No rank', null)]);
        await expect(draftPool.poolFor(HOOPS, { poolSize: 3 }))
            .rejects.toThrow(/Only 2 of the 3 teams for 2027 carry a preseason rank, fewer than the pool of 3 — re-run/);
    });

    test('exactly enough ranked teams is fine', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 2)]);
        expect((await draftPool.poolFor(HOOPS, { poolSize: 2 })).teams).toHaveLength(2);
    });

    test('an explicit season overrides the league\'s own', async () => {
        // The route passes ?season through, for looking at a pool that is not
        // the one the league is currently playing.
        await leagues();
        await HoopsTeam.create([hoops(1, 'This year', 1), { ...hoops(2, 'Last year', 1), season: 2026 }]);
        const pool = await draftPool.poolFor(HOOPS, { poolSize: 1, season: 2026 });
        expect(pool.season).toBe(2026);
        expect(pool.teams.map(t => t.school)).toEqual(['Last year']);
    });

    test('a league with no season set refuses rather than querying season undefined', async () => {
        await League.create({ code: 'seasonless', name: 'No Season', sport: 'basketball' });
        await activeSeason.prime();
        await expect(draftPool.poolFor('seasonless', { poolSize: 2 }))
            .rejects.toThrow(/no basketball season set/);
    });
});

describe('poolFor — football is unchanged', () => {
    test('every FBS team, alphabetically, with no cap', async () => {
        await leagues();
        await Team.create([fbs(1, 'Zebra State'), fbs(2, 'Alpha Tech')]);
        const pool = await draftPool.poolFor(BALL, { poolSize: 1 });
        expect(pool.teams.map(t => t.school)).toEqual(['Alpha Tech', 'Zebra State']);
        // The cap is ignored, deliberately: the football pool IS the universe.
        expect(pool.poolSize).toBeNull();
        expect(pool.sport).toBe('football');
    });

    test('FCS teams stay out of it', async () => {
        // They share the collection as reference data — see modules/team-scope.js.
        await leagues();
        await Team.create([fbs(1, 'Real'), fbs(2, 'Reference', { classification: 'fcs' })]);
        expect((await draftPool.poolFor(BALL, {})).teams.map(t => t.school)).toEqual(['Real']);
    });

    test('an empty teams collection is a 503, not an empty draft board', async () => {
        // A draft room that opens with nothing in it reads as a loading bug,
        // and the commissioner retries instead of running the ingest.
        await leagues();
        await expect(draftPool.poolFor(BALL, {})).rejects.toThrow(/No FBS teams to draft/);
    });

    test('a league whose sport is unset is treated as football', async () => {
        // models/league.js defaults sport to football, and so does the cache
        // for a league it has never seen. Drafting basketball by accident is
        // the worse error of the two.
        await Team.create([fbs(1, 'Real')]);
        await activeSeason.prime();
        expect((await draftPool.poolFor('never-heard-of-it', {})).sport).toBe('football');
    });
});

describe('GET /draft/pool/:league', () => {
    test('answers the pool for a basketball league', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2), hoops(3, 'Out', 3)]);
        await Draft.create({ league: HOOPS, season: SEASON, poolSize: 2 });

        const res = await request(app).get(`/draft/pool/${HOOPS}`);
        expect(res.status).toBe(200);
        expect(res.body.teams.map(t => t.school)).toEqual(['Best', 'Next']);
    });

    test('the cap comes from the draft, so the room does not have to know it', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2)]);
        await Draft.create({ league: HOOPS, season: SEASON, poolSize: 1 });
        expect((await request(app).get(`/draft/pool/${HOOPS}`)).body.teams).toHaveLength(1);
    });

    test('?poolSize overrides it, for the admin previewing a cap', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2)]);
        await Draft.create({ league: HOOPS, season: SEASON, poolSize: 1 });
        expect((await request(app).get(`/draft/pool/${HOOPS}?poolSize=2`)).body.teams).toHaveLength(2);
    });

    test('no draft row yet is an uncapped pool, not a 404', async () => {
        // The pool is what you look at BEFORE configuring the draft.
        await leagues();
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2)]);
        const res = await request(app).get(`/draft/pool/${HOOPS}`);
        expect(res.status).toBe(200);
        expect(res.body.teams).toHaveLength(2);
    });

    test('a pool that cannot be built is a 409 that says what to run', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', null)]);
        const res = await request(app).get(`/draft/pool/${HOOPS}`);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/import-torvik-preseason/);
    });

    test('an unexpected failure is a 500 with no stack, not a hung request', async () => {
        // Express 4 does not route an async handler's rejection: an unguarded
        // throw here sends nothing at all and the draft room waits forever.
        await leagues();
        const boom = jest.spyOn(draftPool, 'poolFor').mockRejectedValueOnce(new Error('mongo exploded'));
        const res = await request(app).get(`/draft/pool/${HOOPS}`);
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('mongo exploded');
        boom.mockRestore();
    });
});
