const { postseasonWeeksToScore } = require('../modules/score-update');

// --- pipeline ordering -------------------------------------------------------
// The H2H win bonus is folded into weeklyScore[].score, and updateCumulativeScores
// then SUMS those scores into cumulativeScore. So applyH2HBonuses must run after
// updateScores (a week's result needs every manager's total) and before
// updateCumulativeScores. Reorder these and the bonus silently stops reaching the
// season total of record — exactly the bug this replaced. Hence the assertion.

jest.mock('../modules/cfbd-calendar', () => ({ getCalendar: jest.fn(async () => null) }));
jest.mock('../modules/internal-api', () => ({
    internalFetch: jest.fn(async () => ({ status: 200, json: async () => ({}) }))
}));
jest.mock('../modules/retrieve-games.js', () => ({
    retrieveTeams: jest.fn(async () => []),
    massRetrieveGames: jest.fn(async () => ({ newGames: [], existingGames: [], remainingCalls: 900 }))
}));
jest.mock('../modules/team-scoring.js', () => ({ updateAllTeamScores: jest.fn(async () => {}) }));
jest.mock('../modules/records.js', () => ({ updateAllTeamRecords: jest.fn(async () => {}) }));
jest.mock('../modules/betting.js', () => ({ updateAllBettingLines: jest.fn(async () => {}) }));
jest.mock('../modules/scoring.js', () => {
    const calls = [];
    return {
        _calls: calls,
        updateScores: jest.fn(async () => { calls.push('updateScores'); }),
        applyH2HBonuses: jest.fn(async () => { calls.push('applyH2HBonuses'); }),
        updateCumulativeScores: jest.fn(async () => { calls.push('updateCumulativeScores'); })
    };
});

describe('runFullUpdate scoring order', () => {
    const { runFullUpdate } = require('../modules/score-update');
    const scoringModule = require('../modules/scoring.js');
    const retrieveGames = require('../modules/retrieve-games.js');

    beforeEach(() => {
        scoringModule._calls.length = 0;
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { jest.restoreAllMocks(); });

    it('applies H2H bonuses between weekly scoring and cumulative totals (regular season)', async () => {
        await runFullUpdate({ withBetting: false });
        expect(scoringModule._calls).toEqual(['updateScores', 'applyH2HBonuses', 'updateCumulativeScores']);
    });

    it('also applies them on a postseason run, before cumulative totals', async () => {
        retrieveGames.massRetrieveGames.mockResolvedValueOnce({
            newGames: [{ week: 1 }], existingGames: [], remainingCalls: 900
        });
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce([
            { week: 1, seasonType: 'postseason', firstGameStart: '2000-01-01', lastGameStart: '2100-01-01' }
        ]);
        await runFullUpdate({ withBetting: false });
        const calls = scoringModule._calls;
        expect(calls.indexOf('applyH2HBonuses')).toBeGreaterThan(calls.indexOf('updateScores'));
        expect(calls.indexOf('applyH2HBonuses')).toBeLessThan(calls.indexOf('updateCumulativeScores'));
    });
});

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
