// Coverage for modules/remote-season.js — "what season is it?" for a process
// with no database connection.
//
// The four ingest jobs are pure HTTP clients: they never mongoose.connect, so
// the in-process season cache is always empty for them. Run by the scheduler
// they share the server's primed cache; run standalone with `heroku run` they
// had only process.env.YEAR — which after a rollover is last season. Same line
// of code, two answers depending on how the process started. This module is
// what closes that gap, so the tests are about the preference order.

const activeSeason = require('../modules/active-season');
const { remoteSeason } = require('../modules/remote-season');

const ORIGINAL = { YEAR: process.env.YEAR, URL: process.env.URL, TOKEN: process.env.INTERNAL_API_TOKEN };

beforeEach(() => {
    activeSeason._reset();
    process.env.URL = 'http://test.local';
    process.env.INTERNAL_API_TOKEN = 'spec-token';
    process.env.YEAR = '2026';
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    Object.assign(process.env, ORIGINAL);
    delete global.fetch;
});

const ok = (body) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });

describe('preference order', () => {
    test('asks the server when there is no primed cache', async () => {
        global.fetch = ok({ sport: 'football', season: 2027, status: 'preseason' });
        await expect(remoteSeason('football')).resolves.toBe(2027);
        expect(global.fetch.mock.calls[0][0]).toBe('http://test.local/seasons/football');
    });

    test('prefers the primed cache and makes no HTTP call at all', async () => {
        // The scheduler path: the job runs inside the server process.
        global.fetch = ok({ season: 9999 });
        const SportSeason = require('../models/sportSeason');
        jest.spyOn(SportSeason, 'find').mockReturnValue({ lean: async () => [{ sport: 'football', season: 2026 }] });
        const League = require('../models/league');
        jest.spyOn(League, 'find').mockReturnValue({ lean: async () => [] });
        await activeSeason.prime();

        await expect(remoteSeason('football')).resolves.toBe(2026);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});

describe('when the server cannot answer', () => {
    test('falls back to YEAR on a non-200, and says so', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
        await expect(remoteSeason('football')).resolves.toBe(2026);
        const lines = console.error.mock.calls.map(c => c.map(String).join(' '));
        expect(lines.some(l => l.includes('answered 404'))).toBe(true);
        // Loud on purpose: after a rollover this is the stale answer and the job
        // is about to ingest the wrong season.
        expect(lines.some(l => l.includes('verify this is the current season'))).toBe(true);
    });

    test('falls back to YEAR when the request throws', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(remoteSeason('football')).resolves.toBe(2026);
        const lines = console.error.mock.calls.map(c => c.map(String).join(' '));
        expect(lines.some(l => l.includes('ECONNREFUSED'))).toBe(true);
    });

    test('falls back to YEAR when the body carries no usable season', async () => {
        global.fetch = ok({ sport: 'football' });
        await expect(remoteSeason('football')).resolves.toBe(2026);
    });

    test('refuses to hand a non-football sport the football YEAR', async () => {
        // process.env.YEAR only ever described football. Falling back to it for
        // basketball would ingest 2026 instead of 2027 — silently, and into the
        // wrong season's collection.
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
        await expect(remoteSeason('basketball')).resolves.toBeNull();
        const lines = console.error.mock.calls.map(c => c.map(String).join(' '));
        expect(lines.some(l => l.includes('refusing to guess'))).toBe(true);
    });

    test('is null — not NaN — when there is no YEAR either', async () => {
        delete process.env.YEAR;
        global.fetch = jest.fn().mockRejectedValue(new Error('down'));
        await expect(remoteSeason('football')).resolves.toBeNull();
    });
});

// The resolver returning null is only half the contract — the jobs have to act
// on it. A commit message once claimed "the job refuses"; nothing did, and
// `POST /team-season-stats/ingest/null` went out instead.
//
// Covered here for the two jobs that export run() and return before any
// JobRun/email bookkeeping. update-expected-wins-job.js has no exports (its
// guard sits ahead of a require() of expectedWins<season>.json, which would
// otherwise throw MODULE_NOT_FOUND before a JobRun row exists) and
// update-enrichment-job.js does work before its guard is reachable here.
describe('the ingest jobs refuse a null season', () => {
    // Scoped here: resetting modules globally would detach the top-level
    // activeSeason import from the models the earlier tests re-require.
    afterEach(() => jest.resetModules());

    test.each([
        ['season-stats', '../update-season-stats-job'],
        ['player-season-leaders', '../update-player-season-leaders-job']
    ])('%s skips rather than ingesting against "null"', async (_label, modPath) => {
        // Mock the resolver rather than unsetting YEAR: each job re-runs
        // `require('dotenv').config()` at module scope, so a resetModules()
        // reload puts YEAR straight back from .env and the null never happens.
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        jest.resetModules();
        jest.doMock('../modules/remote-season', () => ({ remoteSeason: async () => null }));
        const { run } = require(modPath);

        await expect(run()).resolves.toMatchObject({ skipped: 'no active season' });
        // Nothing was posted anywhere — in particular no `.../ingest/null`.
        const urls = global.fetch.mock.calls.map(c => String(c[0]));
        expect(urls.every(u => !u.includes('null'))).toBe(true);
        expect(urls.every(u => !u.includes('/job-runs'))).toBe(true);
    });
});
