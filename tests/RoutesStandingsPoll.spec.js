// Which poll the standings PROJECTIONS value a hypothetical ranked win against.
//
// The projections and the draft grades share one engine but want opposite things
// from the poll: a grade is a frozen preseason judgment (routes/draft.js reads
// week 1 and stays there), while a projection forecasts the REMAINING schedule
// and so must follow the current top 25. Both used to read week 1, which meant
// the October projection still priced every ranked-win bonus off the August AP
// poll. These tests pin the new split, and the committee-poll preference that
// keeps a projected bonus worth the same as the one actually banked.
//
// The route, models and Mongo are real; win probabilities are pinned by giving
// every team an expectedWins, so the only thing that can move projectedFinal
// between cases is the points-if-win the poll decides.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const Team = require('../models/team');
const User = require('../models/user');
const Ranking = require('../models/ranking');
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

// One manager rostering MINE, whose four remaining games are all against OPP.
// Non-conference so the ranked-win rules the 'graham' model has ON by default
// (nonConfWinRanked + the additive top-10 bonus) are the ones in play.
async function seed() {
    await Team.create([
        fullTeam(MINE, 'Mine U', { spRating: 10, expectedWins: 8, cfpMakeOdds: 500, cfpChampOdds: 5000 }),
        fullTeam(OPP, 'Opponent U', { spRating: 0, expectedWins: 6, cfpMakeOdds: 2000, cfpChampOdds: 50000 }),
        fullTeam(3, 'Other U', { spRating: 5, expectedWins: 7, cfpMakeOdds: 1500, cfpChampOdds: 40000 })
    ]);
    const Game = require('../models/game');
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

const poll = (name, ranks) => ({ poll: name, ranks });
const rankingDoc = (week, polls) => Ranking.create({ season: SEASON, seasonType: 'regular', week, polls });

async function projectedFinal() {
    const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
    expect(res.status).toBe(200);
    expect(res.body.managers).toHaveLength(1);
    return res.body.managers[0].projectedFinal;
}

describe('GET /standings/projections — poll selection', () => {
    beforeEach(seed);

    it('values ranked wins off the LATEST poll, not the preseason one', async () => {
        // August: the opponent is #1. That is the only poll on file, so it is
        // both the preseason and the latest — the projection prices it as ranked.
        await rankingDoc(1, [poll('AP Top 25', [{ school: 'Opponent U', rank: 1 }])]);
        const preseasonOnly = await projectedFinal();

        // October: the opponent has fallen out of the top 25. Reading week 1
        // would leave the projection stuck on the August valuation.
        await rankingDoc(8, [poll('AP Top 25', [{ school: 'Other U', rank: 1 }])]);
        const withLatest = await projectedFinal();

        expect(withLatest).toBeLessThan(preseasonOnly);
    });

    it('picks a team back up when the latest poll ranks it', async () => {
        await rankingDoc(1, [poll('AP Top 25', [{ school: 'Other U', rank: 1 }])]);
        const unranked = await projectedFinal();

        await rankingDoc(8, [poll('AP Top 25', [{ school: 'Opponent U', rank: 1 }])]);
        expect(await projectedFinal()).toBeGreaterThan(unranked);
    });

    // Reusing the engine's findPoll (rather than plucking 'AP Top 25' by hand)
    // is what keeps a PROJECTED ranked-win bonus worth the same as the one the
    // scoring job will actually bank once the game is played.
    it('prefers the Playoff Committee Rankings over AP, exactly as scoring does', async () => {
        await rankingDoc(1, [poll('AP Top 25', [{ school: 'Other U', rank: 1 }])]);
        const unranked = await projectedFinal();

        await rankingDoc(14, [
            poll('AP Top 25', [{ school: 'Other U', rank: 1 }]),           // AP: opponent unranked
            poll('Playoff Committee Rankings', [{ school: 'Opponent U', rank: 1 }])
        ]);
        expect(await projectedFinal()).toBeGreaterThan(unranked);
    });

    // No poll at all is the preseason state every year until the AP poll drops;
    // buildRankingProxy answers it with an SP+-derived stand-in rather than
    // treating the whole country as unranked.
    it('still projects when no poll is stored yet', async () => {
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        expect(res.status).toBe(200);
        expect(res.body.managers[0].projectedFinal).toBeGreaterThan(0);
    });
});
