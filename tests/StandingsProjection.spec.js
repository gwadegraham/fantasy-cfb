const { buildProjections, simulateTitleOdds, winsSoFar } = require('../modules/standings-projection');
const { buildPoolContext, buildRankingProxy } = require('../modules/draft-projection');
const { resolveConfig } = require('../modules/scoring-defaults');

describe('winsSoFar', () => {
    const games = [
        { seasonType: 'regular', completed: true, homeId: 1, awayId: 2, homePoints: 28, awayPoints: 10 }, // 1 won (home)
        { seasonType: 'regular', completed: true, homeId: 3, awayId: 1, homePoints: 14, awayPoints: 21 }, // 1 won (away)
        { seasonType: 'regular', completed: true, homeId: 1, awayId: 4, homePoints: 7, awayPoints: 35 },  // 1 lost
        { seasonType: 'regular', completed: false, homeId: 1, awayId: 5 },                                 // not played
        { seasonType: 'postseason', completed: true, homeId: 1, awayId: 6, homePoints: 30, awayPoints: 3 } // not regular
    ];
    it('counts only completed regular wins for the team', () => {
        expect(winsSoFar(1, games)).toBe(2);
    });
});

describe('simulateTitleOdds', () => {
    it('odds sum to ~1 across managers', () => {
        const managers = [
            { userId: 'a', postExpected: 100, perGame: [{ winProb: 0.6, pointsIfWin: 3 }, { winProb: 0.4, pointsIfWin: 2 }] },
            { userId: 'b', postExpected: 90, perGame: [{ winProb: 0.5, pointsIfWin: 3 }] },
            { userId: 'c', postExpected: 110, perGame: [] }
        ];
        const odds = simulateTitleOdds(managers, 3000);
        const sum = Object.values(odds).reduce((s, v) => s + v, 0);
        expect(sum).toBeCloseTo(1, 5);
    });

    it('a strictly dominant manager wins every sim', () => {
        const odds = simulateTitleOdds([
            { userId: 'x', postExpected: 1000, perGame: [] },
            { userId: 'y', postExpected: 0, perGame: [] }
        ], 500);
        expect(odds.x).toBe(1);
        expect(odds.y).toBe(0);
    });

    it('splits credit on an exact tie', () => {
        const odds = simulateTitleOdds([
            { userId: 'x', postExpected: 100, perGame: [] },
            { userId: 'y', postExpected: 100, perGame: [] }
        ], 500);
        expect(odds.x).toBeCloseTo(0.5, 5);
        expect(odds.y).toBeCloseTo(0.5, 5);
    });
});

describe('buildProjections', () => {
    const season = 2026;
    const teamsById = {
        '1': { id: 1, school: 'A', seasons: [{ season, spRating: 12, expectedWins: 9, conference: 'SEC' }] },
        '2': { id: 2, school: 'B', seasons: [{ season, spRating: -6, expectedWins: 4, conference: 'SEC' }] }
    };
    const cfg = resolveConfig('graham-league', null);
    const rankings = buildRankingProxy(season, teamsById, null);
    const poolCtx = buildPoolContext(teamsById, season);
    const mkGame = (id) => ({ id, season, seasonType: 'regular', completed: false, conferenceGame: false, neutralSite: false, homeId: 1, awayId: 2, homeTeam: 'A', awayTeam: 'B', homeConference: 'SEC', awayConference: 'Big Ten' });
    const gamesByTeam = { '1': [mkGame(101), mkGame(102)] };

    it('projects a manager: banked + expected, with per-game data', () => {
        const users = [{ _id: 'u1', firstName: 'Test', lastName: 'User', seasons: [{ season, cumulativeScore: 10, teams: [{ id: 1, school: 'A' }] }] }];
        const out = buildProjections(users, teamsById, gamesByTeam, cfg, rankings, poolCtx, season);
        expect(out).toHaveLength(1);
        expect(out[0].banked).toBe(10);
        expect(out[0].remainingCount).toBe(2);
        expect(out[0].projectedFinal).toBeGreaterThan(10);   // banked + positive expected
        expect(out[0].perGame).toHaveLength(2);
        expect(out[0].perGame[0].winProb).toBeGreaterThan(0.5); // strong team favored
    });

    // A losing team keeps its full preseason win total as a target while the games
    // left to hold it shrink, so the target can exceed the schedule. Uncapped, the
    // calibrator answered that with a certain win for every remaining game — a
    // 4-3 team was projected to run the table and out-projected a 6-1 one.
    it('never projects a certain win when the remaining target exceeds the games left', () => {
        const users = [{ _id: 'u3', firstName: 'Cap', lastName: 'Test', seasons: [{ season, cumulativeScore: 0, teams: [{ id: 1, school: 'A' }] }] }];
        // Team 1 wants 9 wins on the season; 2 games remain, both already lost-free.
        const out = buildProjections(users, teamsById, gamesByTeam, cfg, rankings, poolCtx, season);
        const probs = out[0].perGame.map(g => g.winProb);
        expect(probs).toHaveLength(2);
        probs.forEach(p => expect(p).toBeLessThan(0.99));
        const mean = probs.reduce((a, b) => a + b, 0) / probs.length;
        expect(mean).toBeLessThanOrEqual(0.9 + 1e-6);
    });

    it('skips users with no roster for the season', () => {
        const users = [{ _id: 'u2', firstName: 'No', lastName: 'Roster', seasons: [] }];
        expect(buildProjections(users, teamsById, gamesByTeam, cfg, rankings, poolCtx, season)).toHaveLength(0);
    });
});
