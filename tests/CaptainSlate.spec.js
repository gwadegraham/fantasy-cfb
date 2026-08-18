// GET /users/me/captain carries each rostered team's slate for the focus week.
//
// The Captain picker used to be a grid of bare logos, which hid the one thing
// that most changes the pick: CFBD has no week 0 — the opening weekend is folded
// into week 1 — so a few teams play TWICE in that week, and the captain doubles
// BOTH of their games (see modules/captain.js captainWeeklyBonus). A manager had
// no way to see that from the picker.
//
// The route already loads the manager's season games to resolve the lock, so the
// slate costs one extra lookup for opponent abbreviations and nothing else.

process.env.YEAR = '2026';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Game = require('../models/game');
const Team = require('../models/team');
const usersRouter = require('../routes/users');

useMongo();

const SEASON = 2026;
const LEAGUE = 'graham-league';
const USC = 2, OREGON = 1, SJSU = 98, FRESNO = 97, OPP = 99;

function fullTeam(id, school) {
    return {
        id, school, mascot: 'Mascot', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'SEC', color: '#000', logos: ['http://x/logo.png'],
        location: { venue_id: id, name: 'Stadium', city: 'City', state: 'ST', zip: '00000', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false }
    };
}

// Far future so the week never locks under the test's own clock.
const OPENING = '2099-08-29T21:00:00.000Z';
const REGULAR = '2099-09-05T23:30:00.000Z';
function game(id, homeId, awayId, awayTeam, startDate, startTimeTbd) {
    return {
        id, season: SEASON, week: 1, seasonType: 'regular',
        startDate, startTimeTbd: !!startTimeTbd, neutralSite: false, conferenceGame: false,
        homeId, homeTeam: 'Home', awayId, awayTeam, completed: false
    };
}

let app;
async function seed() {
    const user = await User.create({
        firstName: 'Ann', lastName: 'Test', league: LEAGUE,
        seasons: [{ season: SEASON, teams: [fullTeam(OREGON, 'Oregon'), fullTeam(USC, 'USC')], weeklyScore: [], cumulativeScore: 0 }]
    });
    await Team.create([
        Object.assign(fullTeam(SJSU, 'San Jose State'), { abbreviation: 'SJSU' }),
        Object.assign(fullTeam(FRESNO, 'Fresno State'), { abbreviation: 'FRES' }),
        Object.assign(fullTeam(OPP, 'Opponent'), { abbreviation: 'OPP' })
    ]);
    await Game.create([
        // USC opens on the "week 0" Saturday and plays again the next weekend.
        game(102, USC, SJSU, 'San Jose State', OPENING),
        game(103, USC, FRESNO, 'Fresno State', REGULAR),
        game(101, OREGON, OPP, 'Opponent', REGULAR)
    ]);

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => true, user: { user_metadata: { metadata: { userId: String(user._id) } } } };
        next();
    });
    app.use('/users', usersRouter);
    return user;
}

const slateOf = (body, teamId) => (body.slate || []).find(s => s.teamId === teamId);

describe('GET /users/me/captain slate', () => {
    test('lists every game each rostered team plays in the focus week', async () => {
        await seed();
        const res = await request(app).get('/users/me/captain?season=' + SEASON);

        expect(res.status).toBe(200);
        expect(res.body.week).toBe(1);
        expect((res.body.slate || []).map(s => s.teamId).sort()).toEqual([OREGON, USC]);
        // The whole point: USC's week is two games, not one.
        expect(slateOf(res.body, USC).games).toHaveLength(2);
        expect(slateOf(res.body, OREGON).games).toHaveLength(1);
    });

    test('each game carries opponent, home/away and kickoff, in kickoff order', async () => {
        await seed();
        const res = await request(app).get('/users/me/captain?season=' + SEASON);
        const usc = slateOf(res.body, USC).games;

        expect(usc.map(g => g.opp)).toEqual(['SJSU', 'FRES']);   // opening weekend first
        usc.forEach(g => expect(g.ha).toBe('vs'));
        expect(new Date(usc[0].kickoff).getTime()).toBeLessThan(new Date(usc[1].kickoff).getTime());
        expect(usc.map(g => g.gameId)).toEqual([102, 103]);
    });

    test('an away game reads as away', async () => {
        const user = await seed();
        await Game.updateOne({ id: 103 }, { $set: { homeId: FRESNO, homeTeam: 'Fresno State', awayId: USC, awayTeam: 'USC' } });

        const res = await request(app).get('/users/me/captain?season=' + SEASON);
        const away = slateOf(res.body, USC).games.find(g => g.gameId === 103);
        expect(away).toMatchObject({ ha: '@', opp: 'FRES' });
        expect(user).toBeTruthy();
    });

    test('a TBD kickoff reports no time rather than a placeholder', async () => {
        await seed();
        await Game.updateOne({ id: 103 }, { $set: { startTimeTbd: true } });

        const res = await request(app).get('/users/me/captain?season=' + SEASON);
        expect(slateOf(res.body, USC).games.find(g => g.gameId === 103).kickoff).toBeNull();
    });

    test('a team on a bye that week reports an empty slate, not a missing entry', async () => {
        await seed();
        await Game.deleteOne({ id: 101 });

        const res = await request(app).get('/users/me/captain?season=' + SEASON);
        expect(slateOf(res.body, OREGON)).toBeTruthy();
        expect(slateOf(res.body, OREGON).games).toEqual([]);
    });

    test('the lock rule is untouched — still the manager\'s earliest kickoff', async () => {
        await seed();
        const res = await request(app).get('/users/me/captain?season=' + SEASON);

        // USC's opening-weekend game is the earliest, so it locks the whole week.
        expect(res.body.lockAt).toBe(new Date(OPENING).toISOString());
        expect(res.body.locked).toBe(false);
    });
});
