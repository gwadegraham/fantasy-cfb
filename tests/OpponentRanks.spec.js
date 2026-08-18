// Opponent poll rankings on the matchup card and the Captain picker.
//
// Much of the scoring model's value is in beating ranked teams — rankValue pays
// double for a top-10 win and single for 11-25 — but neither surface showed who
// was ranked, so both the weekly read and the Captain pick were made blind to
// the thing that most moves the points.
//
// The rank comes from the poll the SCORER reads: the Playoff Committee's, else
// AP (scoring-detectors findPoll). Not the Coaches Poll, which the app stores
// too — a rank on a card has to mean "this win pays the ranked bonus", and a
// number from a poll the scorer ignores would promise a bonus that never lands.
//
// Runs against an in-memory Mongo with the real models and the real routes.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const Ranking = require('../models/ranking');
const ScoringConfig = require('../models/scoringConfig');
const standingsRouter = require('../routes/standings');
const usersRouter = require('../routes/users');

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const LSU = 1, TEXAS = 2, DUKE = 3, MIAMI = 4;
const CLEMSON = 97, GEORGIA = 98, TXST = 99, CUPCAKE = 96;

function fullTeam(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 4).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}
const KICK = '2099-09-05T23:30:00.000Z';
function game(id, homeId, homeTeam, awayId, awayTeam) {
    return {
        id, season: SEASON, week: 1, seasonType: 'regular',
        startDate: KICK, startTimeTbd: false, neutralSite: false, conferenceGame: false,
        homeId, homeTeam, awayId, awayTeam, homePoints: null, awayPoints: null, completed: false
    };
}
// Georgia top-10, Clemson in the 11-25 band, Texas State unranked.
async function poll(name) {
    await Ranking.create({
        season: SEASON, seasonType: 'regular', week: 1,
        polls: [{ poll: name, ranks: [
            { rank: 3, school: 'Georgia', conference: 'SEC' },
            { rank: 23, school: 'Clemson', conference: 'ACC' }
        ] }]
    });
}
async function seedTeams() {
    await Team.create([[LSU,'LSU'],[TEXAS,'Texas'],[DUKE,'Duke'],[MIAMI,'Miami'],
                       [CLEMSON,'Clemson'],[GEORGIA,'Georgia'],[TXST,'Texas State'],[CUPCAKE,'Cupcake']]
        .map(([id, school]) => Object.assign(fullTeam(id, school), {
            seasons: [{ season: SEASON, conference: 'SEC', spRating: 10, expectedWins: 0.5 }]
        })));
}
async function seedGames() {
    await Game.create([
        game(101, LSU, 'LSU', CLEMSON, 'Clemson'),        // ranked #23 opponent, at home
        game(102, GEORGIA, 'Georgia', TEXAS, 'Texas'),     // Texas on the road at #3
        game(103, DUKE, 'Duke', TXST, 'Texas State'),      // unranked opponent
        game(104, MIAMI, 'Miami', CUPCAKE, 'Cupcake')
    ]);
}

// ---- the matchup card's payload -------------------------------------------
const h2hApp = express();
h2hApp.use(express.json());
h2hApp.use('/standings', standingsRouter);

async function seedH2H() {
    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } }
    });
    await seedTeams();
    await seedGames();
    const ann = await User.create({
        firstName: 'Ann', lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams: [fullTeam(LSU, 'LSU'), fullTeam(TEXAS, 'Texas')], weeklyScore: [{ week: 1, score: 0, scoreByTeam: [] }], cumulativeScore: 0 }]
    });
    await User.create({
        firstName: 'Bob', lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams: [fullTeam(DUKE, 'Duke'), fullTeam(MIAMI, 'Miami')], weeklyScore: [{ week: 1, score: 0, scoreByTeam: [] }], cumulativeScore: 0 }]
    });
    return ann;
}
function rowsFor(body, annId) {
    const g = body.schedule.find(s => s.week === 1).games[0];
    return String(g.aId) === String(annId) ? g.aTeams : g.bTeams;
}

describe('opponent ranks on the matchup card', () => {
    test('carry the rank from the AP poll, and null when unranked', async () => {
        const ann = await seedH2H();
        await poll('AP Top 25');

        const res = await request(h2hApp).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        const rows = rowsFor(res.body, ann._id);

        expect(rows.find(t => t.teamId === LSU)).toMatchObject({ opp: 'CLEM', oppRank: 23 });
        expect(rows.find(t => t.teamId === TEXAS)).toMatchObject({ opp: 'GEOR', ha: '@', oppRank: 3 });
    });

    test('the Playoff Committee poll wins when both are stored', async () => {
        const ann = await seedH2H();
        await poll('AP Top 25');
        await Ranking.updateOne({ season: SEASON, week: 1 }, {
            $push: { polls: { poll: 'Playoff Committee Rankings', ranks: [{ rank: 8, school: 'Clemson', conference: 'ACC' }] } }
        });

        const res = await request(h2hApp).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        // Committee has Clemson at 8, AP at 23 — the scorer reads the committee.
        expect(rowsFor(res.body, ann._id).find(t => t.teamId === LSU).oppRank).toBe(8);
    });

    test('a Coaches-Poll-only season shows no ranks rather than ones that will not score', async () => {
        const ann = await seedH2H();
        await poll('Coaches Poll');   // the preseason state — no AP ingested yet

        const res = await request(h2hApp).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        rowsFor(res.body, ann._id).forEach(t => expect(t.oppRank).toBeNull());
    });

    test('no poll at all is not an error', async () => {
        const ann = await seedH2H();
        const res = await request(h2hApp).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);
        rowsFor(res.body, ann._id).forEach(t => expect(t.oppRank).toBeNull());
    });
});

// ---- the Captain picker's slate -------------------------------------------
describe('opponent ranks on the Captain slate', () => {
    async function seedCaptain() {
        await seedTeams();
        await seedGames();
        const user = await User.create({
            firstName: 'Ann', lastName: 'Test', league: LEAGUE,
            seasons: [{ season: SEASON, teams: [fullTeam(LSU, 'LSU'), fullTeam(TEXAS, 'Texas')], weeklyScore: [], cumulativeScore: 0 }]
        });
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.oidc = { isAuthenticated: () => true, user: { user_metadata: { metadata: { userId: String(user._id) } } } };
            next();
        });
        app.use('/users', usersRouter);
        return app;
    }
    const slateOf = (body, teamId) => (body.slate || []).find(s => s.teamId === teamId);

    test('each game carries its opponent rank', async () => {
        const app = await seedCaptain();
        await poll('AP Top 25');

        const res = await request(app).get('/users/me/captain?season=' + SEASON);
        expect(slateOf(res.body, LSU).games[0]).toMatchObject({ opp: 'CLEM', oppRank: 23 });
        expect(slateOf(res.body, TEXAS).games[0]).toMatchObject({ ha: '@', oppRank: 3 });
    });

    test('unranked and no-poll both read as null', async () => {
        const app = await seedCaptain();
        await poll('Coaches Poll');

        const res = await request(app).get('/users/me/captain?season=' + SEASON);
        expect(slateOf(res.body, LSU).games[0].oppRank).toBeNull();
        expect(slateOf(res.body, TEXAS).games[0].oppRank).toBeNull();
    });
});
