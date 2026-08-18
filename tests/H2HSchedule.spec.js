// GET /standings/h2h returns the WHOLE H2H schedule, not just the played part.
//
// The payload used to carry final weeks plus the in-progress one and nothing
// else. That was enough for the standings panel's "this week" view, but it made
// a full-season schedule impossible to render: in week 1 the only entry was
// week 1 itself, so My Team's "Full schedule" drawer — which lists every week
// except the featured one — had nothing left to show and came up blank.
//
// The pairings are deterministic (a positional round robin over the pinned
// manager list), so a week that hasn't happened is fully knowable. Weeks still
// to come now ride along flagged `upcoming`, carrying their opponent and each
// rostered team's kickoff time, with no winner and no scores.
//
// Runs against an in-memory Mongo with the real models and the real route.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const ScoringConfig = require('../models/scoringConfig');
const standingsRouter = require('../routes/standings');

const app = express();
app.use(express.json());
app.use('/standings', standingsRouter);

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';

function team(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

async function manager(firstName, teams, weeks) {
    return User.create({
        firstName, lastName: 'Test', league: LEAGUE,
        seasons: [{
            season: SEASON, teams,
            weeklyScore: weeks.map(([week, score]) => ({ week, score, scoreByTeam: [{ teamId: teams[0].id, team: teams[0].school, score }] })),
            cumulativeScore: weeks.reduce((s, [, score]) => s + score, 0)
        }]
    });
}

// `startDate` decides live-vs-upcoming at read time, so the unplayed weeks use a
// date that can never drift into the past on a later test run.
const PAST = '2026-09-05T23:00:00.000Z';
const FUTURE = '2099-09-12T23:30:00.000Z';
// Deliberately ancient. Whether a game has KICKED OFF is decided against the
// real clock, so "started" needs a date already elapsed no matter when the suite
// runs — PAST above is only ever used on completed games, where gameStatus reads
// `completed` and never looks at the date at all.
const STARTED = '2020-09-05T23:00:00.000Z';
// `started` = kicked off but not finished, which is the only thing that makes a
// week LIVE. Without it every unfinished game sits in the future and the week is
// merely upcoming.
function game(id, week, homeId, awayId, completed, started) {
    return {
        id, season: SEASON, week, seasonType: 'regular',
        startDate: completed ? PAST : (started ? STARTED : FUTURE), startTimeTbd: false,
        neutralSite: false, conferenceGame: false,
        homeId, homeTeam: 'Home', awayId, awayTeam: 'Away',
        homePoints: completed ? 30 : null, awayPoints: completed ? 10 : null,
        completed
    };
}

// Week 1 played and scored; weeks 2 and 3 scheduled but not kicked off. Two
// managers, one rostered team each, so every week pairs them.
async function seed() {
    await ScoringConfig.create({
        league: LEAGUE, model: 'graham', values: {},
        engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } }
    });
    const a = await manager('Ann', [team(1, 'Oregon')], [[1, 20]]);
    const b = await manager('Bob', [team(2, 'Duke')], [[1, 14]]);
    await Game.create([
        game(101, 1, 1, 99, true), game(102, 1, 2, 98, true),
        game(201, 2, 1, 97, false), game(202, 2, 2, 96, false),
        game(301, 3, 1, 95, false), game(302, 3, 2, 94, false)
    ]);
    return { a, b };
}

const get = () => request(app).get(`/standings/h2h/${LEAGUE}/${SEASON}`).then(r => r.body);
const weekOf = (body, w) => body.schedule.find(s => s.week === w);

describe('GET /standings/h2h schedule', () => {
    test('carries every derived H2H week, not just the played ones', async () => {
        await seed();
        const body = await get();

        expect(body.schedule.map(s => s.week)).toEqual([1, 2, 3]);
        expect(body.weeks).toEqual([1, 2, 3]);
        // The current week is still the first unsettled one, and it is what the
        // clients feature — future weeks arriving must not move it.
        expect(body.currentWeek).toBe(2);
        expect(body.featuredWeek).toBe(2);
        expect(body.scheduleComplete).toBe(false);
    });

    test('marks a settled week final, and an unstarted current week upcoming', async () => {
        await seed();
        const body = await get();

        expect(weekOf(body, 1)).toMatchObject({ final: true, upcoming: false });
        // Week 2 is the current week but nothing in it has kicked off, so it is
        // upcoming rather than live — being the week you are IN is not the same
        // as being under way.
        expect(weekOf(body, 2)).toMatchObject({ final: false, upcoming: true });
        expect(weekOf(body, 3)).toMatchObject({ final: false, upcoming: true });
    });

    test('a settled week keeps its result', async () => {
        await seed();
        const g = weekOf(await get(), 1).games[0];

        expect(g).toMatchObject({ final: true, upcoming: false, winner: 'a', aScore: 20, bScore: 14 });
    });

    test('an upcoming week carries the pairing and kickoff times, but no result', async () => {
        await seed();
        const g = weekOf(await get(), 3).games[0];

        expect(g).toMatchObject({ final: false, upcoming: true, winner: null, aScore: 0, bScore: 0 });
        // Both managers still appear, so the card can render the matchup.
        expect([g.aId, g.bId].filter(Boolean)).toHaveLength(2);
        // Each side shows its rostered team with a kickoff rather than a score —
        // the same shape the live week uses, which is what lets one card
        // renderer handle both.
        expect(g.aTeams).toHaveLength(1);
        expect(g.aTeams[0]).toMatchObject({ teamId: 1, school: 'Oregon', status: 'scheduled', score: null });
        // The kickoff INSTANT — the card renders it in Central; the server no
        // longer formats it (and used to do so in the dyno's zone).
        expect(Number.isNaN(Date.parse(g.aTeams[0].kickoff))).toBe(false);
        expect(new Date(g.aTeams[0].kickoff).toISOString()).toBe(FUTURE);
    });

    test('unplayed weeks add no records or bonus', async () => {
        await seed();
        const body = await get();

        // Only week 1 is decided: 1-0-0 and 0-1-0, nothing banked for 2 or 3.
        expect(body.managers.find(m => m.name.startsWith('Ann'))).toMatchObject({ record: '1-0-0', h2hBonus: 3 });
        expect(body.managers.find(m => m.name.startsWith('Bob'))).toMatchObject({ record: '0-1-0', h2hBonus: 0 });
    });

    test('week 1 before kickoff lists the weeks still to come — the reported bug', async () => {
        await ScoringConfig.create({
            league: LEAGUE, model: 'graham', values: {},
            engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } }
        });
        // The nightly job seeds a zero week before anything is played, which is
        // the state the league is actually in on opening week.
        await manager('Ann', [team(1, 'Oregon')], [[1, 0]]);
        await manager('Bob', [team(2, 'Duke')], [[1, 0]]);
        await Game.create([
            game(101, 1, 1, 99, false), game(102, 1, 2, 98, false),
            game(201, 2, 1, 97, false), game(202, 2, 2, 96, false)
        ]);

        const body = await get();
        // This used to be a single entry — week 1 — which the drawer then pulled
        // out as the featured card, leaving its list with nothing to render.
        expect(body.schedule.map(s => s.week)).toEqual([1, 2]);
        expect(body.currentWeek).toBe(1);
        // Nothing has kicked off, so week 1 is upcoming — not LIVE with an "in
        // progress" footer, which is what it used to claim all preseason.
        expect(weekOf(body, 1)).toMatchObject({ final: false, upcoming: true });
        expect(weekOf(body, 2).upcoming).toBe(true);
    });

    test('a week goes live once one of its games has kicked off', async () => {
        await seed();
        // Week 2's first game is now under way; its second has not started.
        await Game.updateOne({ id: 201 }, { $set: { startDate: STARTED } });

        const body = await get();
        expect(body.currentWeek).toBe(2);
        expect(weekOf(body, 2)).toMatchObject({ final: false, upcoming: false });
        // The rest of the week rides along — the matchup itself is under way even
        // though later games have not started.
        expect(weekOf(body, 3).upcoming).toBe(true);
    });

    test('a TBD kickoff cannot make a week live on its own', async () => {
        await seed();
        // A placeholder start date that has drifted into the past must not count
        // as a kickoff; nobody knows when the game actually begins.
        await Game.updateOne({ id: 201 }, { $set: { startDate: STARTED, startTimeTbd: true } });

        expect(weekOf(await get(), 2).upcoming).toBe(true);
    });

    // Deliberate, and unchanged: h2hManagerIds excludes managers with no scored
    // week, so a league that has never been scored stays empty rather than
    // showing a table of 0-0-0 rows against a schedule nobody is on yet.
    test('a league with no scored week at all stays empty', async () => {
        await ScoringConfig.create({
            league: LEAGUE, model: 'graham', values: {},
            engagementBySeason: { '2026': { h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 } }
        });
        await manager('Ann', [team(1, 'Oregon')], []);
        await manager('Bob', [team(2, 'Duke')], []);
        await Game.create([game(101, 1, 1, 99, false), game(102, 1, 2, 98, false)]);

        const body = await get();
        expect(body.schedule).toEqual([]);
        expect(body.managers).toEqual([]);
    });
});
