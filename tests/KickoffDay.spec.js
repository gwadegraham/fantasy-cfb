// public/kickoff-day.js — what day a game is on.
//
// Written after Miami's October schedule advertised four Saturday games as
// Friday games on every surface in the app. None of them had a kickoff time
// yet, and CFBD sends midnight EASTERN as the placeholder for those, so read in
// Central the instant is 11:00 PM the night before.
//
// The TZ juggling here is the point of the file: the old code was correct for a
// viewer in Eastern and wrong for everyone else, which is exactly the kind of
// bug a suite running in one zone never sees.

const kickoff = require('../public/kickoff-day.js');

// The suite runs in Central (tests/helpers/global-setup.js), which is the zone
// the bug showed up in and the league's own zone. The TBD assertions below do
// not depend on that — a TBD kickoff is read in Eastern whatever zone the
// viewer is in — but the firm-kickoff ones do, deliberately: those must keep
// following the viewer.

// Miami @ Clemson, week 5 of 2026: no kickoff announced, so CFBD stores
// midnight EDT. It is a Saturday game.
const TBD_EDT = '2026-10-03T04:00:00.000Z';
// Boston College @ Miami, week 13: also TBD, but now past the DST change, so
// the same placeholder is 05:00Z. Central is UTC-6 by then, so this one reads
// wrong too — the DST change moves the placeholder and the zone together.
const TBD_EST = '2026-11-28T05:00:00.000Z';
// Miami @ Wake Forest, week 3: a real, announced Friday night kickoff.
const FIRM_FRIDAY = '2026-09-18T23:30:00.000Z';

describe('a TBD kickoff', () => {
    it('is Saturday, where the viewer\'s zone made it Friday', () => {
        expect(kickoff.dayAbbr(TBD_EDT, true)).toBe('SAT');
        expect(kickoff.monthDay(TBD_EDT, true)).toBe('10/3');
        // What every renderer in the app used to do with the same instant.
        expect(new Date(TBD_EDT).getDay()).toBe(5);
    });

    it('is Saturday after the DST change, when the placeholder shifts an hour', () => {
        expect(kickoff.dayAbbr(TBD_EST, true)).toBe('SAT');
        expect(kickoff.monthDay(TBD_EST, true)).toBe('11/28');
        // Still Friday to the old renderer: EST moves the placeholder to 05:00Z
        // and the viewer to UTC-6 at the same time, so nothing is cancelled out.
        expect(new Date(TBD_EST).getDay()).toBe(5);
    });

    it('is the Eastern calendar date, not the local one', () => {
        // Re-derived independently of the helper, and of the ambient zone.
        const eastern = new Date(TBD_EDT).toLocaleDateString('en-US', {
            timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
        });
        expect(eastern).toContain('Saturday');
        expect(kickoff.longDate(TBD_EDT, true)).toBe('Saturday, October 3, 2026');
    });

    it('says TBD instead of dressing the placeholder up as a kickoff', () => {
        expect(kickoff.time(TBD_EDT, true)).toBe('TBD');
        expect(kickoff.time(TBD_EDT, true, 'spaced')).toBe('TBD');
        expect(kickoff.time(TBD_EDT, true, 'terse')).toBe('TBD');
    });

    it('groups under the Saturday heading, not one of its own', () => {
        expect(kickoff.dayKey(TBD_EDT, true)).toBe('Saturday, Oct 3');
    });
});

describe('a real kickoff', () => {
    // The whole point of keeping two paths: an announced time IS an instant,
    // and the team page labels it with the viewer's zone (TeamPageTimezone.spec).
    // Formatting those in Eastern would break every viewer who is not there.
    it('stays in the viewer\'s zone', () => {
        expect(kickoff.dayAbbr(FIRM_FRIDAY, false)).toBe('FRI');
        expect(kickoff.monthDay(FIRM_FRIDAY, false)).toBe('9/18');
        expect(kickoff.time(FIRM_FRIDAY, false)).toBe('6:30PM');
    });

    it('is genuinely Friday when CFBD says so — not every Friday was the bug', () => {
        // 7:30 ET. Miami really does open ACC play on a Friday night, and the
        // fix must not move it to Saturday along with the placeholders.
        expect(kickoff.dayKey(FIRM_FRIDAY, false)).toBe('Friday, Sep 18');
    });

    it('renders each surface\'s time shape', () => {
        expect(kickoff.time(FIRM_FRIDAY, false, 'spaced')).toBe('6:30 PM');
        expect(kickoff.time(FIRM_FRIDAY, false, 'terse')).toBe('6:30p');
        // The picker drops ":00" on the hour, as it always has.
        expect(kickoff.time('2026-11-08T00:00:00.000Z', false, 'terse')).toBe('6p');
    });

    it('handles noon and midnight without an hour-0 hole', () => {
        // The hand-rolled formatters each special-cased hour 0 and hour 12, and
        // betting.js was the only one that got 12:00 AM right.
        expect(kickoff.time('2026-10-03T17:00:00.000Z', false)).toBe('12:00PM');
        expect(kickoff.time('2026-10-03T05:00:00.000Z', false)).toBe('12:00AM');
    });
});

describe('nothing usable', () => {
    it('is empty rather than "Invalid Date"', () => {
        expect(kickoff.parts(null, false)).toBeNull();
        expect(kickoff.parts('not a date', false)).toBeNull();
        expect(kickoff.dayAbbr(undefined, false)).toBe('');
        expect(kickoff.monthDay('', true)).toBe('');
        expect(kickoff.time(null, true)).toBe('');
        expect(kickoff.longDate(null, false)).toBe('');
    });

    it('still gives the scoreboard a heading to group under', () => {
        expect(kickoff.dayKey(null, false)).toBe('TBD');
    });
});
