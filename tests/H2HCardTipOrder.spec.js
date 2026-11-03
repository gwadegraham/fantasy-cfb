// The matchup card lists each side's games in TIP-OFF order.
//
// A basketball week is two or three games per team, and the card used to put a
// live week's rows in status-then-score order (which, before anything tips,
// is just roster order) and a finished week's in score order. Either way it
// read as a roster: ISU's Monday and Friday games side by side, then
// Gonzaga's, and the two columns never lined up in time. Rows now go by tip
// time, earliest first, whatever their status, with TBD tips at the end of
// their (Eastern) day and ties broken by team name.
//
// Pure-unit cases for the comparator, then the real route against an
// in-memory Mongo for both the unplayed and the finished card.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo, mirrorUsers } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const ScoringConfig = require('../models/scoringConfig');
const standingsRouter = require('../routes/standings');
const { tipKey, byTip } = require('../modules/h2h');

describe('tipKey / byTip', () => {
    const row = (school, game) => ({ school, tip: tipKey(game) });
    const order = (rows) => rows.slice().sort(byTip).map(r => r.school);

    test('earliest tip first', () => {
        expect(order([
            row('Late', { startDate: '2026-11-03T01:00:00.000Z' }),
            row('Early', { startDate: '2026-11-02T23:00:00.000Z' })
        ])).toEqual(['Early', 'Late']);
    });

    // Midnight Eastern is the TBD placeholder: read literally it would lead
    // its day; it belongs after that day's real times.
    test('a TBD tip goes to the end of its Eastern day, not the start', () => {
        expect(order([
            row('TBD Mon', { startDate: '2026-11-02T05:00:00.000Z', startTimeTbd: true }),
            row('Mon 11pm ET', { startDate: '2026-11-03T04:00:00.000Z' }),
            row('Mon noon ET', { startDate: '2026-11-02T17:00:00.000Z' }),
            row('Tue noon ET', { startDate: '2026-11-03T17:00:00.000Z' })
        ])).toEqual(['Mon noon ET', 'Mon 11pm ET', 'TBD Mon', 'Tue noon ET']);
    });

    // 1 Nov 2026: the clocks fall back, so that Eastern day is 25 hours. An
    // 11 PM EST tip is 04:00Z Monday — 24h after the TBD placeholder — and
    // still belongs ahead of the day's TBD game.
    test('a TBD tip still closes its day when the clocks fall back', () => {
        expect(order([
            row('TBD Sun', { startDate: '2026-11-01T04:00:00.000Z', startTimeTbd: true }),
            row('Sun 11pm EST', { startDate: '2026-11-02T04:00:00.000Z' }),
            row('Mon 12:30am EST', { startDate: '2026-11-02T05:30:00.000Z' })
        ])).toEqual(['Sun 11pm EST', 'TBD Sun', 'Mon 12:30am EST']);
    });

    // 14 Mar 2027: the clocks spring forward, so that day is 23 hours.
    test('a TBD tip still closes its day when the clocks spring forward', () => {
        expect(order([
            row('Mon 12:30am EDT', { startDate: '2027-03-15T04:30:00.000Z' }),
            row('TBD Sun', { startDate: '2027-03-14T05:00:00.000Z', startTimeTbd: true }),
            row('Sun 11pm EDT', { startDate: '2027-03-15T03:00:00.000Z' })
        ])).toEqual(['Sun 11pm EDT', 'TBD Sun', 'Mon 12:30am EDT']);
    });

    test('no usable date sorts last', () => {
        expect(order([
            row('Nothing', null),
            row('Garbage', { startDate: 'not a date' }),
            row('Real', { startDate: '2026-11-02T23:00:00.000Z' })
        ])).toEqual(['Real', 'Garbage', 'Nothing']);
    });

    test('a tie breaks by team name', () => {
        const at = { startDate: '2026-11-02T23:00:00.000Z' };
        expect(order([row('Purdue', at), row('Duke', at), row('Iowa State', at)]))
            .toEqual(['Duke', 'Iowa State', 'Purdue']);
    });
});

const app = express();
app.use(express.json());
app.use('/standings', standingsRouter);

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const OREGON = 1, USC = 2, DUKE = 3, MIAMI = 4;

function rosterTeam(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}
function game(id, homeId, awayId, startDate, { tbd = false, completed = false } = {}) {
    return {
        id, season: SEASON, week: 1, seasonType: 'regular',
        startDate, startTimeTbd: tbd, neutralSite: false, conferenceGame: false,
        homeId, homeTeam: 'Home', awayId, awayTeam: 'Away',
        homePoints: completed ? 40 : null, awayPoints: completed ? 3 : null, completed
    };
}

async function seed(annWeek, games) {
    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } }
    });
    await Team.create([[OREGON, 'Oregon'], [USC, 'USC'], [DUKE, 'Duke'], [MIAMI, 'Miami'], [96, 'Opp96'], [97, 'Opp97'], [98, 'Opp98'], [99, 'Opp99']]
        .map(([id, school]) => Object.assign(rosterTeam(id, school), {
            seasons: [{ season: SEASON, conference: 'SEC', spRating: 5, expectedWins: 6 }]
        })));
    // Roster order Oregon, USC, Duke — deliberately NOT tip order, so a card
    // that just echoes the roster fails.
    const ann = await User.create({
        firstName: 'Ann', lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams: [rosterTeam(OREGON, 'Oregon'), rosterTeam(USC, 'USC'), rosterTeam(DUKE, 'Duke')],
            weeklyScore: [annWeek], cumulativeScore: annWeek.score }]
    });
    await User.create({
        firstName: 'Bob', lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams: [rosterTeam(MIAMI, 'Miami')],
            weeklyScore: [{ week: 1, season: 'regular', score: 0, scoreByTeam: [] }], cumulativeScore: 0 }]
    });
    await mirrorUsers();
    await Game.create(games);
    return ann;
}

async function annRows(ann) {
    const res = await request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`);
    const g = res.body.schedule.find(s => s.week === 1).games[0];
    return String(g.aId) === String(ann._id) ? g.aTeams : g.bTeams;
}

describe('the matchup card rows', () => {
    test('an unplayed week lists games by tip, with the TBD tip last on its day', async () => {
        // Far future so nothing drifts into "live". Duke is TBD on the same
        // Eastern day as Oregon's 7:30 PM ET tip; USC plays two days earlier.
        const ann = await seed({ week: 1, season: 'regular', score: 0, scoreByTeam: [] }, [
            game(101, OREGON, 99, '2099-09-05T23:30:00.000Z'),
            game(102, USC, 98, '2099-09-03T23:00:00.000Z'),
            game(103, DUKE, 97, '2099-09-05T04:00:00.000Z', { tbd: true }),
            game(104, MIAMI, 96, '2099-09-05T23:30:00.000Z')
        ]);
        const rows = await annRows(ann);
        expect(rows.map(r => r.school)).toEqual(['USC', 'Oregon', 'Duke']);
        // The sort key is not part of the payload.
        rows.forEach(r => expect(r).not.toHaveProperty('tip'));
    });

    // A finished week used to sort by score. Tip order keeps the card from
    // reshuffling the moment its week settles.
    test('a finished week lists games by tip, not by score', async () => {
        const ann = await seed({
            week: 1, season: 'regular', score: 12,
            scoreByTeam: [
                { teamId: OREGON, team: 'Oregon', gameId: 101, score: 8 },
                { teamId: USC, team: 'USC', gameId: 102, score: 1 },
                { teamId: DUKE, team: 'Duke', gameId: 103, score: 3 }
            ]
        }, [
            game(101, OREGON, 99, '2026-09-05T23:30:00.000Z', { completed: true }),
            game(102, USC, 98, '2026-09-03T23:00:00.000Z', { completed: true }),
            game(103, DUKE, 97, '2026-09-04T23:00:00.000Z', { completed: true }),
            game(104, MIAMI, 96, '2026-09-05T23:30:00.000Z', { completed: true })
        ]);
        const rows = await annRows(ann);
        expect(rows.map(r => r.school)).toEqual(['USC', 'Duke', 'Oregon']);
        rows.forEach(r => expect(r).not.toHaveProperty('tip'));
    });
});
