// One game's ESPN summary: the live box score and play-by-play espn.com's own
// game page reads.
//
// ---- the API ----
//
// site.api.espn.com/.../summary?event=<espnId> is ESPN's public, UNDOCUMENTED
// feed (the family modules/team-news.js and hoops-espn-tip-times.js read): no
// key, no quota, no promise it stays put. Verified live on 2 Nov 2026 (UTEP @
// Northern Kentucky, three pulls 90s apart): score, clock, plays and the
// player box all moved between pulls.
//
// It is used for what CBBD and CFBD do NOT have while a game is on — player
// lines and located shots — and only until their own post-game data is stored.
// Nothing in scoring reads it. Anything that goes wrong answers `value: null`
// with `error` set; nothing here throws for ESPN.
//
// ---- cache ----
//
// A football summary is ~450 KB raw, so the raw payload is never kept: the
// caller's `shape` runs once per fetch and only its result is cached, keyed by
// sport and event (one shape per sport). In memory, per dyno. A game still on
// is reused for LIVE_TTL_MS, so every viewer of one game shares one ESPN call
// per window; one ESPN calls over is reused for DONE_TTL_MS; a failure for
// FAIL_TTL_MS, so a broken feed is not hammered by a page polling every 15s.
// Concurrent misses share one request.

const { envNum } = require('./env-num');

const TIMEOUT_MS = 5000;
const LIVE_TTL_MS = envNum('ESPN_SUMMARY_TTL_MS', 20000);
const DONE_TTL_MS = 30 * 60 * 1000;
const FAIL_TTL_MS = 60 * 1000;
// A busy Saturday is ~150 basketball games; the cap stops a long-lived dyno
// collecting a season of them, not a slate.
const MAX_CACHED = 300;

const PATHS = {
    football: 'football/college-football',
    basketball: 'basketball/mens-college-basketball'
};

const cache = new Map();

function summaryUrl(sport, espnId) {
    return `https://site.api.espn.com/apis/site/v2/sports/${PATHS[sport]}/summary?event=${encodeURIComponent(espnId)}`;
}

// ESPN's own word on whether the game is over: 'pre' | 'in' | 'post' | null.
function stateOf(body) {
    const c = body && body.header && Array.isArray(body.header.competitions) ? body.header.competitions[0] : null;
    return (c && c.status && c.status.type && c.status.type.state) || null;
}

async function fetchSummary(sport, espnId) {
    const res = await fetch(summaryUrl(sport, espnId), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ESPN summary ${sport} ${espnId}: ${res.status}`);
    const body = await res.json();
    if (!body || !body.header) throw new Error(`ESPN summary ${sport} ${espnId}: no header — the response shape changed`);
    return body;
}

// { value, error } for one game, `value` being shape(summary). Never throws:
// a shape that throws is a failure like any other.
async function summaryFor(sport, espnId, shape, now = Date.now()) {
    if (!PATHS[sport]) return { value: null, error: `unknown sport ${sport}` };
    if (espnId == null || !/^\d+$/.test(String(espnId))) return { value: null, error: 'no ESPN id for this game' };
    const key = `${sport}:${espnId}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now) return hit.value;
    if (hit && hit.pending) return hit.pending;

    const pending = fetchSummary(sport, String(espnId))
        .then(body => ({ value: { value: shape(body), error: null }, ttl: stateOf(body) === 'post' ? DONE_TTL_MS : LIVE_TTL_MS }))
        .catch((e) => {
            console.error(`espn summary: ${e.message}`);
            return { value: { value: null, error: 'ESPN is unavailable right now' }, ttl: FAIL_TTL_MS };
        })
        .then(({ value, ttl }) => {
            cache.delete(key);
            if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
            cache.set(key, { value, expires: now + ttl });
            return value;
        });
    cache.set(key, { pending, expires: 0 });
    return pending;
}

module.exports = { summaryFor, summaryUrl, stateOf, _cache: cache, LIVE_TTL_MS, DONE_TTL_MS, FAIL_TTL_MS };
