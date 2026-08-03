const { postseasonWeeksToScore } = require('../modules/score-update');

describe('postseasonWeeksToScore', () => {
    const g = (week) => ({ week });

    it('returns the distinct weeks present, ascending', () => {
        const result = { newGames: [g(1), g(2)], existingGames: [g(2), g(3)] };
        expect(postseasonWeeksToScore(result)).toEqual([1, 2, 3]);
    });

    it('covers a multi-week 12-team CFP (first round → championship)', () => {
        // e.g. first round wk1, quarters wk2, semis wk3, final wk4
        const result = { newGames: [g(4), g(1)], existingGames: [g(3), g(2), g(1)] };
        expect(postseasonWeeksToScore(result)).toEqual([1, 2, 3, 4]);
    });

    it('falls back to [1] when no games/weeks are present', () => {
        expect(postseasonWeeksToScore({ newGames: [], existingGames: [] })).toEqual([1]);
        expect(postseasonWeeksToScore({})).toEqual([1]);
        expect(postseasonWeeksToScore(null)).toEqual([1]);
    });

    it('ignores games with a missing week', () => {
        const result = { newGames: [g(1), { }], existingGames: [g(null)] };
        expect(postseasonWeeksToScore(result)).toEqual([1]);
    });
});
