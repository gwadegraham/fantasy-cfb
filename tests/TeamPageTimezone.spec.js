/**
 * @jest-environment jsdom
 *
 * The team page's schedule renders game times in the BROWSER's zone, not
 * Central like the rest of the app. That is fine — it is the one page where a
 * local time is what you want — but it has to SAY so, because the league spans
 * two zones and "2:30 PM" means different things to different managers.
 *
 * The label is the generic form (CT, ET) rather than the seasonal one (CDT,
 * CST): a schedule runs August to January, straddling the November DST change,
 * and both halves of it are still "CT".
 */

const fs = require('fs');
const path = require('path');

// team.js only assigns window.onload at the top level, so evaluating it defines
// the helpers without booting the page.
function load() {
    (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'team.js'), 'utf8'));
}

describe('tzGenericLabel', () => {
    beforeEach(load);

    test('collapses a US abbreviation to its year-round form', () => {
        expect(tzGenericLabel('CDT')).toBe('CT');
        expect(tzGenericLabel('CST')).toBe('CT');
        expect(tzGenericLabel('EDT')).toBe('ET');
        expect(tzGenericLabel('EST')).toBe('ET');
        expect(tzGenericLabel('MDT')).toBe('MT');
        expect(tzGenericLabel('PST')).toBe('PT');
    });

    test('handles the longer US abbreviations', () => {
        expect(tzGenericLabel('AKDT')).toBe('AKT');
    });

    test('passes through anything that is not a US abbreviation', () => {
        // A manager abroad, or a browser that reports an offset.
        expect(tzGenericLabel('GMT+2')).toBe('GMT+2');
        expect(tzGenericLabel('UTC')).toBe('UTC');
        expect(tzGenericLabel('GMT')).toBe('GMT');
    });

    test('is empty rather than wrong when there is nothing to report', () => {
        expect(tzGenericLabel('')).toBe('');
        expect(tzGenericLabel(null)).toBe('');
        expect(tzGenericLabel(undefined)).toBe('');
    });
});

describe('localTzLabel', () => {
    beforeEach(load);

    test('reports the environment zone in the generic form', () => {
        // Jest runs under TZ=UTC unless told otherwise; either way the label is
        // a short token and never a seasonal S/D variant.
        const label = localTzLabel();
        expect(typeof label).toBe('string');
        expect(label).not.toMatch(/^[A-Z]{1,3}[SD]T$/);
    });

    test('degrades to no label rather than throwing', () => {
        const real = global.Intl;
        global.Intl = { DateTimeFormat: function () { throw new Error('unavailable'); } };
        try {
            expect(localTzLabel()).toBe('');
        } finally {
            global.Intl = real;
        }
    });
});
