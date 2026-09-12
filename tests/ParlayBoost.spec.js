const {
    toCents,
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

    describe('toCents', () => {
        it('rounds a payout up to the next cent, the way the books do', () => {
            expect(toCents(108.8043)).toBe(108.81);
            expect(toCents(45.521713)).toBe(45.53);
        });

        // Guard. 10 * 5.776 is 57.760000000000005 in floating point; a naive
        // ceiling turns an exact $57.76 into $57.77.
        it('does not invent a cent out of float noise', () => {
            expect(toCents(10 * 5.776)).toBe(57.76);
            expect(toCents(63.25)).toBe(63.25);
            expect(toCents(20)).toBe(20);
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
            // No legs priced yet, so this prices off the typed slip odds
            const paid = settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10 });
            expect(paid).toBe(107.56);
        });

        it('applies the cap to the leg price once the legs are filled in', () => {
            // -160 x -163 = 2.621933; $10 boosted 20% + $10 plain
            const paid = settledPayout({ wager: 20, boostPct: 20, boostCap: 10, legs });
            expect(paid).toBe(55.69);
        });

        // Regression, against a real FanDuel ticket. The slip's "+355" is the
        // ROUNDED display of 4.552171; computing off it paid $108.70 where
        // FanDuel paid $108.81. The legs are quoted whole, so their product is
        // the exact price.
        it('prices off the legs when they confirm the slip, not the rounded display', () => {
            const real = [{ odds: -345 }, { odds: -205 }, { odds: -200 }, { odds: -172 }];
            const paid = settledPayout({
                wager: 20, parlayOdds: 355, boostPct: 50, boostedOdds: 532, boostCap: 10, legs: real
            });

            expect(paid).toBe(108.81);
            // what pricing off the rounded +355 / +532 used to produce
            expect(paid).not.toBe(108.7);
        });

        // Regression, against a real DraftKings slip. Its legs were the prices
        // locked at placement and still multiply to +529 against a ticket the
        // book priced at +355. Whatever the book is doing, +355 is what pays —
        // a 174-point "correction" is not a rounding fix. The legs are trusted
        // only when rounding them back lands on the number that was typed.
        it('keeps the book price when the legs do not agree with it', () => {
            const drifted = [{ odds: -250 }, { odds: -163 }, { odds: -160 }, { odds: -140 }];

            const paid = settledPayout({
                wager: 20, parlayOdds: 355, boostPct: 50, boostCap: 10, legs: drifted
            });

            expect(paid).toBe(108.75);
            // priced off the legs' +529 instead, this was $152.32
            expect(paid).not.toBe(152.32);
        });

        it('still uses the legs when they round back to the typed number', () => {
            const agreeing = [{ odds: -345 }, { odds: -205 }, { odds: -200 }, { odds: -172 }];

            // exact product 4.552171 rather than the displayed 4.55
            expect(settledPayout({ wager: 20, parlayOdds: 355, boostPct: 50, boostCap: 10, legs: agreeing }))
                .toBe(108.81);
        });

        it('derives the boosted slice from the percentage, not the rounded boosted odds', () => {
            const withStored = settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10, boostedOdds: 478 });
            const without = settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10 });
            expect(withStored).toBe(without);
        });

        it('falls back to the typed odds when the legs are not all priced yet', () => {
            const half = [{ odds: -160 }, { odds: null }];
            expect(settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10, legs: half }))
                .toBe(settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10, legs: [] }));
        });

        // Regression. parlayOdds is the price of the WHOLE slip; when a leg
        // pushes the book re-prices without it. Pricing a boosted ticket off
        // the stored slip number paid $315.24 where $124.90 was owed.
        it('drops a pushed leg instead of paying the whole-slip price', () => {
            const withPush = [
                { odds: -160, result: 'win' },
                { odds: -163, result: 'win' },
                { odds: 150, result: 'push' },
                { odds: 120, result: 'win' }
            ];
            const paid = settledPayout({
                wager: 20, parlayOdds: 1342, boostPct: 20, boostCap: 10, legs: withPush
            });

            expect(paid).toBe(124.91);
        });

        // Regression. americanToDecimal returns a flat 1 between -100 and +100,
        // so a fat-fingered "45" priced a winning ticket at stake-back.
        it('ignores a parlayOdds no board could have quoted', () => {
            const paid = settledPayout({ wager: 20, parlayOdds: 45, boostPct: 50, boostCap: 10, legs });

            expect(paid).not.toBe(20);
            expect(paid).toBe(settledPayout({ wager: 20, boostPct: 50, boostCap: 10, legs }));
        });

        it('pays nothing rather than a made-up number when there is no usable price', () => {
            // legs carrying no odds must reach the price check, not short-circuit
            // out of parlayPayout on an empty array
            expect(settledPayout({ wager: 20, parlayOdds: 45, boostPct: 50, legs: [{ odds: null }] })).toBe(0);
            expect(settledPayout({ wager: 20, parlayOdds: 45, legs: [{ odds: null }] })).toBe(0);
            expect(settledPayout({ wager: 20, parlayOdds: 45, boostPct: 50, legs: [] })).toBe(0);
        });

        // Regression. The unboosted branch recomputed from the legs alone and
        // threw away the price it had just resolved — and an unpriced leg
        // multiplies by 1.0. A $20 ticket at a typed +398 paid $32.50 instead
        // of $99.60 the moment one member hadn't entered their odds. Adding a
        // boost to the same parlay produced the RIGHT number, which is the tell.
        it('uses the slip price when the legs are not all priced, boost or not', () => {
            const partial = [{ odds: -160 }, { odds: null }];

            expect(settledPayout({ wager: 20, parlayOdds: 398, legs: partial })).toBe(99.6);
            expect(settledPayout({ wager: 20, parlayOdds: 398, legs: [] })).toBe(99.6);
            // the boosted path was already correct; the two now agree on 4.98
            expect(settledPayout({ wager: 20, parlayOdds: 398, boostPct: 20, boostCap: 10, legs: partial }))
                .toBe(107.56);
        });

        it('refuses to price a ticket off a leg no board could have quoted', () => {
            expect(settledPayout({ wager: 20, legs: [{ odds: -160 }, { odds: 45 }] })).toBe(0);
        });

        // Latent, but the same trap a single push already sprang: parlayOdds
        // priced legs that no longer count.
        it('does not fall back to the slip price when every leg pushed', () => {
            const allPush = [
                { odds: 150, result: 'push' },
                { odds: 120, result: 'push' }
            ];
            expect(settledPayout({ wager: 20, parlayOdds: 1342, boostPct: 20, boostCap: 10, legs: allPush }))
                .toBe(0);
        });

        it('falls back to the plain leg product when no boost was recorded', () => {
            // -160 x -163 = 1.625 x 1.6135 = 2.6219 decimal
            expect(settledPayout({ wager: 20, legs })).toBe(52.44);
        });

        it('pays nothing without a wager', () => {
            expect(settledPayout({ legs })).toBe(0);
            expect(settledPayout(null)).toBe(0);
        });
    });
});
