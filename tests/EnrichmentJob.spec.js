// Covers the server-to-server network seam: modules/internal-api.js (the token
// wrapper) and update-enrichment-job.js (a cron entry point). The only external
// dependency is the global fetch, which we stub and route by URL — the same
// pattern the scoring-module tests use — so no server or CFBD call is needed.

// The run report is the mailer's job (tests/JobEmail.spec.js); stub it so this
// suite never builds a real SMTP transport.
jest.mock('../modules/job-mailer', () => ({
    sendJobEmail: jest.fn(() => Promise.resolve()),
    emailOnSuccess: () => false
}));

jest.mock('../modules/cfbd-calendar', () => ({
    getCalendar: jest.fn(() => Promise.reject(new Error('no calendar stub')))
}));
jest.mock('../modules/score-update', () => ({
    resolveCurrentWeek: jest.fn(() => null)
}));

const { getCalendar } = require('../modules/cfbd-calendar');
const { resolveCurrentWeek } = require('../modules/score-update');

const { internalFetch } = require('../modules/internal-api');
const { sendJobEmail } = require('../modules/job-mailer');
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
    // Route the job's internal calls to fake responses: the two data POSTs plus
    // the job-run start/finish the logger writes around them.
    function stubFetch(over = {}) {
        global.fetch = jest.fn((url, opts) => {
            const res = { status: 200, __opts: opts };
            if (url.includes('/job-runs')) {
                res.status = opts && opts.method === 'POST' ? 201 : 200;
                res.json = () => Promise.resolve({ _id: 'run-1' });
            } else if (url.includes('/enrich')) {
                res.status = over.enrichStatus || 200;
                res.json = () => Promise.resolve(over.enrichBody || { updated: 130 });
            } else if (url.includes('/media')) {
                res.status = over.mediaStatus || 200;
                res.json = () => Promise.resolve({ updated: 55 });
            } else if (url.includes('/pregame-wp')) {
                res.status = over.wpStatus || 200;
                res.json = () => Promise.resolve(over.wpBody || { updated: 42 });
            } else {
                res.json = () => Promise.resolve({});
            }
            return Promise.resolve(res);
        });
    }

    // The data calls only — job-run bookkeeping is asserted separately.
    const dataCalls = () => global.fetch.mock.calls.filter(c => !c[0].includes('/job-runs'));

    test('posts enrich + media to the season endpoints with the internal token', async () => {
        stubFetch();
        const results = await enrichmentJob.run();

        const calls = dataCalls();
        expect(calls).toHaveLength(2);
        const urls = calls.map(c => c[0]);
        expect(urls).toContain('http://test.local/teams/2025/enrich');
        expect(urls).toContain('http://test.local/games/2025/media');

        // Every internal call carries the token and is a POST.
        calls.forEach(([, opts]) => {
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

    test('fetches pregame WP when calendar resolves a current week', async () => {
        getCalendar.mockResolvedValueOnce([{ week: 3 }]);
        resolveCurrentWeek.mockReturnValueOnce({ week: 3, skip: false });
        stubFetch();
        const results = await enrichmentJob.run();

        const wpCall = global.fetch.mock.calls.find(c => c[0].includes('/pregame-wp'));
        expect(wpCall).toBeDefined();
        expect(JSON.parse(wpCall[1].body)).toMatchObject({ week: 3 });
        expect(results.pregameWP.body.updated).toBe(42);

        const enrichCall = global.fetch.mock.calls.find(c => c[0].includes('/enrich'));
        expect(JSON.parse(enrichCall[1].body).week).toBe(3);
    });

    test('pregame WP failure is non-fatal — job still succeeds', async () => {
        getCalendar.mockResolvedValueOnce([{ week: 1 }]);
        resolveCurrentWeek.mockReturnValueOnce({ week: 1, skip: false });
        stubFetch({ wpStatus: 500, wpBody: { message: 'CFBD down' } });
        const results = await enrichmentJob.run();

        expect(results.pregameWP.status).toBe(500);
        expect(results.teams.body.updated).toBe(130);
    });

    test('skips pregame WP on preseason runs even when currentWeek is resolved', async () => {
        getCalendar.mockResolvedValueOnce([{ week: 1 }]);
        resolveCurrentWeek.mockReturnValueOnce({ week: 1, skip: false });
        stubFetch();
        await enrichmentJob.run({ preseason: true });

        const wpCall = global.fetch.mock.calls.find(c => c[0].includes('/pregame-wp'));
        expect(wpCall).toBeUndefined();
    });

    test('a CLI season argument overrides the YEAR env var', async () => {
        process.argv = ['node', 'update-enrichment-job.js', '2026'];
        stubFetch();
        await enrichmentJob.run();
        expect(dataCalls()[0][0]).toContain('/teams/2026/enrich');
    });

    test('exposes a stable JOB_NAME for the scheduler/logger', () => {
        expect(enrichmentJob.JOB_NAME).toBe('enrichment');
    });

    test('records a job run: start under the job name, then success with a summary', async () => {
        stubFetch();
        await enrichmentJob.run();

        const start = global.fetch.mock.calls.find(c => c[0].endsWith('/job-runs'));
        expect(JSON.parse(start[1].body)).toMatchObject({ jobName: 'enrichment', season: '2025' });

        const finish = global.fetch.mock.calls.find(c => c[0].includes('/job-runs/run-1'));
        expect(finish[1].method).toBe('PATCH');
        const done = JSON.parse(finish[1].body);
        expect(done.status).toBe('success');
        expect(done.message).toContain('130 teams enriched');
    });

    // The whole point of the logging: a leg that didn't land must not be filed
    // as a healthy run, or stale SP+ stays as invisible as it was before.
    test('a non-200 from either leg is recorded as an error, not a success', async () => {
        stubFetch({ enrichStatus: 500, enrichBody: { message: 'CFBD timeout' } });
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(enrichmentJob.run()).rejects.toThrow(/enrich -> 500/);

        const finish = global.fetch.mock.calls.find(c => c[0].includes('/job-runs/run-1'));
        const done = JSON.parse(finish[1].body);
        expect(done.status).toBe('error');
        expect(done.message).toContain('CFBD timeout');

        // Failures always email, regardless of JOB_EMAIL_ON_SUCCESS.
        expect(sendJobEmail).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });
});
