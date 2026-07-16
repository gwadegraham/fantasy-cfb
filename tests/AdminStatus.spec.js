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
