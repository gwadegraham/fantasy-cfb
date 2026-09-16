const { buildProjections, simulateTitleOdds, winsSoFar, gamesPlayed, remainingWinsTarget, BLEND_GAMES } = require('../modules/standings-projection');
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

    it('skips users with no roster for the season', () => {
        const users = [{ _id: 'u2', firstName: 'No', lastName: 'Roster', seasons: [] }];
        expect(buildProjections(users, teamsById, gamesByTeam, cfg, rankings, poolCtx, season)).toHaveLength(0);
    });
});


// The remaining-wins forecast. The old version subtracted banked wins from the
// preseason total, so a loss left the target alone while the games left to hold
// it shrank — a .500 team was projected to win out from week 4 on, and a 4-3
// team out-projected a 6-1 one on the same schedule. This is a rate instead.
describe('remainingWinsTarget', () => {
    const played = (n, wins) => {
        const out = [];
        for (let i = 0; i < n; i++) {
            const won = i < wins;
            out.push({ seasonType: 'regular', completed: true, homeId: 1, awayId: 2,
                       homePoints: won ? 28 : 10, awayPoints: won ? 10 : 28 });
        }
        return out;
    };

    it('carries the preseason pace alone before anything is played', () => {
        // 10.5 wins in 12 games = 0.875/game, across all 12 still to play.
        expect(remainingWinsTarget(10.5, 1, [], 12)).toBeCloseTo(10.5, 6);
    });

    it('never asks for more wins than there are games left', () => {
        // The case that broke the old model: 4-4 with 4 to play.
        const target = remainingWinsTarget(10.5, 1, played(8, 4), 4);
        expect(target).toBeLessThan(4);
        expect(target).toBeCloseTo(2.83, 1);
    });

    it('drops as a team keeps losing, instead of holding steady', () => {
        // Same .500 team, later in the season: the forecast per remaining game
        // has to fall, which is exactly what subtraction refused to do.
        const perGame = (gp, wins, left) => remainingWinsTarget(10.5, 1, played(gp, wins), left) / left;
        expect(perGame(4, 2, 8)).toBeGreaterThan(perGame(8, 4, 4));
        expect(perGame(8, 4, 4)).toBeGreaterThan(perGame(10, 5, 2));
    });

    it('ranks a winning team above a losing one on the same schedule', () => {
        const losing = remainingWinsTarget(10.5, 1, played(7, 3), 5);   // 3-4
        const winning = remainingWinsTarget(10.5, 1, played(7, 6), 5);  // 6-1
        expect(winning).toBeGreaterThan(losing);
    });

    it('leans on the preseason number early and on results late', () => {
        // BLEND_GAMES is the point where actual results earn half the say.
        const prior = 10.5 / 12;
        const early = remainingWinsTarget(10.5, 1, played(2, 0), 10) / 10;
        const late = remainingWinsTarget(10.5, 1, played(10, 0), 2) / 2;
        expect(prior - early).toBeLessThan(prior - late);   // early stays nearer the prior
        expect(late).toBeLessThan(early);
        expect(BLEND_GAMES).toBe(10);
    });

    it('stays inside [0, games left] at the extremes', () => {
        expect(remainingWinsTarget(0, 1, played(8, 0), 4)).toBe(0);
        expect(remainingWinsTarget(12, 1, played(8, 8), 4)).toBeLessThanOrEqual(4);
        expect(remainingWinsTarget(10.5, 1, played(8, 4), 0)).toBe(0);
    });

    it('answers null without a preseason number to anchor on', () => {
        expect(remainingWinsTarget(null, 1, played(4, 2), 8)).toBeNull();
    });
});

describe('gamesPlayed', () => {
    it('counts only this team\'s completed regular games', () => {
        const games = [
            { seasonType: 'regular', completed: true, homeId: 1, awayId: 2, homePoints: 1, awayPoints: 0 },
            { seasonType: 'regular', completed: false, homeId: 1, awayId: 2 },
            { seasonType: 'postseason', completed: true, homeId: 1, awayId: 2, homePoints: 1, awayPoints: 0 },
            { seasonType: 'regular', completed: true, homeId: 3, awayId: 4, homePoints: 1, awayPoints: 0 }
        ];
        expect(gamesPlayed(1, games)).toBe(1);
    });
});
