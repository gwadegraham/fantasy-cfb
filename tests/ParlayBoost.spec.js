const {
    americanToDecimal,
    boostDecimalOdds,
    boostedAmericanOdds,
    boostedStake,
    boostedReturn,
    effectiveAmericanOdds,
    settledPayout
} = require('../modules/parlay-calc');

// Both books boost the profit, not the stake, and both cap the stake they'll
// boost. The numbers below are read off real bet slips.
describe('parlay boost math', () => {
    describe('boostDecimalOdds', () => {
        it('boosts the profit, leaving the stake alone', () => {
            // +355 is decimal 4.55, i.e. $3.55 profit per $1
            expect(boostDecimalOdds(4.55, 50)).toBeCloseTo(6.325, 4);
        });

        it('is a no-op without a percentage', () => {
            expect(boostDecimalOdds(4.55, 0)).toBe(4.55);
            expect(boostDecimalOdds(4.55, null)).toBe(4.55);
        });
    });

    describe('boostedAmericanOdds', () => {
        it('matches the DraftKings slip: +355 with a 50% profit boost is +532', () => {
            expect(boostedAmericanOdds(355, 50)).toBe(532);
        });

        it('matches the FanDuel slip: +398 with a 20% parlay boost is +478', () => {
            expect(boostedAmericanOdds(398, 20)).toBe(478);
        });

        it('returns null when either half of the boost is missing', () => {
            expect(boostedAmericanOdds(355, null)).toBeNull();
            expect(boostedAmericanOdds(null, 50)).toBeNull();
        });
    });

    describe('boostedStake', () => {
        it('boosts the whole wager when there is no cap', () => {
            expect(boostedStake(20, null)).toBe(20);
            expect(boostedStake(20, '')).toBe(20);
        });

        it('boosts only up to the cap', () => {
            expect(boostedStake(20, 10)).toBe(10);
        });

        it('ignores a cap larger than the wager', () => {
            expect(boostedStake(20, 50)).toBe(20);
        });

        it('treats a zero cap as no cap rather than as a stake of nothing', () => {
            expect(boostedStake(20, 0)).toBe(20);
        });
    });

    describe('boostedReturn', () => {
        it('matches the DraftKings slip: $10 at +355 with a 50% boost returns $63.25', () => {
            expect(boostedReturn(10, americanToDecimal(355), 50, null)).toBe(63.25);
        });

        it('matches the FanDuel slip: $10 at +398 with a 20% boost returns $57.76', () => {
            expect(boostedReturn(10, americanToDecimal(398), 20, 10)).toBe(57.76);
        });

        it('splits a $20 wager against a $10 cap, boosting only half', () => {
            // $10 boosted at +478 ($57.76) + $10 plain at +398 ($49.80)
            expect(boostedReturn(20, americanToDecimal(398), 20, 10)).toBe(107.56);
        });

        it('pays the plain odds when there is no boost', () => {
            expect(boostedReturn(20, americanToDecimal(398), 0, 10)).toBe(99.6);
        });

        it('returns nothing without a wager', () => {
            expect(boostedReturn(0, 4.98, 20, 10)).toBe(0);
        });
    });

    describe('effectiveAmericanOdds', () => {
        it('blends the capped and uncapped halves into the ticket\'s real odds', () => {
            // Not the +478 the slip advertises — half the stake rode at +398
            expect(effectiveAmericanOdds(20, americanToDecimal(398), 20, 10)).toBe(438);
        });

        it('is just the boosted number when the cap covers the whole wager', () => {
            expect(effectiveAmericanOdds(10, americanToDecimal(398), 20, 10)).toBe(478);
        });
    });

    describe('settledPayout', () => {
        const legs = [
            { odds: -160, result: 'win' },
            { odds: -163, result: 'win' }
        ];

        it('honors a hand-typed total payout above everything else', () => {
            const paid = settledPayout({ wager: 20, totalPayout: 99.99, boostPct: 50, parlayOdds: 398, legs });
            expect(paid).toBe(99.99);
        });

        it('applies the boost and its cap when one is set', () => {
            const paid = settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10, legs });
            expect(paid).toBe(107.56);
        });

        it('pays the boosted number off the slip rather than re-deriving it', () => {
            // The book rounds its own display: +398 boosted 20% is really
            // +477.6, and FanDuel shows +478. Pay what the slip says.
            const paid = settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10, boostedOdds: 478, legs });
            expect(paid).toBe(107.6);
        });

        it('prefers the odds off the slip over the product of the legs', () => {
            const fromLegs = settledPayout({ wager: 20, boostPct: 20, boostCap: 10, legs });
            const fromSlip = settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10, legs });
            expect(fromLegs).not.toBe(fromSlip);
        });

        it('falls back to the plain leg product when no boost was recorded', () => {
            // -160 x -163 = 1.625 x 1.6135 = 2.6219 decimal
            expect(settledPayout({ wager: 20, legs })).toBeCloseTo(52.44, 1);
        });

        it('pays nothing without a wager', () => {
            expect(settledPayout({ legs })).toBe(0);
            expect(settledPayout(null)).toBe(0);
        });
    });
});
