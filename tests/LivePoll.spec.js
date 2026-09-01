const { anyGameInProgress, decide } = require('../modules/live-poll');

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
    const base = { phase: 'regular', remainingCalls: 4500, buffer: 300 };

    it('polls when a regular game is in progress and under the ceiling', () => {
        expect(decide(base)).toMatchObject({ poll: true });
    });

    it('polls when a postseason game is in progress', () => {
        expect(decide({ ...base, phase: 'postseason' })).toMatchObject({ poll: true });
    });

    it('skips when no game is in progress', () => {
        expect(decide({ ...base, phase: null })).toMatchObject({ poll: false, reason: 'no game in progress' });
    });

    it('skips at or below the call buffer (protects admin headroom)', () => {
        expect(decide({ ...base, remainingCalls: 300 }).poll).toBe(false);
        expect(decide({ ...base, remainingCalls: 299 }).poll).toBe(false);
        expect(decide({ ...base, remainingCalls: 301 }).poll).toBe(true);
    });

    it('does not block scoring when remaining calls are unknown', () => {
        expect(decide({ ...base, remainingCalls: null }).poll).toBe(true);
    });
});
