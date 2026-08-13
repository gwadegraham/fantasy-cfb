// HTTP tests for the live draft board endpoint (routes/draft.js).
//
// The two things worth pinning: it is commissioner-gated (this is a draft-night
// advantage, not a member feature), and the projections it hands out are scored
// through the requesting league's OWN config — including powerConferences, which
// is exactly the field that has now twice failed to reach a consumer.

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const Draft = require('../models/draft');
const Team = require('../models/team');
const Game = require('../models/game');
const ScoringConfig = require('../models/scoringConfig');
const draftRouter = require('../routes/draft');

const TOKEN = 'draft-board-spec-token';
const LEAGUE = 'graham-league';
const SEASON = 2026;
const ORDER = Array.from({ length: 6 }, () => String(new mongoose.Types.ObjectId()));
const ME = ORDER[1];                                   // the 2nd seat: picks 2, 11, 14 …

const app = express();
app.use(express.json());
app.use('/draft', draftRouter);

useMongo();

let prevToken;
beforeAll(() => { prevToken = process.env.INTERNAL_API_TOKEN; process.env.INTERNAL_API_TOKEN = TOKEN; });
afterAll(() => { process.env.INTERNAL_API_TOKEN = prevToken; });

// Notre Dame (independent) plus an ACC opponent and a filler, so the
// powerConferences setting has something to bite on.
const ND = 87, BC = 103, MAC = 195;

async function seed({ powerConferences, picks = [], currentOverall = 1 } = {}) {
    // Team carries required descriptive fields of its own (colour, mascot,
    // venue); team() supplies them so the fixtures stay about ratings, which is
    // all the projection actually reads.
    const team = (id, school, conference, ratings) => ({
        id, school, conference,
        color: '#000000', abbreviation: school.slice(0, 3).toUpperCase(), mascot: 'Xs',
        location: { name: 'Stadium', city: 'City', state: 'ST' },
        seasons: [Object.assign({ season: SEASON, conference }, ratings)]
    });
    await Team.create([
        team(ND, 'Notre Dame', 'FBS Independents', { spRating: 25, expectedWins: 11.5, cfpMakeOdds: -200, cfpChampOdds: 500 }),
        team(BC, 'Boston College', 'ACC', { spRating: -2, expectedWins: 5.5, cfpMakeOdds: 20000, cfpChampOdds: 100000 }),
        team(MAC, 'Toledo', 'Mid-American', { spRating: -8, expectedWins: 7.5, cfpMakeOdds: 20000, cfpChampOdds: 100000 })
    ]);
    // One 12-game slate each so the projection has something to walk.
    const games = [];
    for (let wk = 1; wk <= 12; wk++) {
        const base = { season: SEASON, seasonType: 'regular', week: wk,
            neutralSite: false, startTimeTbd: false, startDate: `2026-09-${String(wk).padStart(2, '0')}T18:00:00.000Z` };
        games.push(Object.assign({ id: 1000 + wk, conferenceGame: false,
            homeId: ND, homeTeam: 'Notre Dame', homeConference: 'FBS Independents',
            awayId: BC, awayTeam: 'Boston College', awayConference: 'ACC' }, base));
        games.push(Object.assign({ id: 2000 + wk, conferenceGame: true,
            homeId: MAC, homeTeam: 'Toledo', homeConference: 'Mid-American',
            awayId: BC, awayTeam: 'Boston College', awayConference: 'ACC' }, base));
    }
    await Game.create(games);
    await ScoringConfig.create(Object.assign(
        { league: LEAGUE, model: 'graham', values: {}, disabled: [], enabled: [] },
        powerConferences ? { powerConferences } : {}));
    await Draft.create({ league: LEAGUE, season: SEASON, draftOrder: ORDER, snake: true, totalRounds: 10, status: 'active', currentOverall, picks });
}

const get = (q = '') => request(app).get(`/draft/board/${LEAGUE}/${SEASON}${q}`).set('X-Internal-Token', TOKEN);

describe('GET /draft/board/:league/:season', () => {
    it('refuses a caller who cannot manage the league', async () => {
        await seed();
        const res = await request(app).get(`/draft/board/${LEAGUE}/${SEASON}`);   // no token, no session
        expect(res.status).toBe(403);
    });

    it('404s when the league has no draft', async () => {
        expect((await request(app).get('/draft/board/nope-league/2026').set('X-Internal-Token', TOKEN)).status).toBe(404);
    });

    it('projects through the league config — powerConferences included', async () => {
        await seed({ powerConferences: ['ACC', 'Big 12', 'Big Ten', 'SEC', 'FBS Independents'] });
        const closed = await get(`?userId=${ME}`);
        expect(closed.status).toBe(200);
        const ndClosed = closed.body.projections.find(t => t.id === ND);

        // Same fixture, no power list → the upset bonus fires on all 12 ND games.
        await mongoose.connection.dropDatabase();
        await seed();
        const open = await get(`?userId=${ME}&refresh=1`);
        const ndOpen = open.body.projections.find(t => t.id === ND);

        // The bonus is probability-weighted, not per-game: the projection calibrates
        // to Notre Dame's 11.5 expected wins, so closing the loophole removes
        // 11.5 x 2 points, not 12 x 2.
        expect(ndOpen.regular).toBeGreaterThan(ndClosed.regular);
        expect(Math.round(ndOpen.regular - ndClosed.regular)).toBe(23);
    });

    it('reports which poll the ranked bonuses came from', async () => {
        await seed();
        expect((await get()).body.rankedSource).toMatch(/SP\+ stand-in/);
    });

    it('gives this manager their own schedule, advice and roster', async () => {
        await seed({
            currentOverall: 3,
            picks: [
                { overall: 1, round: 1, userId: ORDER[0], team: { id: MAC, school: 'Toledo' } },
                { overall: 2, round: 1, userId: ME, team: { id: ND, school: 'Notre Dame' } }
            ]
        });
        const res = await get(`?userId=${ME}`);
        expect(res.body.schedule.next.overall).toBe(11);
        expect(res.body.schedule.gap).toBe(2);            // picks 9 and 10 sit between 11 and 14... no: 12,13
        expect(res.body.roster.map(r => r.school)).toEqual(['Notre Dame']);
        // Drafted teams are off the board.
        expect(res.body.advice.take.id).toBe(BC);
    });

    // The route's own fallback for when the client sends no userId. req.effUser is
    // the OIDC profile, so the id lives in nested metadata — reading a top-level
    // _id yielded '' and silently reported "your draft is complete".
    it('falls back to the signed-in user id from nested Auth0 metadata', async () => {
        await seed();
        const asUser = express();
        asUser.use(express.json());
        asUser.use((req, _res, next) => {
            req.effUser = { sub: 'auth0|abc', user_metadata: { roles: ['Admin'], metadata: { league: 'gg', userId: ME } } };
            next();
        });
        asUser.use('/draft', draftRouter);
        const res = await request(asUser).get(`/draft/board/${LEAGUE}/${SEASON}`).set('X-Internal-Token', TOKEN);
        expect(res.status).toBe(200);
        expect(res.body.schedule.next.overall).toBe(2);      // the 2nd seat, resolved
        expect(res.body.schedule.gap).toBe(8);
    });

    it('degrades to no schedule rather than erroring for an unknown user', async () => {
        await seed();
        const res = await get('?userId=not-in-this-draft');
        expect(res.status).toBe(200);
        expect(res.body.schedule.next).toBeNull();
        expect(res.body.projections.length).toBeGreaterThan(0);
    });

    it('caches projections but still reflects new picks', async () => {
        await seed();
        const first = await get(`?userId=${ME}`);
        expect(first.body.advice.take).not.toBeNull();
        await Draft.findOneAndUpdate({ league: LEAGUE, season: SEASON },
            { $set: { currentOverall: 3 }, $push: { picks: { overall: 2, round: 1, userId: ME, team: { id: ND, school: 'Notre Dame' } } } });
        const second = await get(`?userId=${ME}`);
        expect(second.body.roster.map(r => r.school)).toEqual(['Notre Dame']);
        expect(second.body.projections.length).toBe(first.body.projections.length);
        expect(second.body.advice.take.id).not.toBe(ND);
    });
});
