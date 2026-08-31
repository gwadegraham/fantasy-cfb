const { buildProjections, simulateTitleOdds } = require('../modules/standings-projection');
const { buildPoolContext, buildRankingProxy, projectTeamPoints } = require('../modules/draft-projection');
const { resolveConfig } = require('../modules/scoring-defaults');

const season = 2026;

const teamsById = {
    '1': { id: 1, school: 'Alpha', seasons: [{ season, spRating: 15, expectedWins: 9, conference: 'SEC' }] },
    '2': { id: 2, school: 'Beta', seasons: [{ season, spRating: -5, expectedWins: 4, conference: 'Big Ten' }] }
};

const cfg = resolveConfig('graham-league', null);
const rankings = buildRankingProxy(season, teamsById, null);
const poolCtx = buildPoolContext(teamsById, season);

function mkGame(id, overrides) {
    return Object.assign({
        id, season, seasonType: 'regular', completed: false,
        conferenceGame: false, neutralSite: false, notes: '',
        homeId: 1, awayId: 2, homeTeam: 'Alpha', awayTeam: 'Beta',
        homeConference: 'SEC', awayConference: 'Big Ten', week: 1
    }, overrides);
}

describe('projectTeamPoints with pregameWinProb', () => {
    it('uses CFBD pregameWinProb when present on a game', () => {
        const games = [
            mkGame(101, { pregameWinProb: 0.80, week: 1 }),
            mkGame(102, { pregameWinProb: 0.60, week: 2 })
        ];
        const proj = projectTeamPoints(teamsById['1'], games, poolCtx, rankings, cfg, season, { perGame: true });
        expect(proj.perGame[0].winProb).toBeCloseTo(0.80, 3);
        expect(proj.perGame[1].winProb).toBeCloseTo(0.60, 3);
    });

    it('flips pregameWinProb for the away team', () => {
        const games = [mkGame(201, { pregameWinProb: 0.80, week: 1, homeId: 1, awayId: 2 })];
        const proj = projectTeamPoints(teamsById['2'], games, poolCtx, rankings, cfg, season, { perGame: true });
        expect(proj.perGame[0].winProb).toBeCloseTo(0.20, 3);
    });

    it('falls back to SP+ margins when pregameWinProb is absent', () => {
        const games = [mkGame(301, { week: 1 })];
        const proj = projectTeamPoints(teamsById['1'], games, poolCtx, rankings, cfg, season, { perGame: true });
        expect(proj.perGame[0].winProb).toBeGreaterThan(0.5);
        expect(proj.perGame[0].winProb).toBeLessThan(1);
    });

    it('mixes CFBD and SP+ fallback games in the same schedule', () => {
        const games = [
            mkGame(401, { pregameWinProb: 0.90, week: 1 }),
            mkGame(402, { week: 2 }),
            mkGame(403, { pregameWinProb: 0.55, week: 3 })
        ];
        const proj = projectTeamPoints(teamsById['1'], games, poolCtx, rankings, cfg, season, { perGame: true });
        expect(proj.perGame).toHaveLength(3);
        expect(proj.perGame[0].winProb).toBeCloseTo(0.90, 3);
        expect(proj.perGame[1].winProb).toBeGreaterThan(0);
        expect(proj.perGame[2].winProb).toBeCloseTo(0.55, 3);
    });

    it('projected wins sums correctly across mixed sources', () => {
        const games = [
            mkGame(501, { pregameWinProb: 0.80, week: 1 }),
            mkGame(502, { pregameWinProb: 0.60, week: 2 })
        ];
        const proj = projectTeamPoints(teamsById['1'], games, poolCtx, rankings, cfg, season, { perGame: true });
        expect(proj.projWins).toBeCloseTo(0.80 + 0.60, 2);
    });
});

describe('buildProjections with pregameWinProb', () => {
    it('pregameWinProb flows through to per-game projections', () => {
        const users = [{
            _id: 'u1', firstName: 'Test', lastName: 'User',
            seasons: [{ season, cumulativeScore: 10, teams: [{ id: 1, school: 'Alpha' }] }]
        }];
        const gamesByTeam = {
            '1': [
                mkGame(601, { pregameWinProb: 0.85, week: 1 }),
                mkGame(602, { pregameWinProb: 0.70, week: 2 })
            ]
        };
        const out = buildProjections(users, teamsById, gamesByTeam, cfg, rankings, poolCtx, season);
        expect(out).toHaveLength(1);
        expect(out[0].perGame[0].winProb).toBeCloseTo(0.85, 3);
        expect(out[0].perGame[1].winProb).toBeCloseTo(0.70, 3);
        expect(out[0].projectedFinal).toBeGreaterThan(10);
    });
});
