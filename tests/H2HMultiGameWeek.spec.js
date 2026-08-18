// A team can play TWICE inside one API week, and the H2H matchup card has to
// show both games.
//
// CFBD has no week 0 — the opening weekend is folded into week 1 — so a team
// that opens on the Saturday before Labor Day and plays again the following
// weekend has two week-1 games (12 draftable teams in 2026, 8 in 2025).
//
// Scoring always handled this correctly: modules/scoring.js loops every game a
// team plays that week and pushes one scoreByTeam entry per game. The READ
// model didn't. It kept one game per team per week, which meant:
//   - only one of the two games appeared on the card, and which one won was
//     decided by document order,
//   - a finished week showed the two-game TOTAL on a row labelled with one
//     game's opponent,
//   - the win-probability bar dropped the second game entirely, because the
//     per-game projections were keyed by team and the second overwrote the first.
//
// Runs against an in-memory Mongo with the real models and the real route.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const ScoringConfig = require('../models/scoringConfig');
const standingsRouter = require('../routes/standings');

const app = express();
app.use(express.json());
app.use('/standings', standingsRouter);

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';

// Ann rosters USC, which plays twice in week 1 (the opening weekend and the
// following Saturday). Everyone else plays once.
const OREGON = 1, USC = 2, DUKE = 3, MIAMI = 4;
const G_OREGON = 101, G_USC_A = 102, G_USC_B = 103, G_DUKE = 104, G_MIAMI = 105;

function rosterTeam(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

async function manager(firstName, teams, weeklyScore) {
    return User.create({
        firstName, lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams, weeklyScore, cumulativeScore: weeklyScore.reduce((s, e) => s + e.score, 0) }]
    });
}

const OPENING = '2026-08-29T23:00:00.000Z';     // the "week 0" Saturday
const REGULAR = '2099-09-05T23:30:00.000Z';     // far future so it never drifts past
function game(id, homeId, awayId, awayTeam, startDate, completed) {
    return {
        id, season: SEASON, week: 1, seasonType: 'regular',
        startDate, startTimeTbd: false, neutralSite: false, conferenceGame: false,
        homeId, homeTeam: 'Home', awayId, awayTeam,
        homePoints: completed ? 42 : null, awayPoints: completed ? 10 : null, completed
    };
}

async function enableH2H() {
    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } }
    });
}

// SP+ for everyone on the field, so the projection model has something to work
// with and the win-probability bar is populated.
async function seedTeams() {
    const docs = [[OREGON, 'Oregon', 'ORE', 20], [USC, 'USC', 'USC', 18], [DUKE, 'Duke', 'DUKE', 8], [MIAMI, 'Miami', 'MIA', 6],
                  [95, 'Opp95', 'O95', -4], [96, 'Opp96', 'O96', -4], [97, 'Fresno State', 'FRES', -6],
                  [98, 'San Jose State', 'SJSU', -8], [99, 'Opp99', 'O99', -10]];
    await Team.create(docs.map(([id, school, abbr, sp]) => Object.assign(rosterTeam(id, school), {
        abbreviation: abbr,
        seasons: [{ season: SEASON, conference: 'SEC', spRating: sp, expectedWins: 6 }]
    })));
}

// Week 1 with nothing played: everyone seeded at zero the way the nightly job
// leaves it before kickoff.
async function seedUnplayed() {
    await enableH2H();
    await seedTeams();
    const ann = await manager('Ann', [rosterTeam(OREGON, 'Oregon'), rosterTeam(USC, 'USC')], [{ week: 1, score: 0, scoreByTeam: [] }]);
    const bob = await manager('Bob', [rosterTeam(DUKE, 'Duke'), rosterTeam(MIAMI, 'Miami')], [{ week: 1, score: 0, scoreByTeam: [] }]);
    await Game.create([
        game(G_OREGON, OREGON, 99, 'Opp99', REGULAR, false),
        game(G_USC_A, USC, 98, 'San Jose State', OPENING, false),
        game(G_USC_B, USC, 97, 'Fresno State', REGULAR, false),
        game(G_DUKE, DUKE, 96, 'Opp96', REGULAR, false),
        game(G_MIAMI, MIAMI, 95, 'Opp95', REGULAR, false)
    ]);
    return { ann, bob };
}

const get = () => request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`).then(r => r.body);
// The pairing is positional, so orient the week's only matchup around Ann.
function mine(body, annId) {
    const g = body.schedule.find(s => s.week === 1).games[0];
    const iAmA = String(g.aId) === String(annId);
    return { mineTeams: iAmA ? g.aTeams : g.bTeams, myWinP: g.winP && (iAmA ? g.winP.a : g.winP.b), game: g };
}

describe('a team playing twice in one API week', () => {
    test('gets a row per game on the live card, not one row for the week', async () => {
        const { ann } = await seedUnplayed();
        const { mineTeams } = mine(await get(), ann._id);

        // Oregon once, USC twice — three rows off a two-team roster.
        expect(mineTeams).toHaveLength(3);
        const usc = mineTeams.filter(t => t.teamId === USC);
        expect(usc).toHaveLength(2);
        // Each row is its own game: distinct opponent and distinct kickoff.
        expect(usc.map(t => t.opp).sort()).toEqual(['FRES', 'SJSU']);
        expect(new Set(usc.map(t => t.kickoff)).size).toBe(2);
        usc.forEach(t => expect(t.status).toBe('scheduled'));
    });

    test('both games feed the win probability', async () => {
        const { ann } = await seedUnplayed();
        const withBoth = mine(await get(), ann._id).myWinP;

        // Drop USC's second game and nothing else. If the odds were only ever
        // counting one of the two, this would come back unchanged.
        await Game.deleteOne({ id: G_USC_B });
        const withOne = mine(await get(), ann._id).myWinP;

        expect(withBoth).not.toBeNull();
        expect(withOne).not.toBeNull();
        expect(withBoth).toBeGreaterThan(withOne);
    });

    test('a settled week shows each game its own points, not the two-game total on one row', async () => {
        await enableH2H();
        await seedTeams();
        const ann = await manager('Ann', [rosterTeam(OREGON, 'Oregon'), rosterTeam(USC, 'USC')], [{
            week: 1, score: 30, scoreByTeam: [
                { team: 'Oregon', teamId: OREGON, gameId: G_OREGON, score: 10 },
                { team: 'USC', teamId: USC, gameId: G_USC_A, score: 12 },
                { team: 'USC', teamId: USC, gameId: G_USC_B, score: 8 }
            ]
        }]);
        await manager('Bob', [rosterTeam(DUKE, 'Duke'), rosterTeam(MIAMI, 'Miami')], [{
            week: 1, score: 14, scoreByTeam: [
                { team: 'Duke', teamId: DUKE, gameId: G_DUKE, score: 7 },
                { team: 'Miami', teamId: MIAMI, gameId: G_MIAMI, score: 7 }
            ]
        }]);
        await Game.create([
            game(G_OREGON, OREGON, 99, 'Opp99', OPENING, true),
            game(G_USC_A, USC, 98, 'San Jose State', OPENING, true),
            game(G_USC_B, USC, 97, 'Fresno State', OPENING, true),
            game(G_DUKE, DUKE, 96, 'Opp96', OPENING, true),
            game(G_MIAMI, MIAMI, 95, 'Opp95', OPENING, true)
        ]);

        const body = await get();
        expect(body.schedule.find(s => s.week === 1).final).toBe(true);
        const { mineTeams } = mine(body, ann._id);

        const usc = mineTeams.filter(t => t.teamId === USC).sort((a, b) => b.score - a.score);
        expect(usc).toHaveLength(2);
        expect(usc.map(t => t.score)).toEqual([12, 8]);     // not a single row of 20
        expect(usc.map(t => t.opp).sort()).toEqual(['FRES', 'SJSU']);
        usc.forEach(t => expect(t.gameScore).toBe('42–10'));
        // The matchup total is unchanged — scoring was always right.
        expect(mineTeams.reduce((s, t) => s + t.score, 0)).toBe(30);
    });

    test('legacy entries with no gameId still collapse to one row per team', async () => {
        await enableH2H();
        await seedTeams();
        // Pre-2024 scoreByTeam carried no gameId. Those weeks have no way to tell
        // two games apart, so they stay aggregated rather than inventing rows.
        const ann = await manager('Ann', [rosterTeam(OREGON, 'Oregon'), rosterTeam(USC, 'USC')], [{
            week: 1, score: 30, scoreByTeam: [
                { team: 'Oregon', teamId: OREGON, score: 10 },
                { team: 'USC', teamId: USC, score: 20 }
            ]
        }]);
        await manager('Bob', [rosterTeam(DUKE, 'Duke'), rosterTeam(MIAMI, 'Miami')], [{
            week: 1, score: 14, scoreByTeam: [{ team: 'Duke', teamId: DUKE, score: 14 }]
        }]);
        await Game.create([
            game(G_OREGON, OREGON, 99, 'Opp99', OPENING, true),
            game(G_USC_A, USC, 98, 'San Jose State', OPENING, true),
            game(G_USC_B, USC, 97, 'Fresno State', OPENING, true),
            game(G_DUKE, DUKE, 96, 'Opp96', OPENING, true),
            game(G_MIAMI, MIAMI, 95, 'Opp95', OPENING, true)
        ]);

        const { mineTeams } = mine(await get(), ann._id);
        expect(mineTeams.filter(t => t.teamId === USC)).toHaveLength(1);
        expect(mineTeams.find(t => t.teamId === USC).score).toBe(20);
    });
});
