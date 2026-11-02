// modules/espn-summary.js — the shared, cached ESPN summary fetch.
//
// What matters: viewers of one game share one call per window, a finished
// game is held far longer, a broken feed is not hammered, and nothing here
// ever throws at a page.

const summary = require('../modules/espn-summary');

const body = (state) => ({ header: { competitions: [{ status: { type: { state } } }] }, boxscore: {} });
const ok = (b) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) });
const shape = (b) => ({ state: summary.stateOf(b) });

beforeEach(() => { summary._cache.clear(); });
afterEach(() => { delete global.fetch; jest.restoreAllMocks(); });

test('asks ESPN for the sport\'s summary by event id', async () => {
    global.fetch = jest.fn(() => ok(body('in')));
    expect(await summary.summaryFor('basketball', '401911532', shape, 0)).toEqual({ value: { state: 'in' }, error: null });
    expect(global.fetch.mock.calls[0][0]).toBe('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary?event=401911532');
    expect(summary.summaryUrl('football', 401858509)).toBe('https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=401858509');
});

test('a live game is reused for LIVE_TTL_MS, then fetched again', async () => {
    global.fetch = jest.fn(() => ok(body('in')));
    await summary.summaryFor('basketball', '1', shape, 0);
    await summary.summaryFor('basketball', '1', shape, summary.LIVE_TTL_MS - 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await summary.summaryFor('basketball', '1', shape, summary.LIVE_TTL_MS);
    expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('a game ESPN calls over is held for DONE_TTL_MS', async () => {
    global.fetch = jest.fn(() => ok(body('post')));
    await summary.summaryFor('basketball', '1', shape, 0);
    await summary.summaryFor('basketball', '1', shape, summary.DONE_TTL_MS - 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('concurrent misses share one request', async () => {
    global.fetch = jest.fn(() => ok(body('in')));
    const [a, b] = await Promise.all([summary.summaryFor('basketball', '1', shape, 0), summary.summaryFor('basketball', '1', shape, 0)]);
    expect(a).toEqual(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('sports are cached apart', async () => {
    global.fetch = jest.fn(() => ok(body('in')));
    await summary.summaryFor('basketball', '1', shape, 0);
    await summary.summaryFor('football', '1', shape, 0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('an HTTP error, a changed shape, a timeout or a throwing shape: null with an error, cached for FAIL_TTL_MS', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const cases = [
        () => Promise.resolve({ ok: false, status: 503 }),
        () => ok({ nope: true }),
        () => Promise.reject(new Error('timeout'))
    ];
    for (const [i, f] of cases.entries()) {
        global.fetch = jest.fn(f);
        expect(await summary.summaryFor('basketball', String(i), shape, 0)).toEqual({ value: null, error: 'ESPN is unavailable right now' });
        await summary.summaryFor('basketball', String(i), shape, summary.FAIL_TTL_MS - 1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    }
    global.fetch = jest.fn(() => ok(body('in')));
    const bad = () => { throw new Error('shape broke'); };
    expect((await summary.summaryFor('basketball', '9', bad, 0)).value).toBeNull();
});

test('no usable id or an unknown sport: no call at all', async () => {
    global.fetch = jest.fn();
    expect((await summary.summaryFor('basketball', null, shape)).error).toBe('no ESPN id for this game');
    expect((await summary.summaryFor('basketball', '12a', shape)).error).toBe('no ESPN id for this game');
    expect((await summary.summaryFor('curling', '1', shape)).error).toBe('unknown sport curling');
    expect(global.fetch).not.toHaveBeenCalled();
});

test('the cache is capped: the oldest game is dropped first', async () => {
    global.fetch = jest.fn(() => ok(body('in')));
    for (let i = 0; i < 301; i++) await summary.summaryFor('basketball', String(i), shape, 0);
    expect(summary._cache.size).toBe(300);
    expect(summary._cache.has('basketball:0')).toBe(false);
    expect(summary._cache.has('basketball:300')).toBe(true);
});

test('stateOf: ESPN\'s pre/in/post, or null', () => {
    expect(summary.stateOf(body('post'))).toBe('post');
    expect(summary.stateOf({})).toBeNull();
    expect(summary.stateOf(null)).toBeNull();
});
