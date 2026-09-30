// modules/hoops-calendar.js — basketball weeks, derived from dates (#315).
//
// CBBD carries no `week` field and has no /calendar endpoint, so every number
// here is computed. The three properties worth defending, each measured against
// the real 5,015-game 2026-27 schedule before the code was written:
//
//   1. Buckets are EASTERN, not UTC. 624 games (12%) fall on a different
//      calendar day in the two zones — every evening tip-off.
//   2. A week is exactly 7 days across a DST change. The NCAA tournament runs
//      past 14 March 2027, when clocks move.
//   3. Sunday closes a week; Monday opens the next. The off-by-one here would
//      put every Sunday game a week early.

const cal = require('../modules/hoops-calendar');

// 2 Nov 2026 is a Monday, and the real season opener.
const FIRST_GAME = new Date('2026-11-02T05:00:00Z');   // midnight ET
const START = cal.seasonStartFrom(FIRST_GAME);

describe('seasonStartFrom', () => {
    test('anchors week 1 on the Monday of the first game', () => {
        expect(START.toISOString().slice(0, 10)).toBe('2026-11-02');
    });

    test('a season opening midweek still starts its week on the Monday', () => {
        // Otherwise week 1 would begin mid-slate and every later boundary would
        // sit on a Thursday.
        const thu = cal.seasonStartFrom(new Date('2026-11-05T23:00:00Z'));
        expect(thu.toISOString().slice(0, 10)).toBe('2026-11-02');
    });

    test('a Sunday opener belongs to the week that is ENDING, not the next', () => {
        // getUTCDay puts Sunday at 0, so a naive Monday-start calculation sends
        // it forward instead of back six days.
        const sun = cal.seasonStartFrom(new Date('2026-11-08T23:00:00Z'));
        expect(sun.toISOString().slice(0, 10)).toBe('2026-11-02');
    });

    test('an unparseable date is null, not an Invalid Date', () => {
        expect(cal.seasonStartFrom('not a date')).toBeNull();
    });
});

describe('weekOf — the boundaries', () => {
    const wk = (iso) => cal.weekOf(new Date(iso), START);

    test.each([
        ['2026-11-02T05:00:00Z', 1, 'Monday, opening night'],
        ['2026-11-08T23:00:00Z', 1, 'Sunday evening still closes week 1'],
        ['2026-11-09T05:00:00Z', 2, 'Monday opens week 2'],
        ['2027-03-07T05:00:00Z', 18, 'the last scheduled regular-season game']
    ])('%s -> week %i (%s)', (iso, expected) => {
        expect(wk(iso)).toBe(expected);
    });

    test('a date before week 1 is null, never 0 or negative', () => {
        // 0 and -1 both read as a real week to a caller indexing an array.
        expect(wk('2026-10-30T23:00:00Z')).toBeNull();
        expect(wk('2020-01-01T00:00:00Z')).toBeNull();
    });

    test('an unparseable date or a missing start is null', () => {
        expect(cal.weekOf('rubbish', START)).toBeNull();
        expect(cal.weekOf(new Date('2026-11-02T05:00:00Z'), null)).toBeNull();
    });
});

describe('weekOf — Eastern, not UTC', () => {
    // The property behind the 12% measurement: an evening tip-off is already
    // tomorrow in UTC, and near a Sunday boundary that is a different WEEK.
    test('a Sunday-evening game stays in the week that is ending', () => {
        // 2026-11-08 22:00 ET is 2026-11-09 03:00 UTC — Monday in UTC, still
        // Sunday in Eastern. UTC bucketing would push it into week 2.
        const sundayNight = new Date('2026-11-09T03:00:00Z');
        expect(sundayNight.toISOString().slice(0, 10)).toBe('2026-11-09');   // Monday in UTC
        expect(cal.weekOf(sundayNight, START)).toBe(1);                      // Sunday in ET
    });

    test('and a Monday-evening game is in the week that just opened', () => {
        const mondayNight = new Date('2026-11-10T03:00:00Z');   // Mon 9th, 22:00 ET
        expect(cal.weekOf(mondayNight, START)).toBe(2);
    });
});

describe('weekOf — a week is 7 days across a DST change', () => {
    // Clocks go forward on 14 March 2027, in the middle of the NCAA tournament.
    // Doing the arithmetic on raw timestamps would make that week 167 hours and
    // shift every week after it.
    test.each([
        ['2027-03-12T23:00:00Z', 19, 'Friday before the change'],
        ['2027-03-14T23:00:00Z', 19, 'Sunday, the change itself'],
        ['2027-03-15T23:00:00Z', 20, 'Monday after'],
        ['2027-03-21T22:00:00Z', 20, 'the following Sunday'],
        ['2027-04-05T23:00:00Z', 23, 'the national final']
    ])('%s -> week %i (%s)', (iso, expected) => {
        expect(cal.weekOf(new Date(iso), START)).toBe(expected);
    });

    test('a week is 7 Eastern DAYS, which is not always 168 hours', () => {
        // The original version of this test asserted "exactly 7 days, DST or
        // not" and passed only because easternMidnight was an hour late during
        // EDT. A Monday-to-Monday Eastern week that spans spring-forward is
        // genuinely 167 real hours. The test was written to the implementation
        // rather than to the property; this is the property.
        const hours = (w) => {
            const b = cal.weekBounds(w, START);
            return (b.end - b.start) / 3600000;
        };
        expect(hours(18)).toBe(168);
        expect(hours(19)).toBe(167);   // clocks go forward 14 March 2027
        expect(hours(20)).toBe(168);
    });

    test('and every bound really is the FIRST instant of an Eastern day', () => {
        // The bug this guards: the offset search validated the DAY and not the
        // HOUR, so +5h during EDT landed at 01:00 on the right day and passed.
        //
        // Asserted structurally rather than by formatting the clock. The first
        // version compared toLocaleTimeString to '00:00:00' and failed on CI
        // but not locally, because Node 20's ICU spells midnight '24:00:00'
        // and Node 26's spells it '00:00:00'. easternMidnight already handles
        // both — the test did not, which is the module being more careful than
        // its own test.
        //
        // "First instant of a day" needs no clock formatting: the bound is on
        // one Eastern day and the millisecond before it is on the previous one.
        const day = (d) => cal.easternDay(d).toISOString().slice(0, 10);
        for (let w = 1; w <= 26; w++) {
            const b = cal.weekBounds(w, START);
            for (const edge of [b.start, b.end]) {
                expect(day(new Date(edge.getTime() - 1))).not.toBe(day(edge));
                expect(day(new Date(edge.getTime() + 1))).toBe(day(edge));
            }
        }
    });

    test('weekOf and weekBounds agree at every boundary, all season', () => {
        // The invariant the two halves of this module have to share, and the
        // one that would have caught the DST bug on its own: a game at the
        // first instant of week N must be in week N, and one a millisecond
        // before the end must still be.
        for (let w = 1; w <= 26; w++) {
            const b = cal.weekBounds(w, START);
            expect(cal.weekOf(b.start, START)).toBe(w);
            expect(cal.weekOf(new Date(b.end.getTime() - 1), START)).toBe(w);
            expect(cal.weekOf(b.end, START)).toBe(w + 1);
        }
    });
});

describe('weekBounds', () => {
    test('week 1 runs Monday to the following Monday, exclusive', () => {
        const b = cal.weekBounds(1, START);
        expect(b.start.toISOString().slice(0, 10)).toBe('2026-11-02');
        expect(b.end.toISOString().slice(0, 10)).toBe('2026-11-09');
    });

    test('bounds and weekOf agree at both edges', () => {
        // The last instant inside week 3 and the first inside week 4.
        const b = cal.weekBounds(3, START);
        expect(cal.weekOf(b.start, START)).toBe(3);
        expect(cal.weekOf(new Date(b.end.getTime() - 1), START)).toBe(3);
        expect(cal.weekOf(b.end, START)).toBe(4);
    });

    test('a nonsense week is null, not a range', () => {
        expect(cal.weekBounds(0, START)).toBeNull();
        expect(cal.weekBounds(-1, START)).toBeNull();
        expect(cal.weekBounds(1.5, START)).toBeNull();
        expect(cal.weekBounds(1, null)).toBeNull();
    });
});

describe('resolveCurrentWeek', () => {
    const LAST = new Date('2027-03-07T05:00:00Z');   // week 18

    test('answers the week we are in', () => {
        expect(cal.resolveCurrentWeek({
            seasonStart: START, lastGameDate: LAST, now: new Date('2026-11-11T18:00:00Z')
        })).toEqual({ week: 2, seasonType: 'regular' });
    });

    test('refuses before the season rather than answering week 1', () => {
        // A wrong week silently scores the wrong slate; a skip is recoverable.
        expect(cal.resolveCurrentWeek({
            seasonStart: START, lastGameDate: LAST, now: new Date('2026-10-20T18:00:00Z')
        })).toEqual({ skip: 'preseason — the first week has not started' });
    });

    test('the final week stays open while it is still running', () => {
        // Last game is Sunday 7 March, in week 18. Saturday the 6th is still
        // inside that week and still needs scoring.
        expect(cal.resolveCurrentWeek({
            seasonStart: START, lastGameDate: LAST, now: new Date('2027-03-06T18:00:00Z')
        })).toMatchObject({ week: 18 });
    });

    test('and closes once that week has ended', () => {
        expect(cal.resolveCurrentWeek({
            seasonStart: START, lastGameDate: LAST, now: new Date('2027-03-10T18:00:00Z')
        })).toEqual({ skip: 'season over — the last scheduled week has closed' });
    });

    test('but ingesting the postseason extends the season on its own', () => {
        // lastGameDate is the last game WE KNOW OF, so no second date has to be
        // configured when the bracket is published.
        expect(cal.resolveCurrentWeek({
            seasonStart: START,
            lastGameDate: new Date('2027-04-05T23:00:00Z'),
            now: new Date('2027-03-10T18:00:00Z')
        })).toMatchObject({ week: 19 });
    });

    test('refuses when nothing has been ingested', () => {
        expect(cal.resolveCurrentWeek({ seasonStart: null }).skip).toMatch(/refusing to guess/);
    });

    test('carries the seasonType through', () => {
        expect(cal.resolveCurrentWeek({
            seasonStart: START, now: new Date('2027-03-20T18:00:00Z'), seasonType: 'postseason'
        })).toMatchObject({ seasonType: 'postseason' });
    });
});
