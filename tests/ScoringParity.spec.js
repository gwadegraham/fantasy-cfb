// Parity proof for the Phase-2 unified engine: for the DEFAULT (unchanged)
// configuration, the new data-driven engine must score every game identically
// to the frozen pre-Phase-2 engine (tests/legacyScoring.reference.js).
//
// We generate a large matrix of synthetic games covering every scoring
// condition crossed with win/loss, home/away, ranking tier, conference vs
// non-conference, and P5/non-P5 matchups, then assert engine == oracle for both
// models on every case.

const engine = require('../modules/scoring');
const legacy = require('./legacyScoring.reference');
const { CLAUNTS_DEFAULTS, GRAHAM_DEFAULTS } = require('../modules/scoring-defaults');

// The new engine fetches rankings via global.fetch; the oracle takes them
// directly. Feed both the same rankings for each case.
function mockRankings(ranks) {
    global.fetch = jest.fn(() => Promise.resolve({
        json: () => Promise.resolve({ polls: [{ poll: 'AP Top 25', ranks }] })
    }));
    return { polls: [{ poll: 'AP Top 25', ranks }] };
}
afterEach(() => { jest.restoreAllMocks(); });

// --- matrix generation ---------------------------------------------------

const CONFERENCES = ['SEC', 'ACC', 'Big Ten', 'Big 12', 'Sun Belt', 'Mid-American', 'FBS Independents'];
const RANK_TIERS = [
    { label: 'unranked', ranks: [] },
    { label: 'top25', ranks: [{ school: 'Opp', rank: 18 }] },
    { label: 'top10', ranks: [{ school: 'Opp', rank: 4 }] }
];
const NOTES = [
    { label: 'plain', notes: null, seasonType: 'regular' },
    { label: 'confChamp', notes: 'SEC Championship', seasonType: 'regular' },
    { label: 'bowl', notes: 'Famous Toastery Bowl', seasonType: 'postseason' },
    { label: 'roseBowlName', notes: 'Rose Bowl Game', seasonType: 'postseason' },
    { label: 'firstRound', notes: 'CFP First Round', seasonType: 'postseason' },
    { label: 'quarterfinal', notes: 'CFP Quarterfinal at the Rose Bowl Game', seasonType: 'postseason' },
    { label: 'semifinal', notes: 'CFP Semifinal at the Rose Bowl Game Pres. by Prudential', seasonType: 'postseason' },
    { label: 'natlChamp', notes: 'CFP National Championship Pres. by AT&T', seasonType: 'postseason' },
    { label: 'confGameFlag', notes: null, seasonType: 'regular' }
];

// Builds every game/team permutation of the matrix.
function* cases() {
    for (const note of NOTES) {
        for (const homeConf of CONFERENCES) {
            for (const awayConf of CONFERENCES) {
                for (const confGame of [true, false]) {
                    for (const homeWins of [true, false]) {
                        for (const tier of RANK_TIERS) {
                            for (const scoreTeam of ['home', 'away']) {
                                const game = {
                                    seasonType: note.seasonType,
                                    notes: note.notes,
                                    conferenceGame: confGame,
                                    homeId: 1, awayId: 2,
                                    homeTeam: 'MyTeam', awayTeam: 'Opp',
                                    homePoints: homeWins ? 31 : 17,
                                    awayPoints: homeWins ? 17 : 31,
                                    homeConference: homeConf, awayConference: awayConf
                                };
                                const teamId = scoreTeam === 'home' ? 1 : 2;
                                yield { game, teamId, ranks: tier.ranks };
                            }
                        }
                    }
                }
            }
        }
    }
}

describe('Phase 2 parity: unified engine == frozen legacy engine (default config)', () => {
    it('Claunts (V1) matches across the full synthetic matrix', async () => {
        let checked = 0, mismatches = [];
        for (const c of cases()) {
            const rankings = mockRankings(c.ranks);
            const got = await engine.calculateScoreV1(c.teamId, c.game, 5, 2025, CLAUNTS_DEFAULTS);
            const want = legacy.calculateScoreV1(c.teamId, c.game, rankings, CLAUNTS_DEFAULTS);
            if (got !== want) mismatches.push({ ...c, got, want });
            checked++;
        }
        if (mismatches.length) {
            throw new Error(`${mismatches.length}/${checked} V1 mismatches, e.g. ` +
                JSON.stringify(mismatches[0], null, 2));
        }
        expect(checked).toBeGreaterThan(1000);
    });

    it('Graham (V2) matches across the full synthetic matrix', async () => {
        let checked = 0, mismatches = [];
        for (const c of cases()) {
            const rankings = mockRankings(c.ranks);
            const got = await engine.calculateScoreV2(c.teamId, c.game, 5, 2025, GRAHAM_DEFAULTS);
            const want = legacy.calculateScoreV2(c.teamId, c.game, rankings, GRAHAM_DEFAULTS);
            if (got !== want) mismatches.push({ ...c, got, want });
            checked++;
        }
        if (mismatches.length) {
            throw new Error(`${mismatches.length}/${checked} V2 mismatches, e.g. ` +
                JSON.stringify(mismatches[0], null, 2));
        }
        expect(checked).toBeGreaterThan(1000);
    });
});
