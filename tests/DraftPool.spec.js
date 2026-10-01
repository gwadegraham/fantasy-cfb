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
        expect(pool).toMatchObject({ sport: 'basketball', season: SEASON, poolSize: 2, count: 2, seasonTotal: 3 });
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
        // Direct, because poolFor refuses this season as a half-finished
        // import before it ever sorts — so the front door cannot show whether
        // the filter does anything.
        await HoopsTeam.create([
            hoops(1, 'Unranked A', null), hoops(2, 'Unranked B', null),
            hoops(3, 'Best', 1), hoops(4, 'Second', 2)
        ]);

        const teams = await draftPool.basketballPool(SEASON, 2);
        expect(teams.map(t => t.school)).toEqual(['Best', 'Second']);
    });

    test('and the same holds for an explicit null rank, not just a missing one', async () => {
        await HoopsTeam.create([
            { ...hoops(1, 'Null rank', null), preseason: { rank: null } },
            hoops(2, 'Best', 1)
        ]);
        expect((await draftPool.basketballPool(SEASON, 1)).map(t => t.school)).toEqual(['Best']);
    });

    test('no cap means every team, in rank order', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 2), hoops(2, 'B', 1)]);
        const pool = await draftPool.poolFor(HOOPS, { poolSize: null });
        expect(pool.teams.map(t => t.school)).toEqual(['B', 'A']);
        expect(pool.poolSize).toBeNull();
    });

    // This refusal used to live inside `if (poolSize && ...)`, which switched
    // it off in the only state a real league can currently be in — nothing
    // writes poolSize yet, so every pool is uncapped. The module's main
    // refusal was unreachable in practice.
    test('a half-finished import is refused even with NO cap', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 2), hoops(3, 'No rank', null)]);
        await expect(draftPool.poolFor(HOOPS, { poolSize: null }))
            .rejects.toThrow(/Only 2 of the 3 teams for 2027 carry a preseason rank/);
    });

    // BSON sorts numbers before strings, so a rank of "1" lands at the END of
    // an ascending sort while still looking ranked to a presence check — the
    // best team in the season, missing from a pool of the right size.
    test('a rank stored as a string is not treated as ranked', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Ten', 10), hoops(2, 'Twenty', 20)]);
        await HoopsTeam.collection.insertOne({
            id: 3, season: SEASON, school: 'StringOne', conference: 'Test',
            preseason: { rank: '1' }
        });
        // Counted as unranked, so the half-import guard fires rather than the
        // pool quietly coming back without it.
        await expect(draftPool.poolFor(HOOPS, { poolSize: 2 }))
            .rejects.toThrow(/Only 2 of the 3 teams/);
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
            .rejects.toThrow(/Only 2 of the 3 teams for 2027 carry a preseason rank — re-run/);
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
        expect(pool.count).toBe(2);
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

describe('isDraftable — what makes the cap real', () => {
    // Until this existed the cap was decoration: modules/draft-socket.js takes
    // the team object from the client on make-pick and stores it as sent, so a
    // client could pick the 300th-rated program and have it land on a roster.
    test('a team inside the cap is draftable', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2), hoops(3, 'Out', 3)]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 1, poolSize: 2 })).toBe(true);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 2, poolSize: 2 })).toBe(true);
    });

    test('a team outside the cap is NOT', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Best', 1), hoops(2, 'Next', 2), hoops(3, 'Out', 3)]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 3, poolSize: 2 })).toBe(false);
    });

    test('it counts teams AHEAD rather than trusting rank <= poolSize', async () => {
        // The importer guarantees contiguous 1..N ranks, so the shortcut would
        // be right today — and would silently disagree with poolFor's
        // sort-and-limit the first time a season shipped with a gap. Ranks
        // 10/20/30 with a cap of 2: the first two are in, by position.
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 10), hoops(2, 'B', 20), hoops(3, 'C', 30)]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 1, poolSize: 2 })).toBe(true);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 2, poolSize: 2 })).toBe(true);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 3, poolSize: 2 })).toBe(false);
    });

    test('an unranked team is never draftable, cap or no cap', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'Ranked', 1), hoops(2, 'Unranked', null)]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 2, poolSize: null })).toBe(false);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 2, poolSize: 5 })).toBe(false);
    });

    test('with no cap, any ranked team is draftable', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 300)]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 2, poolSize: null })).toBe(true);
    });

    test('a team id in no pool at all is refused', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1)]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 999, poolSize: null })).toBe(false);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 'nonsense', poolSize: null })).toBe(false);
    });

    test('a team from ANOTHER season is not draftable in this one', async () => {
        await leagues();
        await HoopsTeam.create([{ ...hoops(7, 'Last year', 1), season: 2026 }]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 7 })).toBe(false);
    });

    test('the no-arguments call is false, not a crash', async () => {
        // Socket payloads are client-controlled; `make-pick` with no team at
        // all must be a refusal, not an exception inside the handler.
        await leagues();
        expect(await draftPool.isDraftable(HOOPS)).toBe(false);
    });

    test('an explicit season is honoured over the league\'s own', async () => {
        await leagues();
        await HoopsTeam.create([{ ...hoops(7, 'Last year', 1), season: 2026 }]);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 7, season: 2026 })).toBe(true);
        expect(await draftPool.isDraftable(HOOPS, { teamId: 7, season: SEASON })).toBe(false);
    });

    test('a basketball league with no season set refuses rather than throwing', async () => {
        await League.create({ code: 'seasonless', name: 'No Season', sport: 'basketball' });
        await activeSeason.prime();
        expect(await draftPool.isDraftable('seasonless', { teamId: 1 })).toBe(false);
    });

    test('football asks only whether the team is FBS', async () => {
        await leagues();
        await Team.create([fbs(1, 'Real'), fbs(2, 'Reference', { classification: 'fcs' })]);
        expect(await draftPool.isDraftable(BALL, { teamId: 1 })).toBe(true);
        expect(await draftPool.isDraftable(BALL, { teamId: 2 })).toBe(false);
        // The cap is meaningless for football and must not start applying.
        expect(await draftPool.isDraftable(BALL, { teamId: 1, poolSize: 0 })).toBe(true);
    });
});

describe('the pool carries what the board ranks on', () => {
    test('basketball rows carry the preseason metrics, flattened', async () => {
        await leagues();
        await HoopsTeam.create([Object.assign(hoops(1, 'Best', 1), {
            preseason: { rank: 1, barthag: 0.96, adjOE: 120.8, adjDE: 91, projectedRecord: '26-6' }
        })]);
        const [team] = (await draftPool.poolFor(HOOPS, {})).teams;
        expect(team).toMatchObject({
            school: 'Best', rank: 1, barthag: 0.96, adjOE: 120.8, adjDE: 91, projectedRecord: '26-6'
        });
        expect(team.preseason).toBeUndefined();
    });

    test('football rows keep the seasons subtree the board already reads', async () => {
        // buildPool() derives SP+, last season's points and expected wins from
        // it, with prev/current fallbacks and a per-league scoring version.
        // Dropping it here would blank four columns.
        await leagues();
        await Team.create([fbs(1, 'Real', {
            alternateNames: ['Realsville'],
            seasons: [
                { season: 2025, conference: 'SEC', cumulativeScoreV2: 180, spRating: 12.3, spRank: 9 },
                { season: 2026, conference: 'SEC', expectedWins: 9.4, spRating: 14.1, spRank: 7 }
            ]
        })]);
        const [team] = (await draftPool.poolFor(BALL, {})).teams;
        expect(team.alternateNames).toEqual(['Realsville']);
        expect(team.seasons.map(s => s.season)).toEqual([2025, 2026]);
        expect(team.seasons[1]).toMatchObject({ expectedWins: 9.4, spRating: 14.1, spRank: 7 });
        expect(team.seasons[0].cumulativeScoreV2).toBe(180);
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

    // S1: the lookup used to take the NEWEST draft by sort({season:-1}) and
    // apply its cap to whatever season was asked for. Every league here has
    // four drafts, so this was the normal case.
    test('the cap comes from the draft for the season being asked about', async () => {
        await leagues();
        await HoopsTeam.create([
            hoops(1, 'A26', 1), hoops(2, 'B26', 2), hoops(3, 'C26', 3)
        ].map(t => ({ ...t, season: 2026 })));
        await HoopsTeam.create([hoops(4, 'A27', 1), hoops(5, 'B27', 2), hoops(6, 'C27', 3)]);
        // 2027 inserted FIRST on purpose. The original bug took the newest
        // draft by sort({season:-1}); a lookup with no season filter and no
        // sort would take this one too, by natural order. Seeded this way the
        // test fails for either mistake, not just the one that shipped.
        await Draft.create([
            { league: HOOPS, season: SEASON, poolSize: 1 },
            { league: HOOPS, season: 2026, poolSize: 3 }
        ]);

        // BOTH seasons asserted, so the test does not rest on which document a
        // season-blind lookup happens to return — any single-lookup
        // implementation gets one of the two wrong whatever Mongo's order is.
        const older = await request(app).get(`/draft/pool/${HOOPS}?season=2026`);
        expect(older.body.poolSize).toBe(3);
        expect(older.body.teams.map(t => t.school)).toEqual(['A26', 'B26', 'C26']);

        const current = await request(app).get(`/draft/pool/${HOOPS}?season=${SEASON}`);
        expect(current.body.poolSize).toBe(1);
        expect(current.body.teams.map(t => t.school)).toEqual(['A27']);
    });

    // S2: Number('') is 0 and Number.isFinite(0) is true, so an empty admin
    // field passed the check and then read as falsy at the cap — answering
    // with the whole universe while the body said poolSize: null.
    test.each([['0'], [''], ['-3'], ['2.5']])('?poolSize=%s is a 400, not a silently uncapped pool', async (value) => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 2), hoops(3, 'C', 3)]);
        await Draft.create({ league: HOOPS, season: SEASON, poolSize: 1 });

        const res = await request(app).get(`/draft/pool/${HOOPS}?poolSize=${value}`);
        if (value === '') {
            // An absent value means "use the stored cap", which is the one
            // reading of it that is not a mistake.
            expect(res.status).toBe(200);
            expect(res.body.teams).toHaveLength(1);
        } else {
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/poolSize must be a whole number of 1 or more/);
        }
    });

    test('a non-numeric season is a 400, not a misleading "no season set"', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1)]);
        const res = await request(app).get(`/draft/pool/${HOOPS}?season=abc`);
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/season must be a year/);
    });

    test('a pool too small to finish the draft is reported, not refused', async () => {
        // It fails loudly at the last pick, unlike a pool holding the wrong
        // teams — so the job is to show it before draft night, not to block.
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 2)]);
        const mgr = () => new (require('mongoose').Types.ObjectId)();
        await Draft.create({ league: HOOPS, season: SEASON, poolSize: 2, totalRounds: 10, draftOrder: [mgr(), mgr()] });

        const res = await request(app).get(`/draft/pool/${HOOPS}`);
        expect(res.status).toBe(200);
        expect(res.body.shortfall).toEqual({ picksNeeded: 20, available: 2 });
    });

    test('a pool that covers the draft carries no shortfall', async () => {
        await leagues();
        await HoopsTeam.create([hoops(1, 'A', 1), hoops(2, 'B', 2), hoops(3, 'C', 3), hoops(4, 'D', 4)]);
        const mgr = () => new (require('mongoose').Types.ObjectId)();
        await Draft.create({ league: HOOPS, season: SEASON, poolSize: 4, totalRounds: 2, draftOrder: [mgr(), mgr()] });

        const res = await request(app).get(`/draft/pool/${HOOPS}`);
        expect(res.body.shortfall).toBeUndefined();
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
