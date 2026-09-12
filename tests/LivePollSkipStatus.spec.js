process.env.YEAR = '2026';
process.env.LIVE_POLL_ENABLED = 'true';

// How a live poller tick that did nothing is recorded.
//
// routes/standings.js derives the standings "data as of" badge from the newest
// JobRun whose status is 'success' and whose jobName is a scoring job — and
// 'live-scores' is one. So the status this file asserts is not bookkeeping: it
// decides whether the badge advances.
//
// Two different things arrive here as `skipped`, and only one of them did work:
//
//   concurrent  runLiveUpdate found an update already in flight and returned
//               immediately. Nothing was fetched, nothing was scored.
//   calendar    doLiveUpdate refreshed the scoreboard and ran a completion
//               flush, then found no week to score. Data moved.
//
// Recording the first as a success is what let the badge claim freshness over
// data nothing had touched. It matters more at the 10s cadence than it did at
// 30s: a completion-flush tick runs ~14s in prod, so the ticks landing on top
// of it are now routine rather than rare.

jest.mock('../models/game', () => ({ find: jest.fn(() => ({ lean: async () => [] })) }));
jest.mock('../modules/score-update', () => ({
    runLiveUpdate: jest.fn(async () => ({ updated: 0 })),
    drainCompletions: jest.fn(async () => ({ flushed: 0 }))
}));
jest.mock('../modules/job-logger', () => ({
    startRun: jest.fn(async () => 'run-1'),
    finishRun: jest.fn(async () => {})
}));

const livePoll = require('../modules/live-poll');
const Game = require('../models/game');
const { runLiveUpdate } = require('../modules/score-update');
const { finishRun } = require('../modules/job-logger');
const completionFlush = require('../modules/completion-flush');

function oneLiveGame() {
    Game.find.mockReturnValueOnce({
        lean: async () => [{
            startDate: new Date(Date.now() - 3600 * 1000).toISOString(),
            completed: false,
            seasonType: 'regular'
        }]
    });
}

describe('live-poll records a did-nothing tick as skipped, not success', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        completionFlush._reset();
        livePoll._resetRemaining();
    });

    it("logs 'skipped' when a live update was already running", async () => {
        runLiveUpdate.mockResolvedValueOnce({
            skipped: 'a live update was already running', concurrent: true
        });
        oneLiveGame();

        await livePoll.run();

        expect(finishRun).toHaveBeenCalledWith(
            'run-1', 'skipped', expect.stringMatching(/already running/)
        );
    });

    it("logs 'skipped' when a full update is holding the lock", async () => {
        runLiveUpdate.mockResolvedValueOnce({
            skipped: 'a full update is running', concurrent: true
        });
        oneLiveGame();

        await livePoll.run();

        expect(finishRun).toHaveBeenCalledWith(
            'run-1', 'skipped', expect.stringMatching(/full update/)
        );
    });

    // The calendar skip is the one that must NOT be downgraded: doLiveUpdate
    // reaches it only after updateFromScoreboard and a flush have already run,
    // so scores really did refresh and the badge should move.
    it("keeps 'success' for a calendar skip, which still refreshed data", async () => {
        runLiveUpdate.mockResolvedValueOnce({
            updated: 12, skipped: 'between weeks', flushed: 0
        });
        oneLiveGame();

        await livePoll.run();

        expect(finishRun).toHaveBeenCalledWith(
            'run-1', 'success', expect.stringMatching(/between weeks/)
        );
    });

    it('still logs a normal poll as a success', async () => {
        runLiveUpdate.mockResolvedValueOnce({
            updated: 5, newlyCompleted: 0, week: 3, seasonType: 'regular'
        });
        oneLiveGame();

        await livePoll.run();

        expect(finishRun).toHaveBeenCalledWith(
            'run-1', 'success', expect.stringMatching(/Live update/), expect.any(Object)
        );
    });
});
