const { createCalendarCache } = require('../modules/cfbd-calendar');

// A controllable fetcher + clock so we can assert exactly when a CFBD call
// would be spent. sample() returns a fresh non-empty calendar each time so we
// can tell cached results (same array) from refetched ones (new array).
function makeFetcher() {
    let calls = 0;
    const fetcher = async (year) => {
        calls += 1;
        return [{ week: 1, seasonType: 'regular', firstGameStart: `${year}-08-24`, _call: calls }];
    };
    fetcher.callCount = () => calls;
    return fetcher;
}

describe('cfbd-calendar cache', () => {
    it('fetches once, then serves cached within the TTL', async () => {
        const fetchCalendar = makeFetcher();
        let t = 1000;
        const { getCalendar } = createCalendarCache({ fetchCalendar, now: () => t, ttlMs: 6 * 60 * 60 * 1000 });

        const a = await getCalendar(2026);
        t += 60 * 1000;          // 1 minute later, well inside the TTL
        const b = await getCalendar(2026);

        expect(fetchCalendar.callCount()).toBe(1);
        expect(b).toBe(a);        // same array reference => no refetch
    });

    it('refetches once the TTL has elapsed', async () => {
        const fetchCalendar = makeFetcher();
        let t = 0;
        const ttlMs = 6 * 60 * 60 * 1000;
        const { getCalendar } = createCalendarCache({ fetchCalendar, now: () => t, ttlMs });

        await getCalendar(2026);
        t += ttlMs + 1;           // just past the TTL
        await getCalendar(2026);

        expect(fetchCalendar.callCount()).toBe(2);
    });

    it('force:true bypasses a still-fresh cache', async () => {
        const fetchCalendar = makeFetcher();
        const { getCalendar } = createCalendarCache({ fetchCalendar, now: () => 0, ttlMs: 1e9 });

        await getCalendar(2026);
        await getCalendar(2026, { force: true });

        expect(fetchCalendar.callCount()).toBe(2);
    });

    it('caches each season independently', async () => {
        const fetchCalendar = makeFetcher();
        const { getCalendar } = createCalendarCache({ fetchCalendar, now: () => 0, ttlMs: 1e9 });

        await getCalendar(2025);
        await getCalendar(2026);
        await getCalendar(2025);  // still cached

        expect(fetchCalendar.callCount()).toBe(2);
    });

    it('serves the stale calendar when a refetch fails', async () => {
        let calls = 0;
        const fetchCalendar = async () => {
            calls += 1;
            if (calls === 1) return [{ week: 3, seasonType: 'regular' }];
            throw new Error('CFBD 500');
        };
        let t = 0;
        const ttlMs = 1000;
        const { getCalendar } = createCalendarCache({ fetchCalendar, now: () => t, ttlMs });

        const good = await getCalendar(2026);
        t += ttlMs + 1;                   // force the next call to refetch (and fail)
        const stale = await getCalendar(2026);

        expect(stale).toEqual(good);      // fell back to the last good value
    });

    it('does not overwrite a good calendar with an empty response', async () => {
        let calls = 0;
        const fetchCalendar = async () => {
            calls += 1;
            return calls === 1 ? [{ week: 5, seasonType: 'regular' }] : [];
        };
        let t = 0;
        const ttlMs = 1000;
        const { getCalendar } = createCalendarCache({ fetchCalendar, now: () => t, ttlMs });

        const good = await getCalendar(2026);
        t += ttlMs + 1;
        const afterEmpty = await getCalendar(2026);

        expect(afterEmpty).toEqual(good); // kept the prior non-empty calendar
    });

    it('propagates the error when the very first fetch fails (no cache to fall back on)', async () => {
        const fetchCalendar = async () => { throw new Error('CFBD down'); };
        const { getCalendar } = createCalendarCache({ fetchCalendar, now: () => 0, ttlMs: 1000 });

        await expect(getCalendar(2026)).rejects.toThrow('CFBD down');
    });
});
