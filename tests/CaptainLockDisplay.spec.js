/**
 * @jest-environment jsdom
 *
 * How the Captain tile states the lock (public/userHome.js).
 *
 * The captain locks at the manager's OWN earliest kickoff. API week 1 folds in
 * the opening weekend, so a manager holding one team that plays a week early
 * gets locked a week before the rest of their roster plays — and every tile in
 * the picker read the same bare "Sat 2:30 PM", so there was no way to see which
 * game closed the pick. A real roster had NC State on Aug 29 and Texas on Sep 5,
 * both rendering as "Sat 2:30 PM", with the note quoting that string directly
 * above a grid whose FIRST tile was Texas.
 *
 * So the times gain a date when the week straddles more than one weekend (the
 * rule the matchup card already uses), and the note names the team that closes
 * the pick instead of leaving "your first team" to be inferred.
 */

const fs = require('fs');
const path = require('path');

// userHome.js runs a little jQuery at the top level; the page itself only boots
// from window.onload, which jsdom has already fired past.
function load() {
    const node = new Proxy(function () { return node; }, {
        get(t, k) { return k === 'length' ? 0 : node; },
        apply() { return node; }
    });
    global.$ = window.$ = function () { return node; };
    (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'public', 'userHome.js'), 'utf8'));
}

// NC State @ Virginia — Sat Aug 29, 2:30 PM Central. The lock.
const NCSTATE = '2026-08-29T19:30:00.000Z';
// Texas vs Texas State — Sat Sep 5, 2:30 PM Central. Same clock, a week later.
const TEXAS = '2026-09-05T19:30:00.000Z';

describe('uhFmtLock', () => {
    beforeEach(load);

    test('is bare weekday + time by default', () => {
        expect(uhFmtLock(TEXAS)).toBe('Sat 2:30 PM');
    });

    test('names the zone when asked', () => {
        expect(uhFmtLock(TEXAS, { tz: true })).toBe('Sat 2:30 PM CT');
    });

    test('dates the time when asked — the whole point of this fix', () => {
        // Without the date these two are indistinguishable, though they are a
        // week apart.
        expect(uhFmtLock(NCSTATE)).toBe(uhFmtLock(TEXAS));
        expect(uhFmtLock(NCSTATE, { dated: true })).toBe('Sat, 8/29 2:30 PM');
        expect(uhFmtLock(TEXAS, { dated: true })).toBe('Sat, 9/5 2:30 PM');
        expect(uhFmtLock(NCSTATE, { dated: true })).not.toBe(uhFmtLock(TEXAS, { dated: true }));
    });

    test('combines date and zone', () => {
        expect(uhFmtLock(NCSTATE, { dated: true, tz: true })).toBe('Sat, 8/29 2:30 PM CT');
    });

    test('renders Central regardless of the machine running it', () => {
        // Stored as 19:30 UTC; Central is what a manager should read.
        expect(uhFmtLock(NCSTATE)).toContain('2:30 PM');
    });

    test('is empty for a missing time rather than "Invalid Date"', () => {
        expect(uhFmtLock(null)).toBe('');
        expect(uhFmtLock('')).toBe('');
    });
});

describe('uhRankTag', () => {
    beforeEach(load);

    // Tiered the way rankValue tiers the bonus: a top-10 win pays double.
    test('marks a ranked opponent and flags the top ten', () => {
        expect(uhRankTag(23)).toBe('<span class="cap-rk">#23</span> ');
        expect(uhRankTag(10)).toBe('<span class="cap-rk top10">#10</span> ');
        expect(uhRankTag(1)).toBe('<span class="cap-rk top10">#1</span> ');
    });

    test('is nothing at all for an unranked opponent', () => {
        expect(uhRankTag(null)).toBe('');
        expect(uhRankTag(undefined)).toBe('');
        expect(uhRankTag(0)).toBe('');
    });
});

describe('uhAndList', () => {
    beforeEach(load);

    test('names one, two, or several teams', () => {
        expect(uhAndList(['NC State'])).toBe('NC State');
        expect(uhAndList(['NC State', 'LSU'])).toBe('NC State and LSU');
        expect(uhAndList(['NC State', 'LSU', 'Duke'])).toBe('NC State, LSU and Duke');
    });

    test('is empty when there is nobody to name', () => {
        expect(uhAndList([])).toBe('');
        expect(uhAndList(null)).toBe('');
        // A roster can hold both sides of one game (LSU vs Clemson), so blanks
        // are filtered rather than rendered as "and undefined".
        expect(uhAndList(['LSU', null, undefined])).toBe('LSU');
    });
});
