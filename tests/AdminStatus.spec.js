const { computeAdminStatus } = require('../modules/admin-status');

// One user who drafted team 1, scored through regular week 2.
function user(weeklyScore) {
    return { seasons: [{ season: '2025', teams: [{ id: 1 }], weeklyScore }] };
}
function scored(week, gameId, season) {
    return { week, season, scoreByTeam: [{ teamId: 1, gameId, score: 2 }] };
}
function game(id, week, opts = {}) {
    return Object.assign({
        id, season: 2025, week, seasonType: 'regular', completed: true,
        homeId: 1, awayId: 99, homePoints: 30, awayPoints: 20
    }, opts);
}

describe('computeAdminStatus', () => {
    it('reports up to date when every completed drafted-team game is scored', () => {
        const users = [user([scored(1, 100), scored(2, 101)])];
        const games = [game(100, 1), game(101, 2)];
        const s = computeAdminStatus(users, games, '2025');
        expect(s).toMatchObject({ scoredThroughWeek: 2, gamesLoadedThroughWeek: 2, unscoredResults: 0, upToDate: true });
    });

    it('flags a completed drafted-team game that has not been scored', () => {
        const users = [user([scored(1, 100), scored(2, 101)])];
        const games = [game(100, 1), game(101, 2), game(102, 3)]; // wk3 result, not scored
        const s = computeAdminStatus(users, games, '2025');
        expect(s.gamesLoadedThroughWeek).toBe(3);
        expect(s.scoredThroughWeek).toBe(2);
        expect(s.unscoredResults).toBe(1);
        expect(s.upToDate).toBe(false);
    });

    it('ignores games that do not involve a drafted team', () => {
        const users = [user([scored(1, 100)])];
        const games = [game(100, 1), game(200, 2, { homeId: 998, awayId: 999 })];
        const s = computeAdminStatus(users, games, '2025');
        expect(s.unscoredResults).toBe(0);
        expect(s.upToDate).toBe(true);
    });

    it('ignores incomplete or unscored games', () => {
        const users = [user([scored(1, 100)])];
        const games = [
            game(100, 1),
            game(300, 4, { completed: false }),           // not final
            game(301, 4, { homePoints: null, awayPoints: null }) // final flag but no score
        ];
        const s = computeAdminStatus(users, games, '2025');
        expect(s.gamesLoadedThroughWeek).toBe(1);
        expect(s.unscoredResults).toBe(0);
        expect(s.upToDate).toBe(true);
    });

    it('does not let postseason entries raise the regular scored-through week', () => {
        const users = [user([scored(1, 100), scored(1, 500, 'postseason')])];
        const games = [game(100, 1)];
        const s = computeAdminStatus(users, games, '2025');
        expect(s.scoredThroughWeek).toBe(1);
    });

    it('handles empty inputs without throwing', () => {
        expect(computeAdminStatus([], [], '2025')).toMatchObject({
            scoredThroughWeek: 0, gamesLoadedThroughWeek: 0, unscoredResults: 0, upToDate: true, season: '2025'
        });
    });
});

// --- pendingRegularWeek ------------------------------------------------------
//
// The postseason pipeline uses this to catch the trailing regular week, because
// CFBD's postseason calendar window opens BEFORE the regular season's last game
// kicks off (2026: week-15 window closes 2026-12-12T07:59Z, Army–Navy kicks off
// 20:00Z the same day). It has to answer null as soon as that week is final, or
// the extra CFBD pull it triggers never stops.
describe('pendingRegularWeek', () => {
    const { pendingRegularWeek } = require('../modules/admin-status');
    const NOW = Date.parse('2026-12-13T05:00:00.000Z');   // the nightly job after Army–Navy
    const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

    // Team 1 and 2 are drafted; 99 is not.
    const managers = [{ seasons: [{ season: 2026, teams: [{ id: 1 }, { id: 2 }] }] }];
    const g = (week, opts = {}) => Object.assign({
        week, seasonType: 'regular', completed: false,
        startDate: hoursAgo(9), homeId: 1, awayId: 50
    }, opts);

    it('reports the trailing week when its game kicked off and is not final', () => {
        expect(pendingRegularWeek(managers, [g(15)], 2026, NOW, 48)).toBe(15);
    });

    it('answers null once that game is complete', () => {
        expect(pendingRegularWeek(managers, [g(15, { completed: true })], 2026, NOW, 48)).toBeNull();
    });

    it('takes the highest outstanding week', () => {
        expect(pendingRegularWeek(managers, [g(13), g(15), g(14)], 2026, NOW, 48)).toBe(15);
    });

    it('ignores games that have not kicked off yet', () => {
        expect(pendingRegularWeek(managers, [g(15, { startDate: hoursAgo(-3) })], 2026, NOW, 48)).toBeNull();
    });

    // Both bounds on the extra CFBD pull this triggers.
    it('ignores a game stuck un-complete past the window', () => {
        expect(pendingRegularWeek(managers, [g(15, { startDate: hoursAgo(72) })], 2026, NOW, 48)).toBeNull();
    });

    it('ignores games involving no drafted team', () => {
        // The Game collection still holds non-FBS rows from older ingests; one of
        // those left un-completed would otherwise pin a week open for good.
        expect(pendingRegularWeek(managers, [g(15, { homeId: 98, awayId: 99 })], 2026, NOW, 48)).toBeNull();
    });

    it('ignores postseason games and rows with no usable week or kickoff', () => {
        expect(pendingRegularWeek(managers, [g(15, { seasonType: 'postseason' })], 2026, NOW, 48)).toBeNull();
        expect(pendingRegularWeek(managers, [g(null)], 2026, NOW, 48)).toBeNull();
        expect(pendingRegularWeek(managers, [g(15, { startDate: 'nope' })], 2026, NOW, 48)).toBeNull();
    });

    it('matches the drafted team on either side of the game', () => {
        expect(pendingRegularWeek(managers, [g(15, { homeId: 60, awayId: 2 })], 2026, NOW, 48)).toBe(15);
    });

    it('handles empty inputs and an undrafted season without throwing', () => {
        expect(pendingRegularWeek([], [g(15)], 2026, NOW, 48)).toBeNull();
        expect(pendingRegularWeek(managers, [], 2026, NOW, 48)).toBeNull();
        expect(pendingRegularWeek(null, null, 2026, NOW, 48)).toBeNull();
        expect(pendingRegularWeek([{ seasons: [{ season: 2025, teams: [{ id: 1 }] }] }], [g(15)], 2026, NOW, 48)).toBeNull();
    });

    it('defaults the window when none is given', () => {
        expect(pendingRegularWeek(managers, [g(15)], 2026, NOW)).toBe(15);
    });
});
