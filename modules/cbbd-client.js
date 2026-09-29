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
    return { data: Array.isArray(data) ? data : [], remainingCalls: remHeader != null ? Number(remHeader) : null };
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
// Windows are conservative (a month) — the busiest real day is 152 games and a
// month of those is far under 3000, so hitting the cap means something changed
// about the API, not about the schedule.
const PAGE_CAP = 3000;
const WINDOW_DAYS = 30;

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
        // -1 so windows are inclusive on both ends without overlapping by a day.
        let to = addDays(from, WINDOW_DAYS - 1);
        if (to > last) to = last;

        const { data, remainingCalls: rem } = await cbbdGet('/games', {
            season, seasonType, startDateRange: iso(from), endDateRange: iso(to)
        });
        windows += 1;
        if (rem != null) remainingCalls = rem;
        if (data.length >= PAGE_CAP) capHits.push(`${iso(from)}..${iso(to)}`);

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

module.exports = { cbbdGet, fetchGamesInRange, seasonRange, BASE, PAGE_CAP, WINDOW_DAYS };
