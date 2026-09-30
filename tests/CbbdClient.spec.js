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
        expect(ranges[ranges.length - 1][1]).toBe('2027-04-30');

        // No gaps and no overlaps: each window starts the day after the last ended.
        for (let i = 1; i < ranges.length; i++) {
            const prevEnd = new Date(ranges[i - 1][1] + 'T00:00:00Z');
            const thisStart = new Date(ranges[i][0] + 'T00:00:00Z');
            expect((thisStart - prevEnd) / 86400000).toBe(1);
        }
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
        expect(q(calls[0], 'endDateRange')).toBe('2026-11-03');
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

describe('logoIdsThatExist', () => {
    // The function this whole finding was about. The CFBD logo CDN only hosts
    // schools CFBD knows — football schools — so 101 of 365 basketball teams
    // have nothing there, and synthesising the URL anyway gave them 16 links
    // that all 403. Nothing detected it, because the check that existed
    // measured array length, which is 16 for anyone with a sourceId.
    const okFor = (ids) => async (url) => ({ ok: ids.some(id => url.includes(`/${id}.png`)) });

    test('keeps only the ids the CDN actually serves', async () => {
        const found = await client.logoIdsThatExist(['333', '2561'], { fetchImpl: okFor(['333']) });
        expect([...found]).toEqual(['333']);
    });

    test('a probe that throws counts as no logo, not as a logo', async () => {
        // Storing a URL we could not confirm is the failure this exists to stop.
        const found = await client.logoIdsThatExist(['333'], {
            fetchImpl: async () => { throw new Error('CDN unreachable'); }
        });
        expect(found.size).toBe(0);
    });

    test('drops falsy ids and de-duplicates', async () => {
        const seen = [];
        await client.logoIdsThatExist(['333', '333', null, undefined, ''], {
            fetchImpl: async (u) => { seen.push(u); return { ok: true }; }
        });
        expect(seen).toHaveLength(1);
    });

    test('probes one size per team, at the size that exists', async () => {
        const seen = [];
        await client.logoIdsThatExist(['333'], {
            fetchImpl: async (u, o) => { seen.push([u, o.method]); return { ok: true }; }
        });
        expect(seen).toHaveLength(1);
        // 500 because it is the only size ESPN serves — probing football's /16/
        // would 404 for every team and store no logos at all.
        expect(seen[0][0]).toContain('/ncaa/500/333.png');
        expect(seen[0][1]).toBe('HEAD');
    });

    test('batches rather than firing 365 at once', async () => {
        let inFlight = 0, peak = 0;
        const ids = Array.from({ length: 12 }, (_, i) => String(i));
        await client.logoIdsThatExist(ids, {
            batch: 4,
            fetchImpl: async () => {
                inFlight++; peak = Math.max(peak, inFlight);
                await new Promise(r => setTimeout(r, 1));
                inFlight--; return { ok: true };
            }
        });
        expect(peak).toBeLessThanOrEqual(4);
    });

    test('an empty list makes no requests', async () => {
        const seen = [];
        const found = await client.logoIdsThatExist([], { fetchImpl: async (u) => { seen.push(u); return { ok: true }; } });
        expect(seen).toHaveLength(0);
        expect(found.size).toBe(0);
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
