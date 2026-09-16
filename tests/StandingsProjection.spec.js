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

// Captain and H2H are part of the score the scoring job writes, so a projection
// of the FINAL score has to include them. Banked points already did; the forward
// half did not, which understated every graham-league manager by 35-50 points.
describe('engagement terms', () => {
    const { expectedCaptainWeek, expectedCaptain, expectedH2H, applyEngagement } =
        require('../modules/standings-projection');

    const team = (teamId, games) => ({ teamId, games });
    const g = (week, winProb, pointsIfWin) => ({ week, winProb, pointsIfWin });

    describe('captain', () => {
        it('doubles the team with the best EXPECTED week, not the luckiest', () => {
            // B has the higher ceiling but A the higher expectation, and a
            // manager has to choose before kickoff.
            const week = [team(1, [g(3, 0.9, 10)]), team(2, [g(3, 0.1, 50)])];
            expect(expectedCaptainWeek(week, 2)).toBeCloseTo(9, 6);   // 0.9 * 10
        });

        it('scales with the multiplier', () => {
            const week = [team(1, [g(3, 0.5, 10)])];
            expect(expectedCaptainWeek(week, 2)).toBeCloseTo(5, 6);
            expect(expectedCaptainWeek(week, 3)).toBeCloseTo(10, 6);
        });

        it('pays nothing for a team that cannot score', () => {
            expect(expectedCaptainWeek([team(1, [g(3, 0, 20)])], 2)).toBe(0);
            expect(expectedCaptainWeek([], 2)).toBe(0);
        });

        it('adds a team up across a double-game week', () => {
            const week = [team(1, [g(3, 0.5, 10), g(3, 0.5, 10)]), team(2, [g(3, 0.9, 8)])];
            expect(expectedCaptainWeek(week, 2)).toBeCloseTo(10, 6);   // 5 + 5 beats 7.2
        });

        it('sums across every remaining week', () => {
            const byWeek = { 3: [team(1, [g(3, 1, 4)])], 4: [team(1, [g(4, 1, 6)])] };
            expect(expectedCaptain(byWeek, 2)).toBeCloseTo(10, 6);
        });
    });

    describe('H2H', () => {
        const mgr = (userId, byWeek) => ({ userId, byWeek, projectedFinal: 100, expCaptain: 0, expH2H: 0 });

        it('is zero-sum: a week pays out one win bonus per pairing, however well everyone plays', () => {
            const a = mgr('a', { 3: [team(1, [g(3, 1, 30)])] });   // certain to score 30
            const b = mgr('b', { 3: [team(2, [g(3, 1, 30)])] });   // also certain to score 30
            const out = expectedH2H([a, b], ['a', 'b'], [3], 3, 1);
            expect(out.a + out.b).toBeCloseTo(3, 6);
        });

        it('splits the bonus when two managers are evenly matched', () => {
            const a = mgr('a', { 3: [team(1, [g(3, 0.5, 10)])] });
            const b = mgr('b', { 3: [team(2, [g(3, 0.5, 10)])] });
            const out = expectedH2H([a, b], ['a', 'b'], [3], 3, 0);
            expect(out.a).toBeCloseTo(1.5, 1);
            expect(out.b).toBeCloseTo(1.5, 1);
        });

        it('favours the stronger manager without ever paying both in full', () => {
            const a = mgr('a', { 3: [team(1, [g(3, 0.95, 20)])] });
            const b = mgr('b', { 3: [team(2, [g(3, 0.05, 20)])] });
            const out = expectedH2H([a, b], ['a', 'b'], [3], 3, 0);
            expect(out.a).toBeGreaterThan(out.b);
            expect(out.a + out.b).toBeCloseTo(3, 6);
        });

        it('pays nobody with fewer than two managers', () => {
            const a = mgr('a', { 3: [team(1, [g(3, 1, 10)])] });
            expect(expectedH2H([a], ['a'], [3], 3, 0)).toEqual({ a: 0 });
        });
    });

    describe('applyEngagement', () => {
        const mk = () => [
            { userId: 'a', projectedFinal: 100, byWeek: { 3: [team(1, [g(3, 1, 10)])] }, expCaptain: 0, expH2H: 0 },
            { userId: 'b', projectedFinal: 100, byWeek: { 3: [team(2, [g(3, 1, 4)])] }, expCaptain: 0, expH2H: 0 }
        ];

        it('leaves a classic league untouched', () => {
            const m = mk();
            applyEngagement(m, { captainEnabled: false, h2hEnabled: false });
            expect(m.map(x => x.projectedFinal)).toEqual([100, 100]);
            expect(m.map(x => x.expCaptain)).toEqual([0, 0]);
        });

        it('adds the captain term only when captain is on', () => {
            const m = mk();
            applyEngagement(m, { captainEnabled: true, captainMultiplier: 2, h2hEnabled: false });
            expect(m[0].expCaptain).toBeCloseTo(10, 6);
            expect(m[0].projectedFinal).toBe(110);
            expect(m[0].expH2H).toBe(0);
        });

        it('adds the H2H term only when H2H is on, and a wins it here', () => {
            const m = mk();
            applyEngagement(m, { captainEnabled: false, h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0 });
            expect(m[0].expCaptain).toBe(0);
            expect(m[0].expH2H).toBeCloseTo(3, 6);   // a scores 10, b scores 4, certain
            expect(m[1].expH2H).toBeCloseTo(0, 6);
        });
    });
});
