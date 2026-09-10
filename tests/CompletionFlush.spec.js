const flush = require('../modules/completion-flush');
const { decideFlush, groupPending, envMs } = flush;

// The timing rules for deferring the heavy post-completion pass. These are the
// property worth pinning: the whole point of the debounce is that a cluster of
// finals collapses into ONE pass no matter how fast the poller runs, and that
// nothing gets stranded when the slate ends.

const QUIET = 120000;
const MAX_WAIT = 300000;

// A pending set as decideFlush sees it. `quietFor`/`heldFor` are expressed as
// ages rather than absolute stamps because that's what the rules actually read.
function pendingState({ count = 1, quietFor = 0, heldFor = 0 } = {}) {
    const nowMs = 10_000_000;
    return {
        pendingCount: count,
        lastAddedMs: nowMs - quietFor,
        firstAddedMs: nowMs - heldFor,
        nowMs,
        quietMs: QUIET,
        maxWaitMs: MAX_WAIT
    };
}

describe('decideFlush', () => {
    it('does nothing when nothing is pending', () => {
        const d = decideFlush(pendingState({ count: 0 }));
        expect(d.flush).toBe(false);
        expect(d.reason).toMatch(/nothing pending/);
    });

    it('holds a cluster that is still growing', () => {
        // A game finaled 30s ago — more from the same slate are likely coming.
        const d = decideFlush(pendingState({ count: 2, quietFor: 30000, heldFor: 30000 }));
        expect(d.flush).toBe(false);
        expect(d.reason).toMatch(/holding 2 game/);
    });

    it('flushes once the cluster goes quiet', () => {
        const d = decideFlush(pendingState({ count: 3, quietFor: QUIET, heldFor: QUIET }));
        expect(d.flush).toBe(true);
        expect(d.reason).toMatch(/quiet/);
    });

    it('flushes at the max wait even while finals keep trickling in', () => {
        // The pathological Saturday: a new final every minute, so the quiet
        // timer never expires. Without the cap this would defer forever.
        const d = decideFlush(pendingState({ count: 9, quietFor: 60000, heldFor: MAX_WAIT }));
        expect(d.flush).toBe(true);
        expect(d.reason).toMatch(/max wait/);
    });

    it('force flushes regardless of the timers', () => {
        // The slate-is-over drain: the poller has stopped firing, so waiting
        // for quiet would strand these games.
        const d = decideFlush({ ...pendingState({ count: 4, quietFor: 0, heldFor: 0 }), force: true });
        expect(d.flush).toBe(true);
        expect(d.reason).toMatch(/forced with 4 game/);
    });

    it('force does not invent work when the set is empty', () => {
        const d = decideFlush({ ...pendingState({ count: 0 }), force: true });
        expect(d.flush).toBe(false);
    });

    it('treats a zero quiet window as flush-on-every-tick', () => {
        // The kill switch (LIVE_COMPLETION_QUIET_MS=0) has to restore the old
        // inline behavior without a code change.
        const d = decideFlush({ ...pendingState({ count: 1, quietFor: 0, heldFor: 0 }), quietMs: 0 });
        expect(d.flush).toBe(true);
    });
});

describe('groupPending', () => {
    it('batches a normal cluster into a single week group', () => {
        const groups = groupPending([
            { id: 1, week: 3, seasonType: 'regular' },
            { id: 2, week: 3, seasonType: 'regular' },
            { id: 3, week: 3, seasonType: 'regular' }
        ]);
        // One group means one pair of CFBD calls for all three games — the
        // saving the debounce exists to capture.
        expect(groups).toHaveLength(1);
        expect(groups[0]).toEqual({ week: 3, seasonType: 'regular', gameIds: [1, 2, 3] });
    });

    it('splits a flush that straddles the regular/postseason boundary', () => {
        // Army-Navy (regular week 15) can final while bowl games are underway.
        // Ingesting both under one week would query the wrong slate and the
        // stats would silently never land.
        const groups = groupPending([
            { id: 1, week: 15, seasonType: 'regular' },
            { id: 2, week: 1, seasonType: 'postseason' }
        ]);
        expect(groups).toHaveLength(2);
        expect(groups.find(g => g.seasonType === 'regular').gameIds).toEqual([1]);
        expect(groups.find(g => g.seasonType === 'postseason').gameIds).toEqual([2]);
    });

    it('keeps distinct postseason weeks apart', () => {
        const groups = groupPending([
            { id: 1, week: 1, seasonType: 'postseason' },
            { id: 2, week: 2, seasonType: 'postseason' }
        ]);
        expect(groups).toHaveLength(2);
    });
});

describe('pending set', () => {
    beforeEach(() => flush._reset());

    it('accumulates across ticks and reports its size', () => {
        flush.addPending([1, 2], { week: 3, seasonType: 'regular' }, 1000);
        flush.addPending([3], { week: 3, seasonType: 'regular' }, 2000);
        expect(flush.pendingCount()).toBe(3);
    });

    it('collapses a game reported as newly completed twice', () => {
        // routes/games.js is a second path to completed:true and can race the
        // poller; double-ingesting the same game is wasted work.
        flush.addPending([7], { week: 3, seasonType: 'regular' }, 1000);
        const added = flush.addPending([7], { week: 3, seasonType: 'regular' }, 2000);
        expect(added).toBe(0);
        expect(flush.pendingCount()).toBe(1);
    });

    it('starts the quiet timer from the newest final, not the oldest', () => {
        flush.addPending([1], { week: 3, seasonType: 'regular' }, 0);
        // A second final 60s later resets quiet, so 60s after THAT is still
        // only 60s of quiet — not the 120s the first game has been held.
        flush.addPending([2], { week: 3, seasonType: 'regular' }, 60000);
        expect(flush.shouldFlush({ nowMs: 120000 }).flush).toBe(false);
        expect(flush.shouldFlush({ nowMs: 180000 }).flush).toBe(true);
    });

    it('ignores null ids', () => {
        expect(flush.addPending([null, undefined, 5], { week: 1, seasonType: 'regular' }, 0)).toBe(1);
        expect(flush.pendingCount()).toBe(1);
    });

    it('empties the set when taken, so an overlapping poll cannot re-take it', () => {
        flush.addPending([1, 2], { week: 4, seasonType: 'regular' }, 1000);
        const groups = flush.takePending();
        expect(groups[0].gameIds).toEqual([1, 2]);
        expect(flush.pendingCount()).toBe(0);
        expect(flush.takePending()).toEqual([]);
    });

    it('restarts the window cleanly after a take', () => {
        flush.addPending([1], { week: 4, seasonType: 'regular' }, 0);
        flush.takePending();
        // A game finaling right after the flush must wait its own full quiet
        // window, not inherit the drained one's elapsed time.
        flush.addPending([2], { week: 4, seasonType: 'regular' }, 1000);
        expect(flush.shouldFlush({ nowMs: 2000 }).flush).toBe(false);
        expect(flush.shouldFlush({ nowMs: 1000 + QUIET }).flush).toBe(true);
    });
});

describe('envMs', () => {
    afterEach(() => { delete process.env.TEST_FLUSH_MS; });

    it('falls back when unset or blank', () => {
        expect(envMs('TEST_FLUSH_MS', 120000)).toBe(120000);
        process.env.TEST_FLUSH_MS = '';
        expect(envMs('TEST_FLUSH_MS', 120000)).toBe(120000);
    });

    it('accepts an override, including 0 as the kill switch', () => {
        process.env.TEST_FLUSH_MS = '30000';
        expect(envMs('TEST_FLUSH_MS', 120000)).toBe(30000);
        process.env.TEST_FLUSH_MS = '0';
        expect(envMs('TEST_FLUSH_MS', 120000)).toBe(0);
    });

    it('falls back rather than trusting garbage', () => {
        // A typo'd config var must not turn the debounce into NaN, which would
        // make every comparison false and defer the pass forever.
        for (const bad of ['abc', '-1', 'NaN']) {
            process.env.TEST_FLUSH_MS = bad;
            expect(envMs('TEST_FLUSH_MS', 120000)).toBe(120000);
        }
    });
});
