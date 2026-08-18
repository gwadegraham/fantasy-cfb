// The H2H win bar counts the Captain.
//
// The captain multiplies one rostered team's points for the week, and scoring
// folds that bonus straight into the weekly total — the number the matchup card
// shows. The odds, though, were computed from raw per-game points and never
// looked at the captain at all. So setting or changing your pick moved the score
// and not the bar, and mid-week a captained team's finished game read doubled in
// the number and single in the bar.
//
// The bar now applies the multiplier, resolved through resolveCaptain — the same
// call the scoring job makes. That matters because EVERY manager has a captain
// once the mode is on: a manager who never picks is auto-captained at scoring
// time (their best team by prior average, or the first rostered one in week 1).
// Reading only explicit picks would leave the bar disagreeing with the score for
// everyone who never sets one.
//
// The fixture gives each team its own expectedWins, which on a one-game season
// is that team's win probability — so Ann's roster is deliberately lopsided
// (Oregon 90%, USC 20%) and the choice of captain actually matters.
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
const OREGON = 1, USC = 2, DUKE = 3, MIAMI = 4;

function fullTeam(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}
const KICK = '2099-09-05T23:30:00.000Z';
function game(id, homeId, awayId, completed) {
    return {
        id, season: SEASON, week: 1, seasonType: 'regular',
        startDate: KICK, startTimeTbd: false, neutralSite: false, conferenceGame: false,
        homeId, homeTeam: 'Home', awayId, awayTeam: 'Away',
        homePoints: completed ? 40 : null, awayPoints: completed ? 3 : null, completed
    };
}
async function config(over) {
    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { '2026': Object.assign({ h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: true, captainMultiplier: 2 }, over || {}) }
    });
}
// expectedWins doubles as each team's win probability here — one game apiece.
async function seedTeams() {
    await Team.create([[OREGON, 'Oregon', 22, 0.9], [USC, 'USC', 18, 0.2], [DUKE, 'Duke', 4, 0.5], [MIAMI, 'Miami', 2, 0.5],
                       [96, 'Opp96', -8, 0.5], [97, 'Opp97', -8, 0.5], [98, 'Opp98', -8, 0.5], [99, 'Opp99', -8, 0.5]]
        .map(([id, school, sp, ew]) => Object.assign(fullTeam(id, school), {
            seasons: [{ season: SEASON, conference: 'SEC', spRating: sp, expectedWins: ew }]
        })));
}
async function seed(annCaptains, cfgOver) {
    await config(cfgOver);
    await seedTeams();
    const ann = await User.create({
        firstName: 'Ann', lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams: [fullTeam(OREGON, 'Oregon'), fullTeam(USC, 'USC')], captains: annCaptains || [], weeklyScore: [{ week: 1, score: 0, scoreByTeam: [] }], cumulativeScore: 0 }]
    });
    await User.create({
        firstName: 'Bob', lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams: [fullTeam(DUKE, 'Duke'), fullTeam(MIAMI, 'Miami')], weeklyScore: [{ week: 1, score: 0, scoreByTeam: [] }], cumulativeScore: 0 }]
    });
    await Game.create([game(101, OREGON, 99, false), game(102, USC, 98, false), game(103, DUKE, 97, false), game(104, MIAMI, 96, false)]);
    return ann;
}

function mine(body, annId) {
    const g = body.schedule.find(s => s.week === 1).games[0];
    const iAmA = String(g.aId) === String(annId);
    return { teams: iAmA ? g.aTeams : g.bTeams, winP: g.winP && (iAmA ? g.winP.a : g.winP.b), game: g };
}
const odds = (ann) => request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`).then(r => mine(r.body, ann._id).winP);

describe('the win bar counts the Captain', () => {
    test('captaining your strongest team lifts your odds', async () => {
        const ann = await seed([{ week: 1, teamId: OREGON }]);
        const on = await odds(ann);

        // Same rosters, same games, mode off for the season.
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { 'engagementBySeason.2026.captainEnabled': false } });
        const off = await odds(ann);

        expect(off).toBe(54);
        expect(on).toBe(62);
    });

    test('spending it on a weak team costs you, since your rival still doubles', async () => {
        const ann = await seed([{ week: 1, teamId: USC }]);       // USC wins 20% of the time
        // Below the 54 they'd have with the mode off: Ann's captain is nearly
        // worthless while Bob's auto-captain doubles a coin-flip.
        expect(await odds(ann)).toBe(45);
    });

    test('changing the pick changes the bar', async () => {
        const ann = await seed([{ week: 1, teamId: USC }]);
        const onUsc = await odds(ann);

        await User.updateOne({ _id: ann._id }, { $set: { 'seasons.0.captains': [{ week: 1, teamId: OREGON }] } });
        const onOregon = await odds(ann);

        expect(onOregon).toBeGreaterThan(onUsc);
    });

    test('a manager who never picks is modelled with their auto-captain', async () => {
        const ann = await seed([]);                                // no pick at all
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        const { teams, winP } = mine(res.body, ann._id);

        // resolveCaptain's week-1 fallback is the first rostered team, and the
        // card marks whichever team actually doubles — so this reads exactly as
        // if Oregon had been picked by hand.
        expect(teams.filter(t => t.captain).map(t => t.teamId)).toEqual([OREGON]);
        expect(winP).toBe(62);
    });

    test('no captain marker at all when the league has the mode off', async () => {
        const ann = await seed([{ week: 1, teamId: OREGON }], { captainEnabled: false });
        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        expect(mine(res.body, ann._id).teams.some(t => t.captain)).toBe(false);
    });

    test('a settled week keeps the banked bonus in the score', async () => {
        await config();
        await seedTeams();
        const ann = await User.create({
            firstName: 'Ann', lastName: 'Test', league: LEAGUE,
            seasons: [{
                season: SEASON, teams: [fullTeam(OREGON, 'Oregon'), fullTeam(USC, 'USC')],
                captains: [{ week: 1, teamId: OREGON }],
                // 10 + 6 raw, +10 for doubling Oregon = 26 banked.
                weeklyScore: [{ week: 1, score: 26, captainTeamId: OREGON, captainBonus: 10, scoreByTeam: [
                    { team: 'Oregon', teamId: OREGON, gameId: 101, score: 10 },
                    { team: 'USC', teamId: USC, gameId: 102, score: 6 }
                ] }],
                cumulativeScore: 26
            }]
        });
        await User.create({
            firstName: 'Bob', lastName: 'Test', league: LEAGUE,
            seasons: [{ season: SEASON, teams: [fullTeam(DUKE, 'Duke')], weeklyScore: [{ week: 1, score: 20, scoreByTeam: [{ team: 'Duke', teamId: DUKE, gameId: 103, score: 20 }] }], cumulativeScore: 20 }]
        });
        await Game.create([game(101, OREGON, 99, true), game(102, USC, 98, true), game(103, DUKE, 97, true)]);

        const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
        const { game: g, teams } = mine(res.body, ann._id);
        // The card's score already carried the captain bonus — 26, not the 16 of
        // raw per-game points — and the bar now agrees rather than contradicting it.
        expect(res.body.schedule.find(s => s.week === 1).final).toBe(true);
        expect(String(g.aId) === String(ann._id) ? g.aScore : g.bScore).toBe(26);
        expect(g.winner).toBe(String(g.aId) === String(ann._id) ? 'a' : 'b');
        expect(teams.filter(t => t.captain).map(t => t.teamId)).toEqual([OREGON]);
    });
});
