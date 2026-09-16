// Draft grades are meant to be a frozen judgment about a roster as drafted, but
// they read spRating and the CFP futures live and both are overwritten in place
// — SP+ weekly by the enrichment job. These pin the freeze: once a draft has a
// MarketSnapshot, moving the live Team values must not move the grade.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const User = require('../models/user');
const Game = require('../models/game');
const Draft = require('../models/draft');
const MarketSnapshot = require('../models/marketSnapshot');
const draftRouter = require('../routes/draft');
const { restoreEnv } = require('./helpers/env');

const TOKEN = 'test-internal-token';

const LEAGUE = 'graham-league';
const SEASON = 2026;
const MINE = 1, OPP = 2;

// The freeze endpoint is commissioner-gated. canManageLeague() accepts a trusted
// server-to-server call, which is the cheapest way to stand in for one here.
const app = express();
app.use(express.json());
app.use('/draft', draftRouter);

useMongo();

let prevToken;
beforeAll(() => { prevToken = process.env.INTERNAL_API_TOKEN; process.env.INTERNAL_API_TOKEN = TOKEN; });
afterAll(() => { restoreEnv('INTERNAL_API_TOKEN', prevToken); });

const freeze = (body = {}, season = SEASON) =>
    request(app).post(`/draft/grades/${LEAGUE}/${season}/freeze`).set('X-Internal-Token', TOKEN).send(body);

function fullTeam(id, school, extra) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        classification: 'fbs', conference: 'Big Ten', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1',
                    latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false },
        seasons: [Object.assign({ season: SEASON, conference: 'Big Ten' }, extra)]
    };
}

let userId;
async function seed() {
    await Team.create([
        // Week 1 says this team is much stronger than it looks today — exactly
        // the Oregon case that made grades drift.
        fullTeam(MINE, 'Mine U', {
            spRating: 10, spRank: 30, expectedWins: 8, cfpMakeOdds: 500, cfpChampOdds: 5000,
            spHistory: [{ week: 1, rating: 28, rank: 3 }, { week: 2, rating: 10, rank: 30 }]
        }),
        fullTeam(OPP, 'Opponent U', { spRating: 0, expectedWins: 6, cfpMakeOdds: 2000, cfpChampOdds: 50000 })
    ]);
    await Game.create([1, 2, 3, 4].map(wk => ({
        id: 100 + wk, season: SEASON, seasonType: 'regular', week: wk,
        neutralSite: false, conferenceGame: false, completed: false,
        startTimeTbd: false, startDate: `2026-09-0${wk}T18:00:00.000Z`,
        homeId: MINE, homeTeam: 'Mine U', homeConference: 'Big Ten',
        awayId: OPP, awayTeam: 'Opponent U', awayConference: 'Big Ten'
    })));
    const u = await User.create({
        firstName: 'Pat', lastName: 'Tester', league: LEAGUE,
        seasons: [{ season: SEASON, cumulativeScore: 0, teams: [fullTeam(MINE, 'Mine U')] }]
    });
    userId = u._id;
    await Draft.create({
        league: LEAGUE, season: SEASON, status: 'complete', draftOrder: [userId],
        picks: [{ round: 1, overall: 1, userId, team: fullTeam(MINE, 'Mine U') }]
    });
}

const points = async () => {
    const res = await request(app).get(`/draft/grades/${LEAGUE}/${SEASON}`);
    expect(res.status).toBe(200);
    expect(res.body.managers).toHaveLength(1);
    return res.body;
};

beforeEach(seed);

describe('POST /draft/grades/:league/:season/freeze', () => {
    it('defaults to week 1, so the baseline is the preseason rating', async () => {
        const res = await freeze();
        expect(res.status).toBe(200);
        expect(res.body.spWeek).toBe(1);
        expect(res.body.spFromHistory).toBe(1);

        const snap = await MarketSnapshot.findById(res.body.snapshotId).lean();
        expect(snap.reason).toBe('draft-baseline');
        expect(snap.teams.find(t => t.id === MINE).spRating).toBe(28);   // not today's 10
    });

    it('can freeze today instead when spWeek is explicitly null', async () => {
        const res = await freeze({ spWeek: null });
        expect(res.status).toBe(200);
        expect(res.body.spWeek).toBeNull();
        const snap = await MarketSnapshot.findById(res.body.snapshotId).lean();
        expect(snap.teams.find(t => t.id === MINE).spRating).toBe(10);
    });

    it('404s when the league has no draft that season', async () => {
        const res = await freeze({}, 2099);
        expect(res.status).toBe(404);
    });
});

describe('GET /draft/grades — freezing', () => {
    it('is unfrozen by default and follows the live ratings', async () => {
        const before = await points();
        expect(before.frozenAt).toBeNull();

        await Team.updateOne({ id: MINE }, { $set: { 'seasons.$[s].spRating': 25 } },
            { arrayFilters: [{ 's.season': SEASON }] });
        const after = await points();
        expect(after.managers[0].projPoints).not.toBeCloseTo(before.managers[0].projPoints, 6);
    });

    it('holds still once frozen, however far the live ratings move', async () => {
        await freeze();
        const frozen = await points();
        expect(frozen.frozenAt).toBeTruthy();

        await Team.updateOne({ id: MINE },
            { $set: { 'seasons.$[s].spRating': -40, 'seasons.$[s].cfpMakeOdds': 90000,
                      'seasons.$[s].cfpChampOdds': 900000 } },
            { arrayFilters: [{ 's.season': SEASON }] });

        const after = await points();
        expect(after.managers[0].projPoints).toBeCloseTo(frozen.managers[0].projPoints, 6);
        expect(after.managers[0].grade).toBe(frozen.managers[0].grade);
    });

    it('grades off the week-1 rating, not the one on the Team doc', async () => {
        const live = await points();
        await freeze();
        const frozen = await points();
        // Week 1 had this roster at SP+ 28 against today's 10, so the frozen
        // grade must be the stronger of the two.
        expect(frozen.managers[0].projPoints).toBeGreaterThan(live.managers[0].projPoints);
    });
});
