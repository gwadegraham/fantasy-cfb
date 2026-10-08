// Stale copies of rescheduled games (#498): CBBD keeps a moved game's old
// listing under its own id. Once the listing is well past its date, unplayed,
// and the same matchup has gone final, it is hidden — never a real rematch.

const { supersededBy, dropStale, overdue, GRACE_MS } = require('../modules/hoops-stale-duplicates');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 14);
const g = (id, o = {}) => Object.assign({ id, homeTeamId: 1, awayTeamId: 2, neutralSite: false,
    status: 'final', homePoints: 70, awayPoints: 60, startDate: new Date(T0) }, o);
const old = (id, o = {}) => g(id, Object.assign({ status: 'scheduled', homePoints: null, awayPoints: null,
    startDate: new Date(T0 + DAY) }, o));
const NOW = T0 + DAY + GRACE_MS + 1;

test('an unplayed listing past the grace window, with the same matchup final, is replaced', () => {
    const played = g(1), copy = old(2);
    expect(supersededBy(copy, [played, copy], NOW)).toBe(played);
    expect(dropStale([played, copy], NOW)).toEqual([played]);
});

test('inside the grace window it is still shown — the game may just be late in', () => {
    const copy = old(2);
    expect(supersededBy(copy, [g(1), copy], T0 + DAY + GRACE_MS - 1)).toBeNull();
});

test('a real rematch is never hidden: both are played', () => {
    const list = [g(1), g(2, { startDate: new Date(T0 + 30 * DAY) })];
    expect(dropStale(list, NOW + 60 * DAY)).toEqual(list);
});

test('a final game is never stale, even with an older twin', () => {
    expect(overdue(g(2), NOW)).toBe(false);
});

test('the reverse fixture (other venue) or a neutral site is a different game', () => {
    const copy = old(2);
    expect(supersededBy(copy, [g(1, { homeTeamId: 2, awayTeamId: 1 }), copy], NOW)).toBeNull();
    expect(supersededBy(copy, [g(1, { neutralSite: true }), copy], NOW)).toBeNull();
});

test('no played twin: an overdue listing stays (nothing to point at)', () => {
    const copy = old(2);
    expect(dropStale([copy, old(3, { homeTeamId: 5 })], NOW)).toHaveLength(2);
});
