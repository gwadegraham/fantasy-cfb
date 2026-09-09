// The season-stats and player-season-leaders cron entry points.
//
// Neither had coverage, and both were quietly broken in the same two ways:
// they handed the raw response body to finishRun (whose `message` is a String,
// so the PATCH failed its cast and every run stayed 'running' forever) and
// called sendJobEmail positionally (it takes one options object, so every
// report rendered as "undefined FAILED" — on successful runs too). Both
// failures are invisible from inside the job: job-logger swallows a bad
// response and the mailer never throws. So these tests assert the shape of
// what the jobs hand those two collaborators, which is the only place the
// bugs were observable.

jest.mock('../modules/job-mailer', () => ({
    sendJobEmail: jest.fn(() => Promise.resolve()),
    emailOnSuccess: jest.fn(() => false)
}));

const { sendJobEmail, emailOnSuccess } = require('../modules/job-mailer');
const seasonStatsJob = require('../update-season-stats-job');
const leadersJob = require('../update-player-season-leaders-job');

const OLD_ENV = process.env;

const JOBS = [
    { mod: seasonStatsJob, name: 'season-stats', label: 'Season Stats', path: '/team-season-stats/ingest/' },
    { mod: leadersJob, name: 'player-season-leaders', label: 'Player Season Leaders', path: '/player-season-leaders/ingest/' },
];

function stubFetch(over = {}) {
    global.fetch = jest.fn((url, opts) => {
        if (url.includes('/job-runs')) {
            return Promise.resolve({
                status: opts && opts.method === 'POST' ? 201 : 200,
                json: () => Promise.resolve({ _id: 'run-1' })
            });
        }
        return Promise.resolve({
            status: over.status || 200,
            json: () => Promise.resolve(over.body || { teams: 138, created: 4, updated: 134 })
        });
    });
}

const patchBody = () => {
    const call = global.fetch.mock.calls.find(
        c => c[0].includes('/job-runs/') && c[1].method === 'PATCH');
    return call ? JSON.parse(call[1].body) : null;
};

beforeEach(() => {
    process.env = { ...OLD_ENV, URL: 'http://test.local', INTERNAL_API_TOKEN: 'tok', YEAR: '2026' };
    sendJobEmail.mockClear();
    emailOnSuccess.mockReturnValue(false);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

describe.each(JOBS)('$name job', ({ mod, name, label, path }) => {
    test('posts to its ingest endpoint for the configured season', async () => {
        stubFetch();
        await mod.run();
        const call = global.fetch.mock.calls.find(c => c[0].includes(path));
        expect(call[0]).toBe(`http://test.local${path}2026`);
        expect(call[1].method).toBe('POST');
        expect(call[1].headers['X-Internal-Token']).toBe('tok');
    });

    test('finishes the run with a STRING message so the PATCH can cast it', async () => {
        stubFetch();
        await mod.run();
        const body = patchBody();
        expect(body.status).toBe('success');
        expect(typeof body.message).toBe('string');
        expect(body.message).toContain('138 teams ingested');
        expect(body.message).toContain('4 new, 134 updated');
    });

    test('a failed ingest is recorded as an error, with a string message', async () => {
        stubFetch({ status: 500, body: { message: 'CFBD down' } });
        await expect(mod.run()).rejects.toThrow(/CFBD down/);
        const body = patchBody();
        expect(body.status).toBe('error');
        expect(typeof body.message).toBe('string');
        expect(body.message).toContain('CFBD down');
    });

    test('rethrows so the scheduler sees a failure instead of a silent no-op', async () => {
        stubFetch({ status: 500, body: { message: 'boom' } });
        await expect(mod.run()).rejects.toThrow();
    });

    test('emails a SUCCESS report as an options object, not positional args', async () => {
        emailOnSuccess.mockReturnValue(true);
        stubFetch();
        await mod.run();

        expect(sendJobEmail).toHaveBeenCalledTimes(1);
        const opts = sendJobEmail.mock.calls[0][0];
        expect(sendJobEmail.mock.calls[0]).toHaveLength(1);
        expect(opts).toMatchObject({ label, ok: true });
        expect(typeof opts.when).toBe('string');
        expect(Array.isArray(opts.rows)).toBe(true);
        expect(opts.rows).toContainEqual(['Teams ingested', '138']);
    });

    test('a failure always emails, and says it failed', async () => {
        emailOnSuccess.mockReturnValue(false);
        stubFetch({ status: 500, body: { message: 'CFBD down' } });
        await expect(mod.run()).rejects.toThrow();

        const opts = sendJobEmail.mock.calls[0][0];
        expect(opts.label).toBe(label);
        expect(opts.ok).toBe(false);
        expect(opts.error).toContain('CFBD down');
    });

    test('stays silent on success unless opted in', async () => {
        stubFetch();
        await mod.run();
        expect(sendJobEmail).not.toHaveBeenCalled();
    });

    test('exposes the name the scheduler registers it under', () => {
        expect(mod.JOB_NAME).toBe(name);
    });
});
