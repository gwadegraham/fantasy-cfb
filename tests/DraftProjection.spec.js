const {
    marginToWinProb, calibrateToExpectedWins, winTotalDistribution, pAtLeast
} = require('../modules/win-probability');
const {
    solveQ, expectedCfpPoints, computeLeagueBands
} = require('../modules/draft-projection');
const { evaluate } = require('../modules/scoring');
const { resolveConfig } = require('../modules/scoring-defaults');

// A synthetic "team (home) won" regular-season game against `oppConf`, optionally
// with the opponent ranked in a supplied poll.
function winGame(overrides) {
    return Object.assign({
        id: 1, season: 2026, week: 1, seasonType: 'regular',
        neutralSite: false, conferenceGame: false, notes: '',
        homeId: 1, homeTeam: 'A', homeConference: 'SEC', homePoints: 1,
        awayId: 2, awayTeam: 'B', awayConference: 'Big Ten', awayPoints: 0
    }, overrides || {});
}
const rankedPoll = (school, rank) => ({ polls: [{ poll: 'AP Top 25', ranks: [{ school, rank }] }] });
const GRAHAM = resolveConfig('graham-league', null);
const CLAUNTS = resolveConfig('claunts-league', null);

describe('win-probability', () => {
    it('maps margin to win prob with sane anchors', () => {
        expect(marginToWinProb(0)).toBeCloseTo(0.5, 3);
        expect(marginToWinProb(10)).toBeGreaterThan(0.70);
        expect(marginToWinProb(10)).toBeLessThan(0.76);
        expect(marginToWinProb(17)).toBeGreaterThan(0.83);
        // symmetric
        expect(marginToWinProb(-8) + marginToWinProb(8)).toBeCloseTo(1, 3);
    });

    it('calibrates per-game probs to sum to expectedWins (additive shift)', () => {
        const margins = [20, 10, 5, -3, -15, 2, -8];
        const { probs, delta } = calibrateToExpectedWins(margins, 4.2);
        const sum = probs.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(4.2, 2);
        expect(probs.every(p => p > 0 && p < 1)).toBe(true);   // stays in (0,1)
        expect(typeof delta).toBe('number');
    });

    it('returns raw probs when expectedWins is null', () => {
        const margins = [10, -10];
        const { probs, delta } = calibrateToExpectedWins(margins, null);
        expect(delta).toBe(0);
        expect(probs[0]).toBeCloseTo(marginToWinProb(10), 6);
    });

    it('Poisson-binomial distribution sums to 1 with mean = Σp', () => {
        const probs = [0.9, 0.5, 0.2, 0.7];
        const dist = winTotalDistribution(probs);
        expect(dist).toHaveLength(probs.length + 1);
        expect(dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
        const mean = dist.reduce((s, p, k) => s + k * p, 0);
        expect(mean).toBeCloseTo(probs.reduce((a, b) => a + b, 0), 6);
        expect(pAtLeast(dist, 0)).toBeCloseTo(1, 6);
    });
});

describe('evaluate reuse via synthesized win game', () => {
    it('scores a plain non-conf unranked win = 1 in both leagues', () => {
        expect(evaluate('graham', 1, winGame(), {}, GRAHAM)).toBe(1);
        expect(evaluate('claunts', 1, winGame(), {}, CLAUNTS)).toBe(1);
    });

    it('scores a conference win: Graham base+conf=2, Claunts conf=2', () => {
        const g = winGame({ conferenceGame: true, awayConference: 'SEC' });
        expect(evaluate('graham', 1, g, {}, GRAHAM)).toBe(2);
        expect(evaluate('claunts', 1, g, {}, CLAUNTS)).toBe(2);
    });

    it('scores a non-conf win vs a top-10 team: Graham 1+2=3, Claunts 3', () => {
        const g = winGame();
        const r = rankedPoll('B', 5);
        expect(evaluate('graham', 1, g, r, GRAHAM)).toBe(3);
        expect(evaluate('claunts', 1, g, r, CLAUNTS)).toBe(3);
    });

    it('ranked proxy keyed by opponent NAME drives the bonus', () => {
        // Wrong name in the poll → no ranked bonus (guards the name-join risk).
        const g = winGame();
        expect(evaluate('graham', 1, g, rankedPoll('WRONG', 5), GRAHAM)).toBe(1);
    });
});

describe('CFP bracket model', () => {
    it('solveQ inverts c = m·[β q³ + (1−β) q⁴]', () => {
        const m = 0.6, c = 0.06, beta = 0.2;
        const q = solveQ(m, c, beta);
        expect(q).toBeGreaterThan(0);
        expect(q).toBeLessThan(1);
        expect(m * (beta * q ** 3 + (1 - beta) * q ** 4)).toBeCloseTo(c, 4);
    });

    it('expected CFP points are non-negative and increase with make prob', () => {
        const low = expectedCfpPoints(9, 0.2, 0.0, solveQ(0.2, 0.01, 0), {}, GRAHAM);
        const high = expectedCfpPoints(9, 0.9, 0.4, solveQ(0.9, 0.2, 0.4), {}, GRAHAM);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeGreaterThan(low);
    });
});

describe('absolute per-league bands', () => {
    it('elite average exceeds replacement average', () => {
        const totals = Array.from({ length: 130 }, (_, i) => 200 - i).sort((a, b) => b - a);
        const bands = computeLeagueBands(totals, 6, 10);
        expect(bands.eliteAvg).toBeGreaterThan(bands.replacementAvg);
    });
});
