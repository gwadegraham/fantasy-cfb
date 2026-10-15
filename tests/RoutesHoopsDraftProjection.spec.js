// The basketball draft board, draft grades and grade freeze (routes/draft.js),
// against a real (in-memory) Mongo.
//
// What these pin:
//   - numbers come from hoopsteams / hoopsgames and the basketball engine,
//     never from Team / Game — whose ids collide with basketball's. Two of
//     the fixture ids are ALSO football teams here, with football games, so
//     a read of the wrong collection changes an answer.
//   - the board is Captain-aware exactly when the league's season turns the
//     Captain on, as football's is.
//   - a frozen grade does not move when the ratings are re-imported or the
//     schedule changes; an unfrozen one does (so the mutation is not inert).

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const { restoreEnv } = require('./helpers/env');
const Draft = require('../models/draft');
const Team = require('../models/team');
const Game = require('../models/game');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsGame = require('../models/hoopsGame');
const HoopsGradeSnapshot = require('../models/hoopsGradeSnapshot');
const ScoringConfig = require('../models/scoringConfig');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const visibility = require('../modules/hoops-visibility');
const hoopsDraft = require('../modules/hoops-draft-projection');
const { resolveConfig } = require('../modules/scoring-defaults');
const draftRouter = require('../routes/draft');

const TOKEN = 'hoops-draft-spec-token';
const LEAGUE = 'hoops-league';
const SEASON = 2027;
const A = String(new mongoose.Types.ObjectId());
const B = String(new mongoose.Types.ObjectId());

const app = express();
app.use(express.json());
app.use('/draft', draftRouter);

useMongo();

let prevToken;
beforeAll(() => { prevToken = process.env.INTERNAL_API_TOKEN; process.env.INTERNAL_API_TOKEN = TOKEN; });
afterAll(() => { restoreEnv('INTERNAL_API_TOKEN', prevToken); });

// Eight teams, ranked 1..8. 150 and 87 are ALSO football ids below.
const IDS = [150, 87, 2, 333, 41, 52, 64, 90];
const CONFS = ['ACC', 'Big Ten', 'SEC'];
const hoopsTeam = (id, i) => ({
    id, season: SEASON, school: `Hoops ${id}`, conference: CONFS[i % 3], logos: [`h${id}.png`],
    preseason: { rank: i + 1, barthag: 0.96 - i * 0.05, adjOE: 124 - i, adjDE: 92 + i,
                 projectedRecord: `${26 - i}-${5 + i}` }
});

// A double round robin, two games a week, the home side alternating.
function hoopsGames() {
    const out = [];
    let gid = 1, n = 0;
    for (let i = 0; i < IDS.length; i++) {
        for (let j = i + 1; j < IDS.length; j++) {
            [[IDS[i], IDS[j]], [IDS[j], IDS[i]]].forEach(([home, away]) => {
                const week = 1 + Math.floor(n++ / 8);
                out.push({ id: 7000 + gid++, season: SEASON, seasonType: 'regular', week, status: 'scheduled',
                    startDate: new Date(Date.UTC(2026, 10, 3 + week * 7)), neutralSite: false, conferenceGame: false,
                    homeTeamId: home, homeTeam: `Hoops ${home}`, awayTeamId: away, awayTeam: `Hoops ${away}` });
            });
        }
    }
    return out;
}

async function seed({ captainEnabled = true, picks, status = 'complete' } = {}) {
    await League.create({ code: LEAGUE, name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                              { sport: 'basketball', season: SEASON, status: 'preseason' }]);
    await seasons.prime();

    await HoopsTeam.create(IDS.map(hoopsTeam));
    await HoopsGame.create(hoopsGames());

    // Football rows under the SAME ids, with numbers nothing like basketball's.
    const fb = (id, school) => ({ id, school, conference: 'SEC', color: '#000', abbreviation: 'FB', mascot: 'X',
        location: { name: 'S', city: 'C', state: 'ST' },
        seasons: [{ season: SEASON, conference: 'SEC', spRating: 40, expectedWins: 12, cfpMakeOdds: -1000, cfpChampOdds: 100 }] });
    await Team.create([fb(150, 'Football 150'), fb(87, 'Football 87')]);
    await Game.create([1, 2, 3].map(wk => ({ id: 7000 + wk, season: SEASON, seasonType: 'regular', week: wk,
        neutralSite: false, conferenceGame: true, startTimeTbd: false, startDate: `2027-09-0${wk}T18:00:00.000Z`,
        homeId: 150, homeTeam: 'Football 150', homeConference: 'SEC', awayId: 87, awayTeam: 'Football 87', awayConference: 'SEC' })));

    await ScoringConfig.create({ league: LEAGUE, model: 'hoops', values: {}, disabled: [], enabled: [],
        engagementBySeason: { [SEASON]: { captainEnabled, captainMultiplier: 2, h2hEnabled: true } } });

    await Draft.create({
        league: LEAGUE, season: SEASON, status, snake: true, totalRounds: 2, poolSize: 6,
        draftOrder: [A, B], currentOverall: picks ? picks.length + 1 : 5,
        picks: picks || [
            { overall: 1, round: 1, userId: A, team: { id: 150, school: 'Hoops 150' } },
            { overall: 2, round: 1, userId: B, team: { id: 87, school: 'Hoops 87' } },
            { overall: 3, round: 2, userId: B, team: { id: 2, school: 'Hoops 2' } },
            { overall: 4, round: 2, userId: A, team: { id: 333, school: 'Hoops 333' } }
        ]
    });
}

afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

// The engine's answer straight from the fixture rows: what every route
// number must equal.
function expected(teamIds) {
    const games = hoopsGames();
    const teams = IDS.map(hoopsTeam);
    const proj = hoopsDraft.projectHoopsTeams(teams, games, {
        cfg: resolveConfig(LEAGUE, { model: 'hoops' }), projectIds: IDS });
    return teamIds.reduce((s, id) => s + proj[String(id)].total, 0);
}

const grades = () => request(app).get(`/draft/grades/${LEAGUE}/${SEASON}`);
const freeze = () => request(app).post(`/draft/grades/${LEAGUE}/${SEASON}/freeze`).set('X-Internal-Token', TOKEN).send({});
// refresh=1 every time: the board caches projections per league+season in
// the module, and each test seeds its own world.
const board = () => request(app).get(`/draft/board/${LEAGUE}/${SEASON}?userId=${A}&refresh=1`).set('X-Internal-Token', TOKEN);

describe('GET /draft/grades — a basketball league', () => {
    beforeEach(() => { jest.spyOn(visibility, 'seesBasketball').mockResolvedValue(true); });

    it('grades each roster on the basketball projection of its own teams', async () => {
        await seed();
        const res = await grades();
        expect(res.status).toBe(200);
        expect(res.body.sport).toBe('basketball');
        expect(res.body.rankSource).toBe(hoopsDraft.RANK_SOURCE);
        expect(res.body.frozenAt).toBeNull();
        const a = res.body.managers.find(m => m.userId === A);
        const b = res.body.managers.find(m => m.userId === B);
        // Football's 150 and 87 (SP+ 40, 12 wins, CFP favourites) would read
        // nothing like these.
        expect(a.projPoints).toBe(Math.round(expected([150, 333])));
        expect(b.projPoints).toBe(Math.round(expected([87, 2])));
        expect(a.regPoints).toBeGreaterThan(0);
        expect(a.ncaaCount).toBeGreaterThan(0);
        expect(a).not.toHaveProperty('cfpCount');
    });

    it('a draft with no picks has no managers', async () => {
        await seed({ picks: [], status: 'pending' });
        const res = await grades();
        expect(res.body).toEqual(expect.objectContaining({ sport: 'basketball', managers: [] }));
    });

    it('no rated teams means no managers, not a league of zero-point Ds', async () => {
        await seed();
        await HoopsTeam.updateMany({}, { $unset: { 'preseason.rank': 1 } });
        const res = await grades();
        expect(res.status).toBe(200);
        expect(res.body.managers).toEqual([]);
    });
});

describe('POST /draft/grades/:league/:season/freeze — a basketball league', () => {
    beforeEach(() => { jest.spyOn(visibility, 'seesBasketball').mockResolvedValue(true); });

    // Rewrites what a re-import of the Torvik paste and a schedule change
    // would: ratings, ranks and records, a cancelled game and a dropped one.
    async function churn() {
        await HoopsTeam.updateOne({ season: SEASON, id: 150 },
            { $set: { 'preseason.barthag': 0.41, 'preseason.rank': 8, 'preseason.projectedRecord': '12-19' } });
        await HoopsTeam.updateOne({ season: SEASON, id: 90 },
            { $set: { 'preseason.barthag': 0.97, 'preseason.rank': 1 } });
        await HoopsGame.updateOne({ id: 7001 }, { $set: { status: 'cancelled' } });
        await HoopsGame.deleteOne({ id: 7002 });
    }

    it('an unfrozen grade follows the live rows (so the churn below is not inert)', async () => {
        await seed();
        const before = (await grades()).body.managers.find(m => m.userId === A);
        await churn();
        const after = (await grades()).body.managers.find(m => m.userId === A);
        expect(after.projPoints).not.toBe(before.projPoints);
    });

    it('a frozen grade holds through a re-import and a schedule change', async () => {
        await seed();
        const live = await grades();
        const res = await freeze();
        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({ sport: 'basketball', teamCount: 8, rankSource: hoopsDraft.RANK_SOURCE }));
        // Every game touching the 6-team pool: all but the two 64-v-90 games.
        expect(res.body.gameCount).toBe(hoopsGames().length - 2);

        const draft = await Draft.findOne({ league: LEAGUE, season: SEASON }).lean();
        expect(String(draft.hoopsGradeSnapshot)).toBe(res.body.snapshotId);
        expect(draft.gradeSnapshot).toBeNull();          // football's pin untouched

        await churn();
        const frozen = await grades();
        expect(frozen.body.frozenAt).toBeTruthy();
        expect(frozen.body.managers).toEqual(live.body.managers);
    });

    // The snapshot holds only the frozen pool's games. A cap raised later
    // would band in teams it has no schedule for.
    it('a frozen grade holds when the pool cap changes after the freeze', async () => {
        await seed();
        // A 3-team pool, so the replacement anchor (rank L·R = 4) sits at the
        // pool's end and a wider pool would move it.
        await Draft.updateOne({ league: LEAGUE, season: SEASON }, { $set: { poolSize: 3 } });
        await freeze();
        const frozen = await grades();
        await Draft.updateOne({ league: LEAGUE, season: SEASON }, { $set: { poolSize: 8 } });
        const live = await request(app).post(`/draft/grades/${LEAGUE}/${SEASON}/freeze`).set('X-Internal-Token', TOKEN);
        const wider = await grades();                       // what an 8-team pool grades to
        // The fixture has to tell the two pools apart, or this proves nothing.
        expect(wider.body.managers.map(m => m.grade)).not.toEqual(frozen.body.managers.map(m => m.grade));
        // Re-pin the 3-team snapshot and raise the cap again: the grade holds.
        await Draft.updateOne({ league: LEAGUE, season: SEASON },
            { $set: { hoopsGradeSnapshot: (await HoopsGradeSnapshot.findOne({ poolSize: 3 }).lean())._id } });
        expect(live.body.snapshotId).toBeTruthy();
        const after = await grades();
        expect(after.body.managers).toEqual(frozen.body.managers);
    });

    it('snapshots basketball rows only, whatever football holds under the same ids', async () => {
        await seed();
        const res = await freeze();
        const snap = await HoopsGradeSnapshot.findById(res.body.snapshotId).lean();
        expect(snap.teams.find(t => t.id === 150)).toEqual(expect.objectContaining({ school: 'Hoops 150', rank: 1, barthag: 0.96 }));
        expect(snap.games.every(g => g.homeTeamId != null && g.awayTeamId != null)).toBe(true);
    });

    it('404s with no draft, and 400s with nothing rated to freeze', async () => {
        await seed();
        expect((await request(app).post(`/draft/grades/${LEAGUE}/2099/freeze`).set('X-Internal-Token', TOKEN)).status).toBe(404);
        await HoopsTeam.updateMany({}, { $unset: { 'preseason.rank': 1 } });
        expect((await freeze()).status).toBe(400);
    });
});

// The grade bands the pool with poolOf (in memory); the room and the board
// draft from draft-pool's basketballPool (in Mongo). Two definitions of one
// pool must agree, ties and unranked rows included.
describe('poolOf against draft-pool basketballPool', () => {
    it('picks the same teams in the same order', async () => {
        const rows = [[11, 3], [5, 1], [9, 3], [2, 2], [30, 3], [8, null], [4, 7]].map(([id, rank], i) =>
            ({ id, season: SEASON, school: `T${id}`, conference: CONFS[i % 3], preseason: rank == null ? {} : { rank } }));
        await HoopsTeam.create(rows);
        const draftPool = require('../modules/draft-pool');
        for (const size of [3, 4, null]) {
            const mongo = (await draftPool.basketballPool(SEASON, size)).map(t => t.id);
            const mem = hoopsDraft.poolOf(await HoopsTeam.find({ season: SEASON }, hoopsDraft.TEAM_FIELDS).lean(), size).map(t => t.id);
            expect(mem).toEqual(mongo);
        }
    });
});

describe('GET /draft/board — a basketball league', () => {
    it('projects the basketball pool, best first, from hoopsteams and hoopsgames', async () => {
        await seed({ status: 'active', picks: [] });
        const res = await board();
        expect(res.status).toBe(200);
        expect(res.body.sport).toBe('basketball');
        expect(res.body.rankedSource).toBe(hoopsDraft.RANK_SOURCE);
        const p = res.body.projections;
        expect(p).toHaveLength(6);                        // poolSize, not all 8
        expect(p.map(t => t.id).sort((x, y) => x - y)).toEqual([2, 41, 52, 87, 150, 333]);
        for (let i = 1; i < p.length; i++) expect(p[i - 1].total).toBeGreaterThanOrEqual(p[i].total);
        const top = p.find(t => t.id === 150);
        expect(top.school).toBe('Hoops 150');             // not Football 150
        expect(top.logo).toBe('h150.png');
        expect(top.total).toBeCloseTo(Math.round(expected([150]) * 10) / 10, 6);
        expect(top.post).toBeGreaterThan(0);
        expect(top.total).toBeCloseTo(top.regular + top.post, 0);
    });

    it('is Captain-aware when the league plays Captain this season', async () => {
        await seed({ status: 'active', picks: [] });
        const res = await board();
        expect(res.body.captain).toEqual(expect.objectContaining({ enabled: true, multiplier: 2 }));
        // An empty roster: the first pick also picks the season captain, so
        // its whole regular projection is added once more.
        const take = res.body.advice.take;
        expect(res.body.advice.captain.enabled).toBe(true);
        expect(res.body.advice.captain.gain).toBeCloseTo(take.regular, 1);
    });

    it('and is pure board value when it does not', async () => {
        await seed({ status: 'active', picks: [], captainEnabled: false });
        const res = await board();
        expect(res.body.captain.enabled).toBe(false);
        expect(res.body.advice.captain).toEqual({ enabled: false, gain: 0, settled: false });
    });

    it('prices the roster it has drafted, and takes drafted teams off the board', async () => {
        await seed({ status: 'active', picks: [{ overall: 1, round: 1, userId: A, team: { id: 150, school: 'Hoops 150' } }] });
        const res = await board();
        expect(res.body.roster).toEqual([expect.objectContaining({ id: 150, school: 'Hoops 150' })]);
        expect(res.body.roster[0].total).toBeGreaterThan(0);
        expect(res.body.advice.take.id).not.toBe(150);
        expect(res.body.captain.anchorSchool).toBe('Hoops 150');
    });

    it('has no numbers when no team carries a preseason rating', async () => {
        await seed({ status: 'active', picks: [] });
        await HoopsTeam.updateMany({}, { $unset: { 'preseason.rank': 1 } });
        const res = await board();
        expect(res.status).toBe(200);
        expect(res.body.projections).toBeNull();
        expect(res.body.advice).toBeNull();
    });

    // A conference slate not yet published leaves a team with half a
    // schedule, which projects like a weak team. The board and the freeze
    // both name it.
    it('names a pool team whose stored schedule is short, on the board and the freeze', async () => {
        await seed({ status: 'active', picks: [] });
        const full = await board();
        expect(full.body.thinSchedules).toEqual([]);
        const mine = hoopsGames().filter(g => g.homeTeamId === 333 || g.awayTeamId === 333).map(g => g.id);
        await HoopsGame.deleteMany({ id: { $in: mine.slice(0, 8) } });           // 14 games -> 6
        const res = await board();
        expect(res.body.thinSchedules).toEqual([{ id: 333, school: 'Hoops 333', games: 6 }]);
        expect(res.body.projections.find(t => t.id === 333).games).toBe(6);
        const frozen = await freeze();
        expect(frozen.body.thinSchedules).toEqual([{ id: 333, school: 'Hoops 333', games: 6 }]);
    });

    it('a pool cap changed during draft prep is not answered from the old pool\'s cache', async () => {
        await seed({ status: 'active', picks: [] });
        expect((await board()).body.projections).toHaveLength(6);
        await Draft.updateOne({ league: LEAGUE, season: SEASON }, { $set: { poolSize: 8 } });
        const res = await request(app).get(`/draft/board/${LEAGUE}/${SEASON}?userId=${A}`).set('X-Internal-Token', TOKEN);
        expect(res.body.projections).toHaveLength(8);
    });

    // The page hides Recompute when there are no numbers, so a cached "none"
    // would outlive the import that fixes it.
    it('does not cache the no-numbers answer', async () => {
        await seed({ status: 'active', picks: [] });
        await HoopsTeam.updateMany({}, { $unset: { 'preseason.rank': 1 } });
        expect((await board()).body.projections).toBeNull();
        await HoopsTeam.deleteMany({});
        await HoopsTeam.create(IDS.map(hoopsTeam));                 // the import runs
        const res = await request(app).get(`/draft/board/${LEAGUE}/${SEASON}?userId=${A}`).set('X-Internal-Token', TOKEN);
        expect(res.body.projections).toHaveLength(6);
    });
});
