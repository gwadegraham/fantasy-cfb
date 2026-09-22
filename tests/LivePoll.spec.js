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
    const base = { phase: 'regular' };

    it('polls when a regular game is in progress', () => {
        expect(decide(base)).toMatchObject({ poll: true });
    });

    it('polls when a postseason game is in progress', () => {
        expect(decide({ phase: 'postseason' })).toMatchObject({ poll: true });
    });

    it('skips when no game is in progress', () => {
        expect(decide({ phase: null })).toMatchObject({ poll: false, reason: 'no game in progress' });
    });

    // The deleted call-ceiling guard: a low remaining-calls count must no longer
    // stop the poll. It never protected the poll's own spend (CFBD does not bill
    // /scoreboard) and blocking the poll blocked completion detection with it,
    // leaving finals unsettled. Asserted so a reinstated guard fails loudly.
    it('polls regardless of how few CFBD calls remain', () => {
        expect(decide({ phase: 'regular', remainingCalls: 0, buffer: 300 }).poll).toBe(true);
        expect(decide({ phase: 'regular', remainingCalls: 1 }).poll).toBe(true);
        expect(decide({ phase: 'regular', remainingCalls: null }).poll).toBe(true);
    });
});

// A TBD kickoff is not a kickoff. CFBD stores those as midnight EASTERN, so
// this gate would open at 11 PM Central the night before and hold the poller
// on for the whole window — every 10 seconds, against billable endpoints, on a
// game nobody is playing. See public/kickoff-day.js.
describe('anyGameInProgress with a TBD kickoff', () => {
    const now = Date.parse('2026-10-03T17:00:00.000Z');

    it('false for a TBD game whose placeholder has passed', () => {
        const games = [{ startDate: '2026-10-03T04:00:00.000Z', startTimeTbd: true, completed: false }];
        expect(anyGameInProgress(games, now, 9)).toBe(false);
    });

    it('still true for a real kickoff in the same slate', () => {
        const games = [
            { startDate: '2026-10-03T04:00:00.000Z', startTimeTbd: true, completed: false },
            { startDate: '2026-10-03T16:00:00.000Z', startTimeTbd: false, completed: false }
        ];
        expect(anyGameInProgress(games, now, 9)).toBe(true);
    });
});
