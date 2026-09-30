// api.collegebasketballdata.com — a full sibling of CFBD, same API key.
//
// The existing CFBD_API_KEY authenticates here as-is. The stored value ALREADY
// CONTAINS the `Bearer ` prefix and is sent raw; adding another prefix 401s.
// That is why every header below passes process.env.CFBD_API_KEY straight
// through, exactly as modules/box-scores.js and routes/games.js do.
//
// Quota: one shared 30k/mo pool across both sports (CFBD /info reports
// sharedPool: true, products ["cfb","cbb"]). There is no /info on THIS host —
// it 404s — so the pool is checked via CFBD. The scoped ingest is ~200 billable
// calls per season, which is immaterial against a pool running at ~3%.

const BASE = 'https://api.collegebasketballdata.com';

// One place that knows how to talk to CBBD, so the two traps below cannot be
// re-learned per call site.
//
// Rejects rather than returning non-ok on a network-layer failure (DNS, TLS
// reset, socket hangup) — fetch does that, gamesResponseError-style checks
// never see it, and Express 4 does not route an async handler's rejection to
// error middleware. An unguarded throw in a route takes the whole dyno down.
// routes/games.js learned that when /:season/schedule went on a cron; every
// caller here must try/catch, and cbbdGet turns the rejection into a typed
// error so they can tell "CBBD is down" from "CBBD said no".
async function cbbdGet(path, params = {}) {
    const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

    let res;
    try {
        res = await fetch(url, {
            headers: { 'Accept': 'application/json', 'Authorization': process.env.CFBD_API_KEY }
        });
    } catch (err) {
        const e = new Error(`Could not reach CBBD: ${err.message}`);
        e.unreachable = true;
        throw e;
    }

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        const e = new Error(`CBBD ${path} ${res.status}: ${body.slice(0, 200)}`);
        e.status = res.status;
        throw e;
    }

    const remHeader = res.headers.get('x-calllimit-remaining');
    const data = await res.json();
    // A non-array 200 is a RESPONSE SHAPE CHANGE, not an empty result. Coercing
    // it to [] would surface as "a quiet night" on the refresh and, on the
    // schedule pull, as a 422 blaming the ending-year trap for something else
    // entirely.
    if (!Array.isArray(data)) {
        const e = new Error(`CBBD ${path} returned ${typeof data}, expected an array — the response shape changed.`);
        e.status = res.status;
        throw e;
    }
    return { data, remainingCalls: remHeader != null ? Number(remHeader) : null };
}

// ⚠️ /games CAPS AT 3,000 RECORDS AND SAYS NOTHING ABOUT IT.
//
// Verified twice, most recently 29 Sep 2026: season=2026&seasonType=regular
// returns EXACTLY 3000 rows, first 2025-11-03, last 2026-01-06. There is no
// error, no header, no `hasMore` — the rest of the season is simply absent. A
// one-call season ingest looks completely successful and loses January onward.
//
// So the season is pulled in date windows, and each window ASSERTS its own
// completeness: if a window comes back at the cap, it cannot be trusted to be
// the whole window, and the caller is told rather than silently under-ingesting.
// Windows are a month. The headroom is real but not as large as "152 games a
// day" arithmetic suggests — 152 x 30 is 4,560, ABOVE the cap. The busiest
// window the client actually issues was MEASURED instead: 2025-10-31..2025-11-29
// returns 1,463 games, so a 30-day window runs at roughly half the cap. Do not
// raise WINDOW_DAYS on the strength of the peak-day figure; measure again.
const PAGE_CAP = 3000;
const WINDOW_DAYS = 30;
// A ceiling on how many windows one call may issue. /games is BILLABLE, and
// fetchGamesInRange loops until it reaches the end date — an unbounded range is
// an unbounded spend inside a single HTTP request. Measured: a 2000-01-01 to
// 2026-01-01 range issues 317 sequential calls, well past Heroku's 30s ceiling
// and a real dent in a 30k/mo pool. A season is 8 windows; 16 leaves room for a
// longer season without leaving room for a typo.
const MAX_WINDOWS = 16;

function addDays(d, n) {
    const out = new Date(d.getTime());
    out.setUTCDate(out.getUTCDate() + n);
    return out;
}
const iso = (d) => d.toISOString().slice(0, 10);

// Every game in [start, end], fetched in windows, de-duplicated by id.
//
// Returns { games, windows, remainingCalls, capHits }. `capHits` is non-empty
// only if a window returned PAGE_CAP rows; the caller must treat that as a
// failed ingest rather than a full one.
async function fetchGamesInRange(season, seasonType, start, end) {
    const games = new Map();
    const capHits = [];
    let windows = 0;
    let remainingCalls = null;

    let from = new Date(start);
    const last = new Date(end);

    while (from <= last) {
        if (windows >= MAX_WINDOWS) {
            const e = new Error(`Range ${iso(start)}..${iso(end)} needs more than ${MAX_WINDOWS} `
                + `${WINDOW_DAYS}-day windows. /games is billable; narrow the range.`);
            e.rangeTooWide = true;
            throw e;
        }
        // -1 so windows are inclusive on both ends without overlapping by a day.
        let to = addDays(from, WINDOW_DAYS - 1);
        if (to > last) to = last;

        const { data, remainingCalls: rem } = await cbbdGet('/games', {
            season, seasonType, startDateRange: iso(from), endDateRange: iso(to)
        });
        windows += 1;
        if (rem != null) remainingCalls = rem;
        if (data.length >= PAGE_CAP) {
            // Stop here. The caller refuses the whole ingest on any cap hit, so
            // fetching the remaining windows would burn billable calls to build
            // a result that is about to be discarded.
            capHits.push(`${iso(from)}..${iso(to)}`);
            return { games: [...games.values()], windows, remainingCalls, capHits };
        }

        // Keyed by id: windows are inclusive, and a game exactly on a boundary
        // would otherwise be counted twice.
        data.forEach(g => { if (g && g.id != null) games.set(g.id, g); });

        from = addDays(to, 1);
    }

    return { games: [...games.values()], windows, remainingCalls, capHits };
}

// The window a whole season spans. Deliberately wider than any real season:
// the 2025-26 regular season ran 3 Nov to early April, and the postseason runs
// later still. Over-wide costs one extra call per empty month and under-wide
// loses games silently, so it errs long.
function seasonRange(season) {
    // CBBD labels a split season by its ENDING year — the 2026-27 season is
    // season 2027 — so the calendar range starts in the PREVIOUS year. Getting
    // this backwards returns an empty, successful ingest.
    return { start: new Date(Date.UTC(season - 1, 9, 1)), end: new Date(Date.UTC(season, 3, 30)) };
}

// Every D-I team for a season. One call, 365 rows — well under the 3,000 cap
// that forces /games to page, so this needs none of that machinery.
async function fetchTeams(season) {
    return cbbdGet('/teams', { season });
}

// Which of these ESPN ids actually have a logo, checked before any URL is
// stored.
//
// Kept even though ESPN currently serves all 365, because the reason it exists
// has not gone away: the first version of this ingest synthesised URLs from
// sourceId and 101 of 365 were dead, and nothing noticed because the check
// measured array length. A probe is the only thing that distinguishes "we have
// a logo" from "we built a string".
//
// One HEAD settles it because ESPN serves exactly one size, light and dark
// together — verified on Gonzaga across eight sizes, only 500 exists.
//
// Free: a CDN request, not a CBBD call, so it costs nothing against the quota.
// Batched because 365 sequential round trips would run past Heroku's ceiling.
// 500, because it is the ONLY size ESPN serves. Probing /16/ — football's
// smallest — would have 404'd for every team and stored no logos at all.
const LOGO_PROBE = 'https://a.espncdn.com/i/teamlogos/ncaa/500/';
async function logoIdsThatExist(sourceIds, { batch = 25, fetchImpl } = {}) {
    const doFetch = fetchImpl || fetch;
    const ids = [...new Set(sourceIds.filter(Boolean).map(String))];
    const found = new Set();
    for (let i = 0; i < ids.length; i += batch) {
        const slice = ids.slice(i, i + batch);
        await Promise.all(slice.map(async (id) => {
            try {
                const r = await doFetch(`${LOGO_PROBE}${id}.png`, { method: 'HEAD' });
                if (r && r.ok) found.add(id);
            } catch (e) {
                // A probe that errors is treated as "no logo". Storing a URL we
                // could not confirm is the failure this function exists to stop.
            }
        }));
    }
    return found;
}

module.exports = { cbbdGet, fetchGamesInRange, fetchTeams, logoIdsThatExist, seasonRange, BASE, PAGE_CAP, WINDOW_DAYS, MAX_WINDOWS };
