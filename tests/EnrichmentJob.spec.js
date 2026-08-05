// Covers the server-to-server network seam: modules/internal-api.js (the token
// wrapper) and update-enrichment-job.js (a cron entry point). The only external
// dependency is the global fetch, which we stub and route by URL — the same
// pattern the scoring-module tests use — so no server or CFBD call is needed.

const { internalFetch } = require('../modules/internal-api');
const enrichmentJob = require('../update-enrichment-job');

const OLD_ENV = process.env;
const OLD_ARGV = process.argv;

beforeEach(() => {
    process.env = { ...OLD_ENV, URL: 'http://test.local', INTERNAL_API_TOKEN: 'secret-token', YEAR: '2025' };
    process.argv = ['node', 'update-enrichment-job.js'];   // no CLI season/flag by default
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { process.env = OLD_ENV; process.argv = OLD_ARGV; jest.restoreAllMocks(); });

describe('internalFetch', () => {
    test('attaches the internal token while preserving the url, method, and other headers', async () => {
        global.fetch = jest.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({}) }));
        await internalFetch('http://test.local/teams/2025/enrich', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }
        });
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe('http://test.local/teams/2025/enrich');
        expect(opts.method).toBe('POST');
        expect(opts.headers['Content-Type']).toBe('application/json');
        expect(opts.headers['X-Internal-Token']).toBe('secret-token');
    });

    test('sends an empty token header when none is configured', async () => {
        delete process.env.INTERNAL_API_TOKEN;
        global.fetch = jest.fn(() => Promise.resolve({ status: 200, json: () => Promise.resolve({}) }));
        await internalFetch('http://test.local/ping');
        expect(global.fetch.mock.calls[0][1].headers['X-Internal-Token']).toBe('');
    });
});

describe('update-enrichment-job run()', () => {
    // Route the two internal POSTs the job makes to their fake responses.
    function stubFetch() {
        global.fetch = jest.fn((url, opts) => {
            const body = { status: 200 };
            if (url.includes('/enrich')) body.json = () => Promise.resolve({ updated: 130 });
            else if (url.includes('/media')) body.json = () => Promise.resolve({ updated: 55 });
            else body.json = () => Promise.resolve({});
            body.__opts = opts;
            return Promise.resolve(body);
        });
    }

    test('posts enrich + media to the season endpoints with the internal token', async () => {
        stubFetch();
        const results = await enrichmentJob.run();

        expect(global.fetch).toHaveBeenCalledTimes(2);
        const urls = global.fetch.mock.calls.map(c => c[0]);
        expect(urls).toContain('http://test.local/teams/2025/enrich');
        expect(urls).toContain('http://test.local/games/2025/media');

        // Every internal call carries the token and is a POST.
        global.fetch.mock.calls.forEach(([, opts]) => {
            expect(opts.method).toBe('POST');
            expect(opts.headers['X-Internal-Token']).toBe('secret-token');
        });

        expect(results.teams.body.updated).toBe(130);
        expect(results.media.body.updated).toBe(55);
    });

    test('defaults to the weekly scope; preseason opt widens it to "all"', async () => {
        stubFetch();
        await enrichmentJob.run();                    // default
        let enrich = global.fetch.mock.calls.find(c => c[0].includes('/enrich'));
        expect(JSON.parse(enrich[1].body).scope).toBe('weekly');

        global.fetch.mockClear();
        await enrichmentJob.run({ preseason: true });  // preseason
        enrich = global.fetch.mock.calls.find(c => c[0].includes('/enrich'));
        expect(JSON.parse(enrich[1].body).scope).toBe('all');
    });

    test('a CLI season argument overrides the YEAR env var', async () => {
        process.argv = ['node', 'update-enrichment-job.js', '2026'];
        stubFetch();
        await enrichmentJob.run();
        expect(global.fetch.mock.calls[0][0]).toContain('/teams/2026/enrich');
    });

    test('exposes a stable JOB_NAME for the scheduler/logger', () => {
        expect(enrichmentJob.JOB_NAME).toBe('enrichment');
    });
});
