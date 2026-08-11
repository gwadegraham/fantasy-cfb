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

// The bracket is what tells scoring which round a postseason game is, so the
// refresh has to land before updateScores. It's also one CFBD call against a
// 1,000/month budget, so it must not fire outside the postseason — and it must
// never abort a scoring run, because "no bracket yet" is the normal state for
// most of the window (the bracket doesn't exist until selection day).
describe('CFP bracket refresh', () => {
    const { runFullUpdate, refreshCfpBracket } = require('../modules/score-update');
    const scoringModule = require('../modules/scoring.js');
    const retrieveGames = require('../modules/retrieve-games.js');
    const { internalFetch } = require('../modules/internal-api');

    const isRefresh = (url) => String(url).includes('/playoffs/cfp/');
    // Records the refresh alongside the scoring steps so ordering is assertable.
    function trackRefresh({ status = 201, body = { games: 11, status: 'completed' } } = {}) {
        internalFetch.mockImplementation(async (url) => {
            if (isRefresh(url)) {
                scoringModule._calls.push('refreshCfpBracket');
                return { status: status, json: async () => body };
            }
            return { status: 200, json: async () => ({}) };
        });
    }
    function postseasonCalendar() {
        retrieveGames.massRetrieveGames.mockResolvedValueOnce({
            newGames: [{ week: 1 }], existingGames: [], remainingCalls: 900
        });
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce([
            { week: 1, seasonType: 'postseason', firstGameStart: '2000-01-01', lastGameStart: '2100-01-01' }
        ]);
    }

    beforeEach(() => {
        scoringModule._calls.length = 0;
        internalFetch.mockReset();
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        internalFetch.mockReset();
        internalFetch.mockImplementation(async () => ({ status: 200, json: async () => ({}) }));
        jest.restoreAllMocks();
    });

    it('refreshes the bracket before scoring on a postseason run', async () => {
        trackRefresh();
        postseasonCalendar();
        await runFullUpdate({ withBetting: false });
        const calls = scoringModule._calls;
        expect(calls).toContain('refreshCfpBracket');
        expect(calls.indexOf('refreshCfpBracket')).toBeLessThan(calls.indexOf('updateScores'));
    });

    it('spends no CFBD call on a regular-season run', async () => {
        trackRefresh();
        await runFullUpdate({ withBetting: false });
        expect(scoringModule._calls).not.toContain('refreshCfpBracket');
        expect(internalFetch.mock.calls.filter(c => isRefresh(c[0]))).toHaveLength(0);
    });

    it('carries on scoring when the bracket is not published yet', async () => {
        trackRefresh({ status: 400, body: { message: 'Bracket has no scheduled games yet' } });
        postseasonCalendar();
        await expect(runFullUpdate({ withBetting: false })).resolves.toMatchObject({ seasonType: 'postseason' });
        expect(scoringModule._calls).toContain('updateScores');
    });

    it('carries on scoring when the refresh throws outright', async () => {
        internalFetch.mockImplementation(async (url) => {
            if (isRefresh(url)) throw new Error('socket hang up');
            return { status: 200, json: async () => ({}) };
        });
        postseasonCalendar();
        await expect(runFullUpdate({ withBetting: false })).resolves.toMatchObject({ seasonType: 'postseason' });
        expect(scoringModule._calls).toContain('updateScores');
    });

    it('refreshCfpBracket reports the outcome without throwing', async () => {
        internalFetch.mockImplementation(async () => ({ status: 201, json: async () => ({ games: 11, status: 'completed' }) }));
        await expect(refreshCfpBracket(2025)).resolves.toMatchObject({ games: 11 });

        internalFetch.mockImplementation(async () => { throw new Error('nope'); });
        await expect(refreshCfpBracket(2025)).resolves.toBeNull();
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
