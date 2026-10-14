// modules/cbbd-client.js — the paging, the cap detection and the error typing.
//
// This file exists because a review measured the first version of #314 at 12%
// statement coverage on this module: every route test stubbed fetchGamesInRange,
// so the date-window arithmetic, the 3,000-record cap detection, the id
// de-duplication and cbbdGet's error typing — the entire substance of the
// change, and the only new code that spends against a billable API — were
// covered by nothing. The route tests proved the route handles a stub correctly.
//
// `fetch` is stubbed here rather than the client, so the windows and the
// requests they produce are the thing under test.

const client = require('../modules/cbbd-client');

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

// Records every URL requested and answers each with `rows`.
function stubFetch(rows, { status = 200, remaining = '28903', reject = null, body = null } = {}) {
    const calls = [];
    global.fetch = jest.fn(async (url) => {
        calls.push(url);
        if (reject) throw reject;
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (h) => (h === 'x-calllimit-remaining' ? remaining : null) },
            json: async () => (body !== null ? body : (typeof rows === 'function' ? rows(url) : rows)),
            text: async () => 'upstream said no'
        };
    });
    return calls;
}

const q = (url, key) => new URL(url).searchParams.get(key);

describe('fetchGamesInRange — the windows', () => {
    test('covers a whole season in contiguous, non-overlapping windows', async () => {
        const calls = stubFetch([]);
        const { start, end } = client.seasonRange(2027);
        const r = await client.fetchGamesInRange(2027, 'regular', start, end);

        expect(r.windows).toBe(calls.length);
        const ranges = calls.map(u => [q(u, 'startDateRange'), q(u, 'endDateRange')]);
        expect(ranges[0][0]).toBe('2026-10-01');
        // One past the season end, so the final day is not truncated.
        expect(ranges[ranges.length - 1][1]).toBe('2027-05-01');

        // No gaps: each window STARTS exactly WINDOW_DAYS after the last one.
        //
        // Compared on startDateRange, not endDateRange — the end is asked for
        // one day long on purpose (CBBD truncates its own last day), so the
        // requested ranges overlap by a day even though the windows they cover
        // do not. Asserting contiguity on the END was asserting the bug.
        for (let i = 1; i < ranges.length - 1; i++) {
            const prevStart = new Date(ranges[i - 1][0] + 'T00:00:00Z');
            const thisStart = new Date(ranges[i][0] + 'T00:00:00Z');
            expect((thisStart - prevStart) / 86400000).toBe(client.WINDOW_DAYS);
        }
    });

    test('asks for the day AFTER each window, because endDateRange truncates', async () => {
        // ⚠️ CBBD applies endDateRange as `startDate <= <date>T00:00Z`, so
        // naming the window's own last day returns only that day's midnight
        // games. Measured live: endDateRange=2026-11-29 returns 1 game on the
        // 29th; endDateRange=2026-11-30 returns all 39.
        //
        // This silently dropped ~271 of ~5,286 games (5%) across the four
        // in-season window boundaries — every window looked full.
        const calls = stubFetch([]);
        const { start, end } = client.seasonRange(2027);
        await client.fetchGamesInRange(2027, 'regular', start, end);

        // The signature of the fix: each window's requested END is the next
        // window's START. With the bug they differed by a day, and that day's
        // games were requested by nobody.
        for (let i = 1; i < calls.length; i++) {
            expect(q(calls[i - 1], 'endDateRange')).toBe(q(calls[i], 'startDateRange'));
        }
        expect(calls.length).toBeGreaterThan(1);
    });

    test('passes the season and seasonType through on every window', async () => {
        const calls = stubFetch([]);
        const { start, end } = client.seasonRange(2027);
        await client.fetchGamesInRange(2027, 'postseason', start, end);
        calls.forEach(u => {
            expect(q(u, 'season')).toBe('2027');
            expect(q(u, 'seasonType')).toBe('postseason');
        });
    });

    test('de-duplicates by id across window boundaries', async () => {
        // Windows are inclusive at both ends, so a game on a boundary would
        // otherwise be counted twice.
        stubFetch([{ id: 1 }, { id: 2 }]);
        const r = await client.fetchGamesInRange(2027, 'regular',
            new Date(Date.UTC(2026, 10, 1)), new Date(Date.UTC(2027, 0, 31)));
        expect(r.windows).toBeGreaterThan(1);
        expect(r.games.map(g => g.id).sort()).toEqual([1, 2]);
    });

    test('a single day is one window', async () => {
        const calls = stubFetch([]);
        const d = new Date(Date.UTC(2026, 10, 3));
        const r = await client.fetchGamesInRange(2027, 'regular', d, d);
        expect(r.windows).toBe(1);
        expect(calls.length).toBe(1);
        expect(q(calls[0], 'startDateRange')).toBe('2026-11-03');
        // The day after, so the 3rd's own games are not truncated away.
        expect(q(calls[0], 'endDateRange')).toBe('2026-11-04');
    });

    test('reports the remaining call allowance from the last window', async () => {
        stubFetch([], { remaining: '27001' });
        const d = new Date(Date.UTC(2026, 10, 3));
        expect((await client.fetchGamesInRange(2027, 'regular', d, d)).remainingCalls).toBe(27001);
    });
});

describe('fetchGamesInRange — the 3,000-record cap', () => {
    const capped = () => Array.from({ length: client.PAGE_CAP }, (_, i) => ({ id: i + 1 }));

    test('a window at the cap is reported', async () => {
        stubFetch(capped());
        const d = new Date(Date.UTC(2026, 10, 3));
        const r = await client.fetchGamesInRange(2027, 'regular', d, d);
        expect(r.capHits).toEqual(['2026-11-03..2026-11-03']);
    });

    test('and it STOPS, rather than paying for the rest of the season', async () => {
        // The caller discards the whole ingest on any cap hit, so fetching the
        // remaining windows would spend billable calls building a result that
        // is about to be thrown away.
        const calls = stubFetch(capped());
        const { start, end } = client.seasonRange(2027);
        const r = await client.fetchGamesInRange(2027, 'regular', start, end);
        expect(r.capHits).toHaveLength(1);
        expect(calls.length).toBe(1);
        expect(r.windows).toBe(1);
    });

    test('one under the cap is not a cap hit', async () => {
        stubFetch(Array.from({ length: client.PAGE_CAP - 1 }, (_, i) => ({ id: i + 1 })));
        const d = new Date(Date.UTC(2026, 10, 3));
        expect((await client.fetchGamesInRange(2027, 'regular', d, d)).capHits).toEqual([]);
    });
});

describe('fetchGamesInRange — the billable-spend ceiling', () => {
    test('an over-wide range is refused before it issues the calls', async () => {
        // /games is billable and this loops until it reaches the end date.
        // Measured on the real client: 2000-01-01..2026-01-01 is 317 sequential
        // calls in one HTTP request — past Heroku's 30s ceiling and a real dent
        // in a 30k/mo pool.
        const calls = stubFetch([]);
        await expect(client.fetchGamesInRange(2027, 'regular',
            new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2026, 0, 1))))
            .rejects.toThrow(/narrow the range/i);
        expect(calls.length).toBeLessThanOrEqual(client.MAX_WINDOWS);
    });

    test('a whole season fits well inside the ceiling', async () => {
        stubFetch([]);
        const { start, end } = client.seasonRange(2027);
        const r = await client.fetchGamesInRange(2027, 'regular', start, end);
        expect(r.windows).toBeLessThan(client.MAX_WINDOWS);
    });
});

describe('cbbdGet — error typing', () => {
    test('a network failure is typed unreachable', async () => {
        stubFetch([], { reject: new TypeError('fetch failed') });
        await expect(client.cbbdGet('/games')).rejects.toMatchObject({ unreachable: true });
    });

    test('a non-ok response carries the status and is NOT unreachable', async () => {
        stubFetch([], { status: 401 });
        // The distinction is what lets the routes answer 502 for "CBBD is down"
        // and 400 for "CBBD said no".
        const err = await client.cbbdGet('/games').catch(e => e);
        expect(err.status).toBe(401);
        expect(err.unreachable).toBeFalsy();
    });

    test('a non-array 200 body is an error, not an empty result', async () => {
        // Coercing it to [] would surface as a quiet night on the refresh and,
        // on the schedule pull, as a 422 blaming the ending-year trap for what
        // is a response-shape change.
        stubFetch(null, { body: { games: [] } });
        await expect(client.cbbdGet('/games')).rejects.toThrow(/response shape changed/);
    });

    test('sends the key raw, with no second Bearer prefix', async () => {
        // The stored CFBD_API_KEY already contains "Bearer ". Adding another
        // prefix 401s.
        const before = process.env.CFBD_API_KEY;
        process.env.CFBD_API_KEY = 'Bearer testkey';
        global.fetch = jest.fn(async (_u, opts) => ({
            ok: true, status: 200, headers: { get: () => null }, json: async () => []
        }));
        await client.cbbdGet('/games');
        expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer testkey');
        process.env.CFBD_API_KEY = before;
    });

    test('omits empty params rather than sending blanks', async () => {
        const calls = stubFetch([]);
        await client.cbbdGet('/games', { season: 2027, week: undefined, tournament: null, q: '' });
        expect(calls[0]).toContain('season=2027');
        expect(calls[0]).not.toMatch(/week=|tournament=|q=/);
    });
});

describe('fetchTeams', () => {
    test('is a single call with the season, not a paged range', async () => {
        // 365 rows, well under the 3,000 cap that forces /games to page, so
        // this needs none of that machinery.
        const calls = stubFetch([{ id: 1, school: 'Duke' }]);
        const r = await client.fetchTeams(2027);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('/teams?season=2027');
        expect(r.data).toHaveLength(1);
    });

    test('surfaces the remaining call allowance', async () => {
        stubFetch([], { remaining: '28852' });
        expect((await client.fetchTeams(2027)).remainingCalls).toBe(28852);
    });

    test('an unreachable host is typed, like every other call', async () => {
        stubFetch([], { reject: new TypeError('fetch failed') });
        await expect(client.fetchTeams(2027)).rejects.toMatchObject({ unreachable: true });
    });
});

describe('logoUrlsThatExist', () => {
    // CBBD hands over the URLs now (#508); this checks they load. It exists
    // because the first ingest stored 101 sets of dead links and nothing
    // noticed — the check that existed measured array length.
    const U = (id) => `https://cdn.collegefootballdata.com/cbb-logos/500/${id}.png`;
    const okFor = (ids) => async (url) => {
        const ok = ids.some(id => url === U(id));
        return { ok, status: ok ? 200 : 404 };
    };
    const FAST = { retryDelayMs: 0 };

    test('keeps only the URLs that load', async () => {
        const found = await client.logoUrlsThatExist([U(333), U(2561)], { ...FAST, fetchImpl: okFor(['333']) });
        expect([...found]).toEqual([U(333)]);
    });

    test('probes the URL it is given, with HEAD, and nothing else', async () => {
        const seen = [];
        await client.logoUrlsThatExist([U(333)], {
            ...FAST, fetchImpl: async (u, o) => { seen.push([u, o.method]); return { ok: true }; }
        });
        expect(seen).toEqual([[U(333), 'HEAD']]);
    });

    // The retry #508 asked for: 9 of 5,840 probes hit a network error and were
    // 200 on a second try, and a miss stores [] until the next ingest.
    test('a transient network error is retried, not stored as "no logo"', async () => {
        let calls = 0;
        const found = await client.logoUrlsThatExist([U(333)], {
            ...FAST, fetchImpl: async () => { if (++calls === 1) throw new TypeError('fetch failed'); return { ok: true }; }
        });
        expect(found.has(U(333))).toBe(true);
        expect(calls).toBe(2);
    });

    test('so is a 5xx or a 429', async () => {
        const answers = [{ ok: false, status: 503 }, { ok: false, status: 429 }, { ok: true, status: 200 }];
        let calls = 0;
        const found = await client.logoUrlsThatExist([U(333)], { ...FAST, fetchImpl: async () => answers[calls++] });
        expect(found.size).toBe(1);
        expect(calls).toBe(3);
    });

    test('but a 404 or 403 is the CDN\'s answer, and is not retried', async () => {
        let calls = 0;
        const found = await client.logoUrlsThatExist([U(1), U(2)], {
            ...FAST, fetchImpl: async (u) => { calls++; return { ok: false, status: u === U(1) ? 404 : 403 }; }
        });
        expect(found.size).toBe(0);
        expect(calls).toBe(2);
    });

    test('a probe that fails on every attempt counts as no logo', async () => {
        // Storing a URL we could not confirm is the failure this exists to stop.
        let calls = 0;
        const found = await client.logoUrlsThatExist([U(333)], {
            ...FAST, attempts: 3, fetchImpl: async () => { calls++; throw new Error('CDN unreachable'); }
        });
        expect(found.size).toBe(0);
        expect(calls).toBe(3);
    });

    test('each attempt carries a timeout, so a stalled socket cannot hold the batch', async () => {
        // Without one, undici waits ~300s per attempt — far past Heroku's 30s.
        let calls = 0;
        const found = await client.logoUrlsThatExist([U(333)], {
            ...FAST, timeoutMs: 20,
            fetchImpl: (u, o) => new Promise((resolve, reject) => {
                calls++;
                if (!o.signal) return;   // no signal: hangs forever, test times out
                o.signal.addEventListener('abort', () => reject(o.signal.reason));
            })
        });
        expect(found.size).toBe(0);
        expect(calls).toBe(3);
    }, 2000);

    test('drops empty and non-string entries and de-duplicates', async () => {
        const seen = [];
        await client.logoUrlsThatExist([U(333), U(333), null, undefined, '', 42], {
            ...FAST, fetchImpl: async (u) => { seen.push(u); return { ok: true }; }
        });
        expect(seen).toEqual([U(333)]);
    });

    test('batches rather than firing 365 at once', async () => {
        let inFlight = 0, peak = 0;
        const urls = Array.from({ length: 12 }, (_, i) => U(i));
        await client.logoUrlsThatExist(urls, {
            ...FAST, batch: 4,
            fetchImpl: async () => {
                inFlight++; peak = Math.max(peak, inFlight);
                await new Promise(r => setTimeout(r, 1));
                inFlight--; return { ok: true };
            }
        });
        expect(peak).toBeLessThanOrEqual(4);
    });

    test('an empty or missing list makes no requests', async () => {
        const seen = [];
        const fetchImpl = async (u) => { seen.push(u); return { ok: true }; };
        expect((await client.logoUrlsThatExist([], { fetchImpl })).size).toBe(0);
        expect((await client.logoUrlsThatExist(undefined, { fetchImpl })).size).toBe(0);
        expect(seen).toHaveLength(0);
    });
});

describe('seasonRange', () => {
    test('starts in the PREVIOUS calendar year, because CBBD labels by ending year', () => {
        const { start, end } = client.seasonRange(2027);
        expect(start.toISOString().slice(0, 10)).toBe('2026-10-01');
        expect(end.toISOString().slice(0, 10)).toBe('2027-04-30');
    });

    test('covers the real extremes of a season', () => {
        // Measured against the live API: the earliest 2026-27 game is
        // 2026-11-02 and the latest 2025-26 postseason game was 2026-04-07.
        const { start, end } = client.seasonRange(2027);
        expect(new Date("2026-11-02T05:00:00Z") >= start).toBe(true);
        expect(new Date("2027-04-07T00:00:00Z") <= end).toBe(true);
    });
});
