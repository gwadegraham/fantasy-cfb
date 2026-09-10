process.env.URL = 'http://test.local';
process.env.YEAR = '2026';

// End-to-end behavior of the completion debounce through doLiveUpdate: the
// property that matters operationally is that N ticks discovering finals cost
// ONE pair of CFBD box-score calls, not N pairs. That is the whole reason the
// poll cadence can be tightened, so it is asserted against the real pipeline
// rather than only against the pure timing rules in CompletionFlush.spec.js.

jest.mock('../modules/cfbd-calendar', () => ({
    getCalendar: jest.fn(async () => [
        { week: 7, seasonType: 'regular', firstGameStart: '2000-01-01', lastGameStart: '2100-01-01' }
    ])
}));
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
jest.mock('../modules/parlay-resolve', () => ({ resolveParlays: jest.fn(async () => {}) }));
jest.mock('../modules/scoring.js', () => ({
    updateScores: jest.fn(async () => {}),
    applyH2HBonuses: jest.fn(async () => {}),
    updateCumulativeScores: jest.fn(async () => {})
}));
jest.mock('../models/game', () => ({ find: jest.fn(() => ({ lean: async () => [] })) }));

// The two billable CFBD fetches the debounce exists to batch.
jest.mock('../modules/box-scores', () => ({
    ingestBoxScores: jest.fn(async () => ({ ingested: 1, remainingCalls: 800 }))
}));
jest.mock('../modules/player-box-scores', () => ({
    ingestPlayerStats: jest.fn(async () => ({ ingested: 1, remainingCalls: 799 }))
}));
jest.mock('../modules/scoreboard', () => ({
    updateFromScoreboard: jest.fn(async () => ({ updated: 0, newlyCompleted: [], remainingCalls: 900 }))
}));

const { runLiveUpdate, drainCompletions, _clearInFlight } = require('../modules/score-update');
const completionFlush = require('../modules/completion-flush');
const { updateFromScoreboard } = require('../modules/scoreboard');
const { ingestBoxScores } = require('../modules/box-scores');
const { ingestPlayerStats } = require('../modules/player-box-scores');
const scoringModule = require('../modules/scoring.js');

// One poll tick: the scoreboard reports `updated` games changed and
// `newlyCompleted` finals.
function tick({ updated = 1, newlyCompleted = [] } = {}) {
    updateFromScoreboard.mockResolvedValueOnce({ updated, newlyCompleted, remainingCalls: 900 });
    return runLiveUpdate().finally(() => _clearInFlight());
}

describe('doLiveUpdate completion debounce', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        completionFlush._reset();
        _clearInFlight();
    });

    it('does not settle a final on the tick that discovers it', async () => {
        const r = await tick({ newlyCompleted: [101] });

        // Scores still refresh — that is what keeps the standings live.
        expect(scoringModule.updateScores).toHaveBeenCalled();
        // But nothing billable, and none of the heavy league-wide passes.
        expect(ingestBoxScores).not.toHaveBeenCalled();
        expect(ingestPlayerStats).not.toHaveBeenCalled();
        expect(scoringModule.applyH2HBonuses).not.toHaveBeenCalled();

        expect(r.newlyCompleted).toBe(1);
        expect(r.flushed).toBe(0);
        expect(r.pendingCompletions).toBe(1);
    });

    it('collapses a cluster of finals into one pair of CFBD calls', async () => {
        // Three ticks, each discovering a final — the 30s-cadence shape that
        // would otherwise cost three pairs of whole-week fetches.
        await tick({ newlyCompleted: [101] });
        await tick({ newlyCompleted: [102] });
        await tick({ newlyCompleted: [103] });
        expect(ingestBoxScores).not.toHaveBeenCalled();
        expect(completionFlush.pendingCount()).toBe(3);

        // Then the slate ends and the drain fires.
        const drained = await drainCompletions();

        expect(ingestBoxScores).toHaveBeenCalledTimes(1);
        expect(ingestPlayerStats).toHaveBeenCalledTimes(1);
        expect(ingestBoxScores).toHaveBeenCalledWith(2026, 7, 'regular', [101, 102, 103]);
        expect(drained.flushed).toBe(3);
        expect(completionFlush.pendingCount()).toBe(0);
    });

    it('runs the league-wide passes once per flush, not once per game', async () => {
        await tick({ newlyCompleted: [101, 102] });
        await drainCompletions();

        expect(scoringModule.applyH2HBonuses).toHaveBeenCalledTimes(1);
        expect(scoringModule.updateCumulativeScores).toHaveBeenCalledTimes(1);
    });

    it('evaluates the flush on a tick where nothing changed', async () => {
        // The quiet window almost always expires on an idle tick, so the early
        // return for `updated: 0` must not skip the flush check.
        await tick({ newlyCompleted: [101] });
        jest.spyOn(completionFlush, 'shouldFlush').mockReturnValueOnce({ flush: true, reason: 'test' });

        const r = await tick({ updated: 0 });

        expect(ingestBoxScores).toHaveBeenCalledTimes(1);
        expect(r.flushed).toBe(1);
        completionFlush.shouldFlush.mockRestore();
    });

    it('does nothing billable on a quiet tick with nothing pending', async () => {
        const r = await tick({ updated: 0 });
        expect(ingestBoxScores).not.toHaveBeenCalled();
        expect(scoringModule.applyH2HBonuses).not.toHaveBeenCalled();
        expect(r.flushed).toBe(0);
    });

    it('surfaces the remaining-call count from the flush, not the free poll', async () => {
        // /scoreboard never moves the counter, so the number worth reporting is
        // the one the billable fetches came back with.
        await tick({ newlyCompleted: [101] });
        const drained = await drainCompletions();
        expect(drained.remainingCalls).toBe(799);
    });

    it('keeps ingesting when one of the two fetches fails', async () => {
        ingestBoxScores.mockRejectedValueOnce(new Error('CFBD 500'));
        await tick({ newlyCompleted: [101] });
        const drained = await drainCompletions();

        // A failed team-stats fetch must not cost the player stats or the
        // scoring passes — the enrichment job backfills stats, but the league
        // totals have to settle now.
        expect(ingestPlayerStats).toHaveBeenCalledTimes(1);
        expect(scoringModule.applyH2HBonuses).toHaveBeenCalledTimes(1);
        expect(drained.flushed).toBe(1);
    });

    it('splits a flush that straddles the season-type boundary', async () => {
        // Two calls, so the ids are tagged with different weeks, then drained
        // together — each group is its own pair of fetches.
        completionFlush.addPending([101], { week: 15, seasonType: 'regular' });
        completionFlush.addPending([201], { week: 1, seasonType: 'postseason' });

        await drainCompletions();

        expect(ingestBoxScores).toHaveBeenCalledTimes(2);
        expect(ingestBoxScores).toHaveBeenCalledWith(2026, 15, 'regular', [101]);
        expect(ingestBoxScores).toHaveBeenCalledWith(2026, 1, 'postseason', [201]);
        // The league-wide passes are still a single run across both groups.
        expect(scoringModule.applyH2HBonuses).toHaveBeenCalledTimes(1);
    });

    it('drains to a no-op when nothing is pending', async () => {
        const drained = await drainCompletions();
        expect(drained.flushed).toBe(0);
        expect(ingestBoxScores).not.toHaveBeenCalled();
        expect(scoringModule.applyH2HBonuses).not.toHaveBeenCalled();
    });
});
