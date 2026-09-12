// Pure detection of push-worthy in-game moments (modules/score-events.js).
//
// These are the rules that decide whether a manager's phone buzzes, and every
// one of them fails silently in production: a bad edge either spams a lock
// screen all Saturday or says nothing at all, and neither shows up in a log.

const {
    detectEvents, parseClockSeconds, leaderOf, inCloseWindow
} = require('../modules/score-events');

const live = (home, away, period, clock) => ({
    homePoints: home, awayPoints: away, period, clock, completed: false
});

describe('parseClockSeconds', () => {
    it('parses a display clock', () => {
        expect(parseClockSeconds('12:34')).toBe(754);
        expect(parseClockSeconds('0:09')).toBe(9);
        expect(parseClockSeconds('15:00')).toBe(900);
    });

    // CFBD withholds the clock between periods. Reading that as 0:00 would fire
    // crunch-time at every halftime of every close game.
    it('returns null rather than zero for a missing or malformed clock', () => {
        expect(parseClockSeconds(null)).toBeNull();
        expect(parseClockSeconds(undefined)).toBeNull();
        expect(parseClockSeconds('')).toBeNull();
        expect(parseClockSeconds('halftime')).toBeNull();
        expect(parseClockSeconds('1:99')).toBeNull();
        expect(parseClockSeconds(754)).toBeNull();
    });
});

describe('leaderOf', () => {
    it('names the leading side', () => {
        expect(leaderOf(14, 7)).toBe('home');
        expect(leaderOf(7, 14)).toBe('away');
    });

    // A tie is not a leader. This is what keeps 0-0 out of leadChange.
    it('treats a tie and unknown scores as no leader', () => {
        expect(leaderOf(7, 7)).toBeNull();
        expect(leaderOf(null, 7)).toBeNull();
        expect(leaderOf(7, undefined)).toBeNull();
    });
});

describe('inCloseWindow', () => {
    it('requires the 4th quarter, under 2:00, and one score', () => {
        expect(inCloseWindow(4, 90, 24, 21)).toBe(true);
        expect(inCloseWindow(5, 90, 24, 21)).toBe(true);   // overtime counts
    });

    it('rejects anything outside the window', () => {
        expect(inCloseWindow(3, 90, 24, 21)).toBe(false);   // too early
        expect(inCloseWindow(4, 300, 24, 21)).toBe(false);  // too much time
        expect(inCloseWindow(4, 90, 35, 10)).toBe(false);   // blowout
        expect(inCloseWindow(4, null, 24, 21)).toBe(false); // clock withheld
        expect(inCloseWindow(null, 90, 24, 21)).toBe(false);
        expect(inCloseWindow(4, 90, null, 21)).toBe(false);
    });
});

describe('detectEvents — scoring', () => {
    it('reports the side that scored and by how much', () => {
        const events = detectEvents(live(7, 7, 2, '8:00'), live(14, 7, 2, '7:41'));
        expect(events).toEqual([
            expect.objectContaining({ type: 'score', side: 'home', delta: 7, homePoints: 14, awayPoints: 7 })
        ]);
    });

    it('reports both sides when a tick catches two scores', () => {
        const events = detectEvents(live(7, 7, 2, '8:00'), live(14, 10, 2, '2:00'));
        const types = events.filter(e => e.type === 'score').map(e => e.side);
        expect(types).toEqual(['home', 'away']);
    });

    // CFBD revises scores downward when a touchdown comes off the board on
    // review. Announcing that as a score would be actively wrong.
    it('ignores a score revised downward', () => {
        expect(detectEvents(live(14, 7, 2, '8:00'), live(7, 7, 2, '7:00'))).toEqual([]);
    });

    it('says nothing when nothing changed', () => {
        expect(detectEvents(live(14, 7, 2, '8:00'), live(14, 7, 2, '7:41'))).toEqual([]);
    });

    it('carries the clock so the notification can say when', () => {
        const [event] = detectEvents(live(0, 0, 1, '10:00'), live(7, 0, 1, '9:12'));
        expect(event.period).toBe(1);
        expect(event.clock).toBe('9:12');
    });
});

describe('detectEvents — lead changes', () => {
    it('fires when the lead flips between teams', () => {
        const events = detectEvents(live(14, 10, 3, '5:00'), live(14, 17, 3, '4:12'));
        expect(events.some(e => e.type === 'leadChange' && e.side === 'away')).toBe(true);
    });

    // Taking a lead from a tie is a score, not a lead change. Emitting both
    // would double-notify every opening touchdown of every game.
    it('does not fire when a tied game breaks open', () => {
        const events = detectEvents(live(0, 0, 1, '15:00'), live(7, 0, 1, '12:00'));
        expect(events.some(e => e.type === 'leadChange')).toBe(false);
    });

    it('does not fire when a lead is merely erased into a tie', () => {
        const events = detectEvents(live(14, 7, 2, '5:00'), live(14, 14, 2, '3:00'));
        expect(events.some(e => e.type === 'leadChange')).toBe(false);
    });
});

describe('detectEvents — crunch time', () => {
    it('fires on the transition into the window', () => {
        const events = detectEvents(live(24, 21, 4, '2:30'), live(24, 21, 4, '1:50'));
        expect(events.some(e => e.type === 'closeGame')).toBe(true);
    });

    // The transition edge is the whole dedupe strategy — there is no seen-set.
    // If this regresses, a close 4th quarter notifies every 10 seconds.
    it('does not fire again while the game stays in the window', () => {
        const events = detectEvents(live(24, 21, 4, '1:50'), live(24, 21, 4, '1:20'));
        expect(events.some(e => e.type === 'closeGame')).toBe(false);
    });

    it('fires again if the game leaves the window and re-enters it', () => {
        const blownOpen = detectEvents(live(24, 21, 4, '1:50'), live(31, 21, 4, '1:30'));
        expect(blownOpen.some(e => e.type === 'closeGame')).toBe(false);
        const backOn = detectEvents(live(31, 21, 4, '1:30'), live(31, 24, 4, '1:10'));
        expect(backOn.some(e => e.type === 'closeGame')).toBe(true);
    });
});

describe('detectEvents — guards', () => {
    // A restart mid-slate re-reads every live game with no prior state. Treating
    // that as news would re-announce every score already on the board.
    it('says nothing the first time it sees a game', () => {
        expect(detectEvents(null, live(21, 14, 3, '8:00'))).toEqual([]);
        expect(detectEvents(undefined, live(21, 14, 3, '8:00'))).toEqual([]);
    });

    // CFBD keeps re-sending a finished game's payload. A final is announced from
    // `newlyCompleted` with its banked points, not from here.
    it('says nothing about a completed game', () => {
        const next = Object.assign(live(24, 21, 4, '0:00'), { completed: true });
        expect(detectEvents(live(17, 21, 4, '1:00'), next)).toEqual([]);
    });

    it('says nothing when either score is unknown', () => {
        expect(detectEvents(live(null, 7, 1, '9:00'), live(7, 7, 1, '8:00'))).toEqual([]);
        expect(detectEvents(live(7, 7, 1, '9:00'), live(undefined, 7, 1, '8:00'))).toEqual([]);
    });

    it('says nothing at all about a missing payload', () => {
        expect(detectEvents(live(7, 7, 1, '9:00'), null)).toEqual([]);
    });
});
