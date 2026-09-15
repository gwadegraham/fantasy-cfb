// The /standings/projections Game query has to fetch every field the projection
// engine reads. pregameWinProb is the one it used to miss: projectTeamPoints
// takes CFBD's real pre-game number when the game carries it and otherwise
// estimates from the SP+ gap, so an unprojected field silently downgraded the
// whole route to estimates — while /standings/h2h, which does project it, showed
// a different probability for the same game on the same page.
//
// Dropping it is not a per-game error either: calibrateToExpectedWins subtracts
// the CFBD-sourced expected wins from the target before scaling the remaining
// games, so removing the field moves games that never had it.
//
// The guard: identical data except for the stored pregameWinProb must produce a
// different projectedFinal. If the query stops selecting the field, both runs
// collapse to the same estimate and this fails.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const User = require('../models/user');
const Game = require('../models/game');
const standingsRouter = require('../routes/standings');

const LEAGUE = 'graham-league';
const SEASON = 2026;
const MINE = 1, OPP = 2;

const app = express();
app.use(express.json());
app.use('/standings', standingsRouter);

useMongo();

function fullTeam(id, school, extra) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'Big Ten', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1',
                    latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false },
        seasons: [Object.assign({ season: SEASON, conference: 'Big Ten' }, extra)]
    };
}

async function seed() {
    await Team.create([
        fullTeam(MINE, 'Mine U', { spRating: 10, expectedWins: 8 }),
        fullTeam(OPP, 'Opponent U', { spRating: 0, expectedWins: 6 })
    ]);
    await Game.create([1, 2, 3, 4].map(wk => ({
        id: 100 + wk, season: SEASON, seasonType: 'regular', week: wk,
        neutralSite: false, conferenceGame: false, completed: false,
        startTimeTbd: false, startDate: `2026-09-0${wk}T18:00:00.000Z`,
        homeId: MINE, homeTeam: 'Mine U', homeConference: 'Big Ten',
        awayId: OPP, awayTeam: 'Opponent U', awayConference: 'Big Ten'
    })));
    await User.create({
        firstName: 'Pat', lastName: 'Tester', league: LEAGUE,
        seasons: [{ season: SEASON, cumulativeScore: 0, teams: [fullTeam(MINE, 'Mine U')] }]
    });
}

async function projectedFinal() {
    const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
    expect(res.status).toBe(200);
    expect(res.body.managers).toHaveLength(1);
    return res.body.managers[0].projectedFinal;
}

describe('GET /standings/projections — engine input fields', () => {
    beforeEach(seed);

    it('reads pregameWinProb off the game instead of always estimating', async () => {
        const estimated = await projectedFinal();

        // CFBD says this team is a heavy underdog every week — the opposite of
        // what the SP+ gap and its 8-win target imply.
        await Game.updateMany({ season: SEASON }, { $set: { pregameWinProb: 0.05 } });
        const fromMarket = await projectedFinal();

        expect(fromMarket).not.toBe(estimated);
        expect(fromMarket).toBeLessThan(estimated);
    });
});
