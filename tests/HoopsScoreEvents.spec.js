// Basketball push-alert detection (modules/hoops-score-events.js, #557):
// tip-off and crunch time, from a stored game row and the change a poll is
// about to write. Pure, so every threshold edge is pinned here with fixtures.
//
// Crunch time: 2nd half or overtime, <= 4:00 on the clock, within 5 points.

const ev = require('../modules/hoops-score-events');

const live = (o = {}) => Object.assign({ status: 'in_progress', period: 2, clock: '8:00', homePoints: 60, awayPoints: 58 }, o);
const types = (prev, next) => ev.detectHoopsEvents(prev, next).map(e => e.type);

describe('the thresholds are the ones decided on #557', () => {
    test('2nd half, 4:00, 5 points', () => {
        expect([ev.CLOSE_PERIOD, ev.CLOSE_CLOCK_SECONDS, ev.CLOSE_MARGIN]).toEqual([2, 240, 5]);
    });
});

describe('parseClockSeconds', () => {
    test.each([
        ['4:00', 240], ['04:00', 240], ['4:01', 241], ['0:45', 45], ['0:45.3', 45],
        ['45.3', 45.3], ['9', 9], ['PT04M00.00S', 240], ['PT00M12.5S', 12.5], ['PT7.2S', 7.2]
    ])('%s is %s seconds', (clock, secs) => {
        expect(ev.parseClockSeconds(clock)).toBeCloseTo(secs);
    });

    test.each([[null], [undefined], [''], ['halftime'], ['4:60'], ['-1:00']])('%p is unreadable, not 0:00', (clock) => {
        expect(ev.parseClockSeconds(clock)).toBeNull();
    });
});

describe('crunch time: each edge of the window', () => {
    const into = (o) => types(live(), live(o));

    test('4:00 is in, 4:01 is out', () => {
        expect(into({ clock: '4:00', homePoints: 60, awayPoints: 58 })).toEqual(['closeGame']);
        expect(into({ clock: '4:01', homePoints: 60, awayPoints: 58 })).toEqual([]);
    });

    test('a 5-point game is in, 6 is out — either side ahead', () => {
        expect(into({ clock: '3:00', homePoints: 65, awayPoints: 60 })).toEqual(['closeGame']);
        expect(into({ clock: '3:00', homePoints: 60, awayPoints: 65 })).toEqual(['closeGame']);
        expect(into({ clock: '3:00', homePoints: 66, awayPoints: 60 })).toEqual([]);
        expect(into({ clock: '3:00', homePoints: 60, awayPoints: 66 })).toEqual([]);
    });

    test('a tie is close', () => {
        expect(into({ clock: '1:00', homePoints: 60, awayPoints: 60 })).toEqual(['closeGame']);
    });

    test('the first half is never crunch time, 2nd half and overtime are', () => {
        expect(types(live({ period: 1 }), live({ period: 1, clock: '1:00' }))).toEqual([]);
        expect(types(live({ period: 3, clock: '5:00' }), live({ period: 3, clock: '3:59' }))).toEqual(['closeGame']);
    });

    test('a clock CBBD withholds (halftime, a break) is not 0:00', () => {
        expect(into({ clock: null })).toEqual([]);
    });

    test('the final minute in tenths still counts', () => {
        expect(into({ clock: '38.2' })).toEqual(['closeGame']);
    });
});

describe('crunch time fires on the transition, not every tick', () => {
    test('already inside the window last tick: nothing', () => {
        expect(types(live({ clock: '3:30' }), live({ clock: '3:00' }))).toEqual([]);
    });

    test('entering by the margin closing, not the clock', () => {
        expect(types(live({ clock: '2:00', homePoints: 70, awayPoints: 60 }),
            live({ clock: '1:40', homePoints: 70, awayPoints: 65 }))).toEqual(['closeGame']);
    });

    test('entering from halftime (no clock) into a close 2nd half under 4:00 fires once', () => {
        expect(types(live({ period: 2, clock: null }), live({ period: 2, clock: '3:50' }))).toEqual(['closeGame']);
    });

    // A game whose prior state was not in progress (the poller was down) and is
    // now inside the window: it is new to us, so it fires.
    test('a game first seen live inside the window fires crunch time but not tip-off', () => {
        expect(types({ status: 'scheduled', homePoints: 0, awayPoints: 0 }, live({ clock: '2:00' }))).toEqual(['closeGame']);
    });
});

describe('tip-off', () => {
    test('scheduled → in progress in the 1st half', () => {
        expect(types({ status: 'scheduled', homePoints: 0, awayPoints: 0 },
            live({ period: 1, clock: '19:40', homePoints: 2, awayPoints: 0 }))).toEqual(['tipoff']);
    });

    test('a period not yet reported still counts', () => {
        expect(types({ status: 'scheduled' }, { status: 'in_progress', homePoints: 0, awayPoints: 0 })).toEqual(['tipoff']);
    });

    test('first seen in the 2nd half is not a tip-off', () => {
        expect(types({ status: 'scheduled' }, live({ period: 2, clock: '15:00' }))).toEqual([]);
    });

    test('already in progress: nothing', () => {
        expect(types(live({ period: 1, clock: '19:00' }), live({ period: 1, clock: '18:30' }))).toEqual([]);
    });

    test('carries the score, half and clock for the text', () => {
        expect(ev.detectHoopsEvents({ status: 'scheduled' }, live({ period: 1, clock: '19:40', homePoints: 2, awayPoints: 0 })))
            .toEqual([{ type: 'tipoff', homePoints: 2, awayPoints: 0, period: 1, clock: '19:40' }]);
    });
});

describe('no events', () => {
    test('for a game never stored', () => {
        expect(types(null, live({ clock: '1:00' }))).toEqual([]);
    });

    test('for a final — that is its own alert', () => {
        expect(types(live({ clock: '0:10' }), live({ status: 'final', clock: '0:00' }))).toEqual([]);
    });

    test('for a scheduled, postponed or cancelled game', () => {
        for (const status of ['scheduled', 'postponed', 'cancelled']) {
            expect(types({ status: 'scheduled' }, { status, period: 2, clock: '1:00', homePoints: 1, awayPoints: 1 })).toEqual([]);
        }
    });

    test('points unknown', () => {
        expect(types(live(), live({ clock: '1:00', homePoints: null }))).toEqual([]);
    });
});
