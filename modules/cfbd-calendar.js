// Cached wrapper around CFBD's getCalendar.
//
// The season "calendar" (per-week firstGameStart / lastGameStart windows) is
// essentially static once the schedule is published — the boundaries don't move
// intra-day. But runFullUpdate (and the game-day live poller) calls getCalendar
// on EVERY poll just to work out the current week, so uncached it costs one CFBD
// call per poll. During frequent game-day polling that's the single biggest
// avoidable drain on the monthly budget.
//
// The in-process scheduler (server.js runs jobs inside the one long-lived web
// dyno) means a plain in-memory cache persists across every poll, so we cache
// the calendar per-season with a TTL and collapse dozens of daily fetches into
// a handful. The current-week math is time-based against the cached boundaries,
// so even a slightly stale calendar still returns the correct week.

const { withRetry } = require('./retry');
const cfb = require('cfb.js');

// Ensure the shared CFBD client is authenticated even if this module is the
// first one required in a given process (idempotent — it's a singleton).
cfb.ApiClient.instance.authentications['ApiKeyAuth'].apiKey = process.env.CFBD_API_KEY;

// At most one CFBD calendar fetch per season per TTL window. 6h keeps staleness
// to a fraction of a day while collapsing a full game-day of polls into a couple
// of fetches. Overridable via env for ops.
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

function realFetch(year) {
    const gamesApi = new cfb.GamesApi();
    return withRetry(() => gamesApi.getCalendar(year), { label: 'getCalendar' });
}

// Factory so tests can inject a fake fetcher + clock. Production uses the default
// instance exported below.
function createCalendarCache({ fetchCalendar = realFetch, now = Date.now, ttlMs = DEFAULT_TTL_MS } = {}) {
    const cache = new Map(); // year -> { at, data }

    async function getCalendar(year, { force = false } = {}) {
        const key = String(year);
        const hit = cache.get(key);
        if (!force && hit && (now() - hit.at) < ttlMs) {
            return hit.data;
        }

        let data;
        try {
            data = await fetchCalendar(year);
        } catch (err) {
            // On a hard failure, a stale-but-usable calendar beats none.
            if (hit) {
                console.log(`⚠️  getCalendar failed; serving cached calendar for ${key}: ${err.message || err}`);
                return hit.data;
            }
            throw err;
        }

        if (Array.isArray(data) && data.length) {
            cache.set(key, { at: now(), data });
            return data;
        }
        // Empty/garbage response: keep any prior good value rather than caching junk.
        return hit ? hit.data : data;
    }

    function clear() { cache.clear(); }

    return { getCalendar, clear };
}

// Process-wide default instance — what the scoring jobs and live poller use.
const defaultCache = createCalendarCache({
    ttlMs: Number(process.env.CFBD_CALENDAR_TTL_MS) || DEFAULT_TTL_MS
});

module.exports = {
    getCalendar: (year, opts) => defaultCache.getCalendar(year, opts),
    clearCalendarCache: () => defaultCache.clear(),
    createCalendarCache,
    DEFAULT_TTL_MS
};
