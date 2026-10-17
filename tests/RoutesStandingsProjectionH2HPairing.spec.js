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
const Franchise = require('../models/franchise');
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
        [`engagementBySeason.${SEASON}`]: { captainEnabled: false, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1.5 },   // a 0-0 tie pays 1.5 each
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

describe('the week under way counts what is already banked (football)', () => {
    // Week 8: manager 1's game is final and banked 10 (a stored weekly row);
    // manager 2's is still to play, and no football win in this fixture is
    // worth 10. So manager 1 has already won the week: +3, certain. Decided
    // on the remaining games alone (the old estimate), manager 1 had none
    // and read as the underdog.
    test('a manager who has banked an unreachable lead projects the full win bonus', async () => {
        await User.deleteMany({});
        await Game.updateMany({ week: 8, homeId: 1 }, { $set: { completed: true, homePoints: 30, awayPoints: 0 } });
        await Game.deleteMany({ homeId: { $in: [3, 4, 5, 6] } });
        const rows = (score) => Array.from({ length: 13 }, (_, i) => ({ week: i + 1, score: i + 1 === 8 ? score : 0 }));
        await User.create([
            { firstName: 'M1', lastName: 'X', league: LEAGUE, seasons: [{ season: SEASON, cumulativeScore: 10, teams: [fullTeam(1, 'Team 1')],
                weeklyScore: rows(10).map(r => r.week === 8 ? Object.assign(r, { scoreByTeam: [{ teamId: 1, gameId: 801, score: 10 }] }) : r) }] },
            { firstName: 'M2', lastName: 'X', league: LEAGUE, seasons: [{ season: SEASON, cumulativeScore: 0, teams: [fullTeam(2, 'Team 2')],
                weeklyScore: rows(0) }] }
        ]);
        await mirrorUsers();
        await ScoringConfig.updateOne({ league: LEAGUE }, { $set: { league: LEAGUE,
            [`engagementBySeason.${SEASON}`]: { captainEnabled: false, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1 } } }, { upsert: true });
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        const m1 = res.body.managers.find(m => m.name === 'M1 X.');
        const m2 = res.body.managers.find(m => m.name === 'M2 X.');
        expect(m1.expH2H).toBe(3);
        expect(m2.expH2H).toBe(0);
    });
});

describe('football H2H forward: captain, pre-pin order, cache', () => {
    const setModes = (o) => ScoringConfig.updateOne({ league: LEAGUE }, { $set: { league: LEAGUE,
        [`engagementBySeason.${SEASON}`]: Object.assign({ captainEnabled: false, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 1.5 }, o) } }, { upsert: true });

    test("the week under way doubles the captain already chosen, not the best team left", async () => {
        // Manager 1 holds teams 1 and 3. Team 1's week-8 game is final and
        // was the captain; team 3 still plays. The captain has no game left,
        // so the Captain term for week 8 is 0 — not team 3's expectation.
        await User.deleteMany({});
        await Game.updateMany({ week: 8, homeId: 1 }, { $set: { completed: true, homePoints: 30, awayPoints: 0 } });
        const rows = (sc) => Array.from({ length: 13 }, (_, i) => ({ week: i + 1, score: i + 1 === 8 ? sc : 0 }));
        await User.create([
            { firstName: 'M1', lastName: 'X', league: LEAGUE, seasons: [{ season: SEASON, cumulativeScore: 0, teams: [fullTeam(1, 'Team 1'), fullTeam(3, 'Team 3')],
                captains: [{ week: 8, teamId: 1 }], weeklyScore: rows(8) }] },
            { firstName: 'M2', lastName: 'X', league: LEAGUE, seasons: [{ season: SEASON, cumulativeScore: 0, teams: [fullTeam(2, 'Team 2')], weeklyScore: rows(0) }] }
        ]);
        await mirrorUsers();
        await setModes({ captainEnabled: true, captainMultiplier: 2 });
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        const m1 = res.body.managers.find(m => m.name === 'M1 X.');
        expect(m1.expCaptain).toBe(0);
    });

    test('before a pin exists, the round robin runs on the SORTED ids', async () => {
        // Three managers (a bye each week), stored in REVERSE id order.
        await User.deleteMany({ firstName: { $in: ['M4', 'M5', 'M6'] } });
        await Game.deleteMany({ homeId: { $in: [4, 5, 6] } });
        await Franchise.deleteMany({});
        await mirrorUsers();
        const docs = await Franchise.find({}).lean();
        await Franchise.deleteMany({});
        const reversed = docs.sort((a, b) => String(b.accountId).localeCompare(String(a.accountId)));
        await Franchise.insertMany(reversed);
        await setModes({});
        const ids = reversed.map(d => String(d.accountId));
        const starId = String(reversed.find(d => d.seasons[0].teams.some(t => t.id === 1)).accountId);
        const sorted = ids.slice().sort();
        const weeks = Array.from({ length: 13 }, (_, i) => i + 1);
        const opp = (order, w) => {
            const pair = (scheduleForWeeks(order, weeks)[w] || []).find(p => p.includes(starId));
            return pair ? pair.find(x => x !== starId) : null;          // null: a bye
        };
        // The week left to play: one where the two orders pair the star
        // differently (with 3 managers some weeks coincide).
        const w = [6, 7, 8].find(x => opp(sorted, x) !== opp(ids, x));
        await Game.updateMany({}, { $set: { completed: true, homePoints: 10, awayPoints: 20 } });
        await Game.updateMany({ week: w }, { $set: { completed: false, homePoints: null, awayPoints: null } });
        const res = await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`);
        const real = opp(sorted, w);
        res.body.managers.filter(m => m.userId !== starId).forEach(m => {
            // the star's real opponent is the underdog; the other sits out (0)
            if (m.userId === real) expect(m.expH2H).toBeLessThan(1.5);
            else expect(m.expH2H).toBe(0);
        });
        expect(res.body.managers.find(m => m.userId === starId).expH2H).toBeGreaterThan(1.5);
    });

    test('football projections are cached for 60 s too', async () => {
        const router = require('../routes/standings');
        router.projectionCache.enabled = true;
        router.projectionCache.entries.clear();
        try {
            const first = (await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`)).body.managers;
            await User.updateMany({}, { $set: { 'seasons.0.cumulativeScore': 77 } });
            await Franchise.updateMany({}, { $set: { 'seasons.0.cumulativeScore': 77 } });
            const again = (await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`)).body.managers;
            expect(again).toEqual(first);
            router.projectionCache.entries.clear();
            const fresh = (await request(app).get(`/standings/projections/${LEAGUE}/${SEASON}`)).body.managers;
            expect(fresh[0].banked).toBe(77);
        } finally {
            router.projectionCache.enabled = false;
            router.projectionCache.entries.clear();
        }
    });
});
