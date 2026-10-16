// Football's projected H2H must use the REAL round-robin opponent for each
// remaining week.
//
// The round robin is positional over the season's whole H2H week range
// (h2h computeH2HAwards → h2hWeekRange), so with 6 managers (5 rounds) week 8
// is round 3. The projection used to number the rotation over only the weeks
// still to play, so in week 8 it projected round 1 — opponents nobody faces.
//
// The fixture isolates week 8: weeks 1-7 and 9-13 are already final (they
// keep the H2H range 1-13 but project nothing), and only the STAR manager
// can score that week. The star's opponent is then the one manager whose
// expected H2H bonus is below the 1.5 of an even 0-0 pairing.

const express = require('express');
const request = require('supertest');
const { useMongo, mirrorUsers } = require('./helpers/mongo');
const Team = require('../models/team');
const User = require('../models/user');
const Game = require('../models/game');
const ScoringConfig = require('../models/scoringConfig');
const { scheduleForWeeks } = require('../modules/h2h');

const LEAGUE = 'graham-league';
const SEASON = 2026;
const app = express();
app.use('/standings', require('../routes/standings'));

useMongo();

function fullTeam(id, school, extra) {
    return {
        id, school, mascot: 'M', abbreviation: school.slice(0, 3).toUpperCase(),
        conference: 'Big Ten', color: '#000', logos: [`${school}.png`],
        location: { venue_id: id, name: 'V', city: 'C', state: 'ST', zip: '1', latitude: 1, longitude: 1, capacity: 100, grass: true, dome: false },
        seasons: [Object.assign({ season: SEASON, conference: 'Big Ten' }, extra)]
    };
}

const STAR = 1;   // team 1: elite, its manager is the star
const ROSTER = [1, 2, 3, 4, 5, 6];

beforeEach(async () => {
    // Rostered 1-6; opponents 11-16. Team 1 is elite against a minnow; teams
    // 2-6 are minnows against elite opponents, so they almost never score.
    await Team.create(ROSTER.map(id => fullTeam(id, `Team ${id}`, id === STAR ? { spRating: 30, expectedWins: 11 } : { spRating: -30, expectedWins: 1 }))
        .concat(ROSTER.map(id => fullTeam(10 + id, `Opp ${id}`, id === STAR ? { spRating: -30, expectedWins: 1 } : { spRating: 30, expectedWins: 11 }))));
    const games = [];
    for (let wk = 1; wk <= 13; wk++) {
        ROSTER.forEach(id => games.push({
            id: wk * 100 + id, season: SEASON, seasonType: 'regular', week: wk,
            neutralSite: false, conferenceGame: false, completed: wk !== 8,
            homePoints: wk !== 8 ? 10 : null, awayPoints: wk !== 8 ? 20 : null,
            startTimeTbd: false, startDate: new Date(Date.UTC(2026, 7, 29 + wk * 7)).toISOString(),
            homeId: id, homeTeam: `Team ${id}`, homeConference: 'Big Ten',
            awayId: 10 + id, awayTeam: `Opp ${id}`, awayConference: 'Big Ten'
        }));
    }
    await Game.create(games);
    await User.create(ROSTER.map(id => ({
        firstName: `M${id}`, lastName: 'X', league: LEAGUE,
        seasons: [{ season: SEASON, cumulativeScore: 0, teams: [fullTeam(id, `Team ${id}`)] }]
    })));
    await mirrorUsers();
});

test('week 8 of 13 with 6 managers projects round 3, the real one', async () => {
    const res0 = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
    const ids = res0.body.managers.map(m => m.userId);
    expect(ids).toHaveLength(6);
    // Pin an order (as the scoring job does once a week settles).
    const pin = ids.slice().sort().reverse();
    await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { league: LEAGUE,
        [`engagementBySeason.${SEASON}`]: { captainEnabled: false, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 },
        [`h2hScheduleBySeason.${SEASON}`]: { ids: pin } } }, { upsert: true });

    const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
    const star = res.body.managers.find(m => m.name === 'M1 X.');
    const rest = res.body.managers.filter(m => m !== star);

    const weeks = Array.from({ length: 13 }, (_, i) => i + 1);
    const partner = (pairs) => pairs.map(([a, b]) => (a === star.userId ? b : b === star.userId ? a : null)).find(Boolean);
    const realOpp = partner(scheduleForWeeks(pin, weeks)[8]);          // round 3 (8th week, 5 rounds)
    const oldOpp = partner(scheduleForWeeks(pin, [8])[8]);             // round 1: the old restart
    expect(realOpp).not.toBe(oldOpp);                                   // the fixture can tell them apart

    // The star's real opponent is the one manager left with the smallest H2H bonus (the rest are even 0-0 coin flips, 1.5).
    const lowest = rest.slice().sort((a, b) => a.expH2H - b.expH2H)[0];
    expect(lowest.userId).toBe(realOpp);
    rest.filter(m => m.userId !== realOpp).forEach(m => expect(m.expH2H).toBeGreaterThan(lowest.expH2H + 0.2));
});
