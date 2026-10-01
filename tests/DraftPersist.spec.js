// persistTeamsToUsers — what a finished draft writes onto a roster (#478).
//
// WHY THIS FILE EXISTS: the write path shipped with no coverage. Replacing the
// sport branch so it always sent `teams`, and deleting the PATCH's `teamRefs`
// handling, EACH left the whole suite green. That is the same gap as the pool
// gate in #476 — in this same file, one PR later — so the function is exported
// now and exercised here.
//
// It talks to PATCH /users/draft/:id over internalFetch, so the route is
// mounted for real and internalFetch is pointed at it. A mock of the fetch
// would test the payload and miss what the route does with it, which is where
// both halves of the bug were.

const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const Franchise = require('../models/franchise');
const Account = require('../models/account');
const migration = require('../modules/account-migration');
const { rosterTeams, rosterSize } = require('../modules/roster-teams');
const { persistTeamsToUsers } = require('../modules/draft-socket');
const HoopsTeam = require('../models/hoopsTeam');
const usersRouter = require('../routes/users');

useMongo();

const BALL = 'graham-league';
const HOOPS = 'hoops-league';

let server;

const LOC = { venue_id: 7, name: 'V', city: 'C', state: 'ST', zip: '1',
              latitude: 1, longitude: 1, capacity: 1, grass: true, dome: false };
const fbs = (id, school) => ({
    id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'SEC', color: '#000', logos: ['a.png'], location: LOC
});
const hoops = (id, school, season) => ({
    id, season, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
    conference: 'ACC', color: '#000', logos: ['a.png'], preseason: { rank: id }
});

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/users', usersRouter);
    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    process.env.URL = `http://localhost:${server.address().port}`;
    process.env.INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || 'test-internal-token';
});
afterAll(async () => { if (server) await new Promise(r => server.close(r)); });

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    activeSeason._reset();
    await League.create([
        { code: BALL, name: 'Graham', sport: 'football', season: 2026 },
        { code: HOOPS, name: 'Hoops', sport: 'basketball', season: 2027 }
    ]);
    await SportSeason.create([
        { sport: 'football', season: 2026, status: 'in-season' },
        { sport: 'basketball', season: 2027, status: 'in-season' }
    ]);
    await activeSeason.prime();
});
afterEach(() => jest.restoreAllMocks());

async function manager(league, season) {
    const u = await User.create({ firstName: 'Ann', lastName: 'Test', league, seasons: [{ season }] });
    await migration.migrate({ apply: true });
    return u;
}

const draftOf = (league, season, userId, teams) => ({
    league, season,
    picks: teams.map((team, i) => ({ round: 1, overall: i + 1, userId, team }))
});

describe('football still writes the whole team', () => {
    test('the roster holds the documents, and no refs', async () => {
        const u = await manager(BALL, 2026);
        const { failed } = await persistTeamsToUsers(draftOf(BALL, 2026, u._id, [fbs(1, 'Alabama'), fbs(2, 'Auburn')]));
        expect(failed).toEqual([]);

        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        const entry = fr.seasons.find(s => s.season === 2026);
        expect(entry.teams.map(t => t.school)).toEqual(['Alabama', 'Auburn']);
        expect(entry.teams[0].location).toMatchObject({ name: 'V' });
        // The empty array that `default: undefined` exists to prevent.
        expect(entry.teamRefs).toBeUndefined();
    });
});

describe('basketball writes references', () => {
    test('the roster holds refs, not copies — and resolves back to the teams', async () => {
        const u = await manager(HOOPS, 2027);
        await HoopsTeam.create([hoops(10, 'Duke', 2027), hoops(20, 'Gonzaga', 2027)]);

        const { failed } = await persistTeamsToUsers(
            draftOf(HOOPS, 2027, u._id, [hoops(10, 'Duke', 2027), hoops(20, 'Gonzaga', 2027)]));
        expect(failed).toEqual([]);

        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        const entry = fr.seasons.find(s => s.season === 2027);
        expect(entry.teamRefs).toEqual([
            { id: 10, sport: 'basketball' }, { id: 20, sport: 'basketball' }
        ]);
        // The whole point: it reads back as teams.
        expect((await rosterTeams(fr, 2027)).map(t => t.school)).toEqual(['Duke', 'Gonzaga']);
        expect(rosterSize(fr, 2027)).toBe(2);
    });

    // Reachable: #477 made a basketball team storable in `teams`, so a hoops
    // league that drafted between #477 and #478 is in exactly this state. With
    // both fields set, rosterTeams prefers the copies and the new refs are
    // invisible — forever, however often the draft is re-run.
    test('writing refs CLEARS the stale embedded copies', async () => {
        const u = await manager(HOOPS, 2027);
        await HoopsTeam.create([hoops(10, 'Duke', 2027)]);
        await Franchise.updateOne({ accountId: u._id },
            { $set: { 'seasons.0.teams': [fbs(99, 'Stale Copy')] } });

        await persistTeamsToUsers(draftOf(HOOPS, 2027, u._id, [hoops(10, 'Duke', 2027)]));

        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        const entry = fr.seasons.find(s => s.season === 2027);
        expect(entry.teams || []).toEqual([]);
        expect((await rosterTeams(fr, 2027)).map(t => t.school)).toEqual(['Duke']);
    });
});

describe('a roster that cannot be written is reported, not swallowed', () => {
    test('the failed manager is named', async () => {
        // The response used to be discarded entirely, which is how a draft
        // could complete with every roster empty and nothing in any log.
        const u = await manager(BALL, 2026);
        const broken = { id: 1, school: 'No Mascot' };   // mascot is required
        const { failed } = await persistTeamsToUsers(draftOf(BALL, 2026, u._id, [broken]));

        expect(failed).toHaveLength(1);
        expect(failed[0]).toContain(String(u._id));
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('FAILED to persist'));
    });

    test('one manager failing does not stop the others', async () => {
        const ann = await manager(BALL, 2026);
        const bob = await User.create({ firstName: 'Bob', lastName: 'T', league: BALL, seasons: [{ season: 2026 }] });
        await migration.migrate({ apply: true });

        const draft = { league: BALL, season: 2026, picks: [
            { round: 1, overall: 1, userId: ann._id, team: { id: 1, school: 'No Mascot' } },
            { round: 1, overall: 2, userId: bob._id, team: fbs(2, 'Auburn') }
        ] };
        const { failed } = await persistTeamsToUsers(draft);

        expect(failed).toHaveLength(1);
        const bobFr = await Franchise.findOne({ accountId: bob._id }).lean();
        expect(bobFr.seasons.find(s => s.season === 2026).teams.map(t => t.school)).toEqual(['Auburn']);
    });
});

describe('PATCH /users/draft/:id', () => {
    const request = require('supertest');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.headers['x-internal-token'] = process.env.INTERNAL_API_TOKEN; next(); });
    app.use('/users', usersRouter);

    test('sending both shapes is refused, even with no season', async () => {
        // The guard used to sit inside the season check, so this answered 200
        // and wrote nothing — which reads as success.
        const u = await manager(BALL, 2026);
        const res = await request(app).patch(`/users/draft/${u._id}`)
            .send({ teams: [fbs(1, 'Alabama')], teamRefs: [{ id: 10, sport: 'basketball' }] });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/not both/);
    });

    test('a season the manager never had is created with refs', async () => {
        const u = await manager(HOOPS, 2027);
        await HoopsTeam.create([hoops(10, 'Duke', 2028)]);
        const res = await request(app).patch(`/users/draft/${u._id}`)
            .send({ season: 2028, teamRefs: [{ id: 10, sport: 'basketball' }] });
        expect(res.status).toBe(200);

        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        expect(fr.seasons.find(s => s.season === 2028).teamRefs).toEqual([{ id: 10, sport: 'basketball' }]);
    });

    test('neither shape leaves the roster alone', async () => {
        const u = await manager(BALL, 2026);
        await Franchise.updateOne({ accountId: u._id }, { $set: { 'seasons.0.teams': [fbs(1, 'Alabama')] } });
        const res = await request(app).patch(`/users/draft/${u._id}`).send({ season: 2026 });
        expect(res.status).toBe(200);

        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        expect(fr.seasons.find(s => s.season === 2026).teams.map(t => t.school)).toEqual(['Alabama']);
    });
});

describe('GET /league/:code/roster — the admin Season Roster panel', () => {
    // hasPlayed drove off `x.teams.length`, so every basketball manager read
    // as never drafted — which the panel renders as "no login", the opposite
    // of the truth.
    //
    // Through the ROUTE, not by re-running its expression in the test: an
    // assertion that reimplements the thing it checks passes whatever the
    // route does, which is how the first version of this test was green
    // against the unfixed code.
    const request = require('supertest');
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use((req, res, next) => { req.headers['x-internal-token'] = process.env.INTERNAL_API_TOKEN; next(); });
    adminApp.use('/users', usersRouter);

    test('a ref-only roster counts as having played', async () => {
        const u = await manager(HOOPS, 2027);
        await HoopsTeam.create([hoops(10, 'Duke', 2027)]);
        await persistTeamsToUsers(draftOf(HOOPS, 2027, u._id, [hoops(10, 'Duke', 2027)]));

        const res = await request(adminApp).get(`/users/league/${HOOPS}/roster`);
        expect(res.status).toBe(200);
        const row = res.body.players.find(r => String(r._id) === String(u._id));
        expect(row.hasPlayed).toBe(true);
    });

    test('and a manager who has drafted nothing still reads as not having played', async () => {
        const u = await manager(HOOPS, 2027);
        const res = await request(adminApp).get(`/users/league/${HOOPS}/roster`);
        const row = res.body.players.find(r => String(r._id) === String(u._id));
        expect(row.hasPlayed).toBe(false);
    });

    test('football is unchanged', async () => {
        const u = await manager(BALL, 2026);
        await persistTeamsToUsers(draftOf(BALL, 2026, u._id, [fbs(1, 'Alabama')]));
        const res = await request(adminApp).get(`/users/league/${BALL}/roster`);
        expect(res.body.players.find(r => String(r._id) === String(u._id)).hasPlayed).toBe(true);
    });
});

describe('a football season never grows an empty teamRefs', () => {
    // Without `default: undefined` mongoose materialises `teamRefs: []` on
    // every football season — in storage AND in the PATCH response, which
    // franchise-repo states four times it keeps byte-identical. The nightly
    // scoring write would have backfilled it across every franchise.
    test('not on the stored document', async () => {
        const u = await manager(BALL, 2026);
        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        for (const entry of fr.seasons) {
            expect(Object.keys(entry)).not.toContain('teamRefs');
        }
    });

    test('and not after a roster write', async () => {
        const u = await manager(BALL, 2026);
        await persistTeamsToUsers(draftOf(BALL, 2026, u._id, [fbs(1, 'Alabama')]));
        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        expect(Object.keys(fr.seasons.find(s => s.season === 2026))).not.toContain('teamRefs');
    });
});

describe('ids', () => {
    test('an unusable id drops that pick rather than the whole roster', async () => {
        const u = await manager(HOOPS, 2027);
        await HoopsTeam.create([hoops(10, 'Duke', 2027)]);
        const draft = draftOf(HOOPS, 2027, u._id, [{ id: 'abc', school: 'Bad' }, hoops(10, 'Duke', 2027)]);

        const { failed } = await persistTeamsToUsers(draft);
        expect(failed).toEqual([]);

        const fr = await Franchise.findOne({ accountId: u._id }).lean();
        expect(fr.seasons.find(s => s.season === 2027).teamRefs).toEqual([{ id: 10, sport: 'basketball' }]);
    });
});
