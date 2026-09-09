// Pure tests for public/alt-spread.js — the ladder and suggested price behind
// the alt-spread board.

const alt = require('../public/alt-spread');

describe('coverProbability', () => {
    test('the book number is a coin flip', () => {
        expect(alt.coverProbability(-10, -10)).toBeCloseTo(0.5, 6);
    });

    test('laying more points is less likely to cover', () => {
        expect(alt.coverProbability(-10, -17.5)).toBeLessThan(0.5);
    });

    test('taking a shorter number is more likely to cover', () => {
        expect(alt.coverProbability(-10, -3.5)).toBeGreaterThan(0.5);
    });

    test('the two sides of the same move are mirror images', () => {
        // A dog at +3 off a +10 line is exactly as hard as a favorite at -17
        // off a -10 line: both moved 7 points against the bettor.
        expect(alt.coverProbability(10, 3)).toBeCloseTo(alt.coverProbability(-10, -17), 10);
    });

    test('returns null without a book line to move off of', () => {
        expect(alt.coverProbability(null, -3)).toBeNull();
        expect(alt.coverProbability(-3, null)).toBeNull();
    });
});

describe('suggestedOdds', () => {
    test('the book number prices at the standard -110', () => {
        expect(alt.suggestedOdds(-10, -10)).toBe(-110);
        expect(alt.suggestedOdds(7.5, 7.5)).toBe(-110);
    });

    // The three alt legs this group actually bought from DraftKings in 2026,
    // back when they had to be typed into the Custom box. The model is fitted to
    // them, so this is the calibration it must not drift away from.
    test.each([
        ['LSU -10 bought to -6.5', -10, -6.5, -181],
        ['Duke -9.5 bought to -2.5', -9.5, -2.5, -271],
        ['USC -37.5 bought to -30.5', -37.5, -30.5, -279]
    ])('%s lands near the price DK charged', (_label, base, line, actual) => {
        const suggested = alt.suggestedOdds(base, line);
        expect(Math.abs(suggested - actual) / Math.abs(actual)).toBeLessThan(0.05);
    });

    test('laying extra points pays plus money', () => {
        expect(alt.suggestedOdds(-7, -14)).toBeGreaterThan(100);
    });

    test('buying points costs juice', () => {
        expect(alt.suggestedOdds(-7, -1.5)).toBeLessThan(-110);
    });

    test('never quotes an impossible price between -100 and +100', () => {
        for (let d = -21; d <= 21; d += 0.5) {
            const odds = alt.suggestedOdds(-7, -7 + d);
            expect(odds <= -100 || odds >= 100).toBe(true);
        }
    });

    test('a hopeless line is capped rather than run off to infinity', () => {
        expect(alt.suggestedOdds(-3, -70)).toBeLessThanOrEqual(5000);
        expect(alt.suggestedOdds(-3, 70)).toBeGreaterThanOrEqual(-5000);
    });

    test('returns null when the game has no book line', () => {
        expect(alt.suggestedOdds(null, -3)).toBeNull();
    });
});

describe('ladder', () => {
    test('is centred on the book line and moves in half points', () => {
        const steps = alt.ladder(-10, 3);
        expect(steps[0]).toBe(-13);
        expect(steps[steps.length - 1]).toBe(-7);
        expect(steps).toContain(-10);
        expect(steps).toContain(-9.5);
    });

    test('keeps the key whole numbers on it', () => {
        // -3 and -7 are the two most bet numbers in football; a ladder that
        // skipped them to avoid pushes would be useless.
        const steps = alt.ladder(-7, 7);
        expect(steps).toContain(-3);
        expect(steps).toContain(-7);
    });

    test('centres on pick-em when there is no book line', () => {
        const steps = alt.ladder(null, 2);
        expect(steps[0]).toBe(-2);
        expect(steps[steps.length - 1]).toBe(2);
    });

    test('snaps an odd book number onto the half-point grid', () => {
        const steps = alt.ladder(-10.25, 1);
        steps.forEach(v => expect(Math.abs((v * 2) % 1)).toBe(0));
    });
});

describe('formatLine', () => {
    test('signs a dog and leaves a favorite negative', () => {
        expect(alt.formatLine(3.5)).toBe('+3.5');
        expect(alt.formatLine(-3.5)).toBe('-3.5');
    });

    test('does not decimalise a whole number', () => {
        expect(alt.formatLine(-7)).toBe('-7');
    });

    test('calls a zero line what it is', () => {
        expect(alt.formatLine(0)).toBe('PK');
    });

    test('is blank for a missing line', () => {
        expect(alt.formatLine(null)).toBe('');
    });
});
