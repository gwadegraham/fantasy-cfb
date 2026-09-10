process.env.YEAR = '2026';
process.env.LIVE_POLL_ENABLED = 'true';

// The slate-is-over drain in live-poll's run().
//
// This is the one gap the games-live gate cannot close by itself: the gate is
// what stops the poller once every game is final, which is exactly the moment
// the last final's completion work is sitting pending. Without the drain that
// cluster waits for a tick that never comes, and the week's box scores don't
// land until Tuesday's enrichment backfill. So the branch is asserted directly.

jest.mock('../models/game', () => ({ find: jest.fn(() => ({ lean: async () => [] })) }));
jest.mock('../modules/score-update', () => ({
    runLiveUpdate: jest.fn(async () => ({ updated: 0 })),
    drainCompletions: jest.fn(async () => ({ flushed: 2 }))
}));
jest.mock('../modules/job-logger', () => ({
    startRun: jest.fn(async () => 'run-1'),
    finishRun: jest.fn(async () => {})
}));
const livePoll = require('../modules/live-poll');
const Game = require('../models/game');
const { runLiveUpdate, drainCompletions } = require('../modules/score-update');
const { startRun, finishRun } = require('../modules/job-logger');
const completionFlush = require('../modules/completion-flush');

// No live games in the DB, so the games-live gate closes.
function noLiveGames() {
    Game.find.mockReturnValueOnce({ lean: async () => [] });
}

// One regular-season game that kicked off an hour ago and isn't final.
function oneLiveGame() {
    Game.find.mockReturnValueOnce({
        lean: async () => [{
            startDate: new Date(Date.now() - 3600 * 1000).toISOString(),
            completed: false,
            seasonType: 'regular'
        }]
    });
}

describe('live-poll drain when the slate is over', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        completionFlush._reset();
        livePoll._resetRemaining();
    });

    it('skips cheaply when nothing is live and nothing is pending', async () => {
        noLiveGames();
        const r = await livePoll.run();

        expect(r).toEqual({ skipped: 'no game in progress' });
        expect(drainCompletions).not.toHaveBeenCalled();
        // Not even a JobRun — an empty day has to stay silent, or the
        // standings "last updated" badge would advance on nothing.
        expect(startRun).not.toHaveBeenCalled();
    });

    it('drains pending completions once no game is live', async () => {
        completionFlush.addPending([101, 102], { week: 7, seasonType: 'regular' });
        noLiveGames();

        const r = await livePoll.run();

        expect(drainCompletions).toHaveBeenCalledTimes(1);
        expect(r).toEqual({ drained: 2 });
        // Logged as a JobRun so the badge reflects the settle, and the poll
        // itself is not attempted — there is nothing live to poll.
        expect(finishRun).toHaveBeenCalledWith('run-1', 'success', expect.stringMatching(/Slate over — settled 2/));
        expect(runLiveUpdate).not.toHaveBeenCalled();
    });

    it('records a failed drain instead of throwing', async () => {
        completionFlush.addPending([101], { week: 7, seasonType: 'regular' });
        drainCompletions.mockRejectedValueOnce(new Error('CFBD 503'));
        noLiveGames();

        const r = await livePoll.run();

        expect(r).toEqual({ error: 'CFBD 503' });
        expect(finishRun).toHaveBeenCalledWith('run-1', 'error', 'CFBD 503');
    });

    it('polls normally, without draining, while a game is still live', async () => {
        completionFlush.addPending([101], { week: 7, seasonType: 'regular' });
        oneLiveGame();

        await livePoll.run();

        // Mid-slate the debounce owns the timing — the drain is only for after
        // the gate closes, or an early final would settle immediately and undo
        // the batching.
        expect(runLiveUpdate).toHaveBeenCalledTimes(1);
        expect(drainCompletions).not.toHaveBeenCalled();
    });
});
