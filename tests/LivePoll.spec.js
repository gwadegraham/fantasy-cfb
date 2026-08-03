const { isLivePollDay, isOnCadence, cadenceOk, anyGameInProgress, decide } = require('../modules/live-poll');

// Day-of-week: Sun=0 ... Sat=6.
describe('isLivePollDay', () => {
    it('is true only for Thu/Fri/Sat', () => {
        expect([0, 1, 2, 3, 4, 5, 6].map(isLivePollDay))
            .toEqual([false, false, false, false, true, true, true]);
    });
});

describe('isOnCadence', () => {
    it('Saturday polls on every 10-min mark', () => {
        expect(isOnCadence(6, 0)).toBe(true);
        expect(isOnCadence(6, 10)).toBe(true);
        expect(isOnCadence(6, 30)).toBe(true);
        expect(isOnCadence(6, 50)).toBe(true);
    });

    it('Thu/Fri only poll every 20 min (skip :10/:30/:50)', () => {
        [4, 5].forEach(dow => {
            expect(isOnCadence(dow, 0)).toBe(true);
            expect(isOnCadence(dow, 20)).toBe(true);
            expect(isOnCadence(dow, 40)).toBe(true);
            expect(isOnCadence(dow, 10)).toBe(false);
            expect(isOnCadence(dow, 30)).toBe(false);
            expect(isOnCadence(dow, 50)).toBe(false);
        });
    });

    it('never polls on a non-live-poll day', () => {
        expect(isOnCadence(0, 0)).toBe(false);
        expect(isOnCadence(2, 20)).toBe(false);
    });
});

describe('cadenceOk (phase-aware)', () => {
    it('regular: Thu/Fri/Sat only, at the regular cadence', () => {
        expect(cadenceOk('regular', 6, 10)).toBe(true);   // Sat @10
        expect(cadenceOk('regular', 4, 20)).toBe(true);   // Thu @20
        expect(cadenceOk('regular', 4, 10)).toBe(false);  // Thu off-cadence
        expect(cadenceOk('regular', 1, 0)).toBe(false);   // Monday — no regular polling
        expect(cadenceOk('regular', 0, 0)).toBe(false);   // Sunday
    });

    it('postseason: every 10 min, ANY day (incl. the Monday championship)', () => {
        expect(cadenceOk('postseason', 1, 0)).toBe(true);   // Monday @00
        expect(cadenceOk('postseason', 1, 30)).toBe(true);  // Monday @30
        expect(cadenceOk('postseason', 3, 40)).toBe(true);  // Wednesday bowl
        expect(cadenceOk('postseason', 6, 10)).toBe(true);  // Saturday
    });

    it('no phase never polls', () => {
        expect(cadenceOk(null, 6, 0)).toBe(false);
    });
});

describe('anyGameInProgress', () => {
    const now = Date.parse('2026-09-05T20:00:00.000Z');
    const iso = ms => new Date(ms).toISOString();

    it('true for a game that kicked off recently and is not completed', () => {
        const games = [{ startDate: iso(now - 60 * 60 * 1000), completed: false }]; // 1h ago
        expect(anyGameInProgress(games, now, 6)).toBe(true);
    });

    it('false when the only game is already completed', () => {
        const games = [{ startDate: iso(now - 60 * 60 * 1000), completed: true }];
        expect(anyGameInProgress(games, now, 6)).toBe(false);
    });

    it('false for a game that has not kicked off yet', () => {
        const games = [{ startDate: iso(now + 30 * 60 * 1000), completed: false }]; // 30m from now
        expect(anyGameInProgress(games, now, 6)).toBe(false);
    });

    it('false past the max-hours tail (stuck completed flag stops polling)', () => {
        const games = [{ startDate: iso(now - 7 * 60 * 60 * 1000), completed: false }]; // 7h ago
        expect(anyGameInProgress(games, now, 6)).toBe(false);
    });

    it('true right at the edge of the tail', () => {
        const games = [{ startDate: iso(now - 6 * 60 * 60 * 1000), completed: false }]; // exactly 6h
        expect(anyGameInProgress(games, now, 6)).toBe(true);
    });

    it('ignores unparseable/empty inputs', () => {
        expect(anyGameInProgress([{ startDate: 'nope', completed: false }], now, 6)).toBe(false);
        expect(anyGameInProgress([], now, 6)).toBe(false);
        expect(anyGameInProgress(undefined, now, 6)).toBe(false);
    });
});

describe('decide', () => {
    const base = { dow: 6, minute: 0, phase: 'regular', remainingCalls: 500, buffer: 100 };

    it('polls a live regular game on the cadence, under the ceiling', () => {
        expect(decide(base)).toMatchObject({ poll: true });
    });

    it('polls a live postseason game any day (Monday championship)', () => {
        expect(decide({ ...base, phase: 'postseason', dow: 1, minute: 30 })).toMatchObject({ poll: true });
    });

    it('skips a regular game off its day/cadence', () => {
        expect(decide({ ...base, dow: 1 }).poll).toBe(false);          // Monday
        expect(decide({ ...base, dow: 4, minute: 10 }).poll).toBe(false); // Thu off-cadence
    });

    it('skips when no game is in progress', () => {
        expect(decide({ ...base, phase: null })).toMatchObject({ poll: false, reason: 'no game in progress' });
    });

    it('skips at or below the call buffer (protects manual-admin headroom)', () => {
        expect(decide({ ...base, remainingCalls: 100 }).poll).toBe(false);
        expect(decide({ ...base, remainingCalls: 99 }).poll).toBe(false);
        expect(decide({ ...base, remainingCalls: 101 }).poll).toBe(true);
    });

    it('does not block scoring when remaining calls are unknown', () => {
        expect(decide({ ...base, remainingCalls: null }).poll).toBe(true);
    });
});
