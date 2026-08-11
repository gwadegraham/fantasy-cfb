// The scoring pipeline's write paths, and specifically their failure handling.
//
// Every one of these helpers used to end in an un-awaited
// `response.json().then(...)` with no .catch. The app's own API answers JSON, but
// what sits in front of it may not: Heroku serves an HTML page for H12 (30s
// request timeout) and 503 — exactly what a long Saturday run provokes. json()
// rejects on that, the rejection had no handler, and with no
// process.on('unhandledRejection') anywhere in the app, Node exits. Mid-pass:
// some managers written, others not, and the web dyno gone with it, since that is
// where the scheduler runs.
//
// So the contract these lock in is narrow and specific: a failing or junk
// response must never produce an unhandled rejection, and must never be mistaken
// for a successful write.

const scoringModule = require('../modules/scoring.js');
const recordsModule = require('../modules/records.js');
const { failureMessage } = require('../modules/internal-api');

// A response whose body is NOT JSON — the Heroku error-page case.
function htmlErrorPage(status) {
    return {
        status,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
        text: () => Promise.resolve('<html><body>Application error</body></html>')
    };
}
function jsonResponse(status, body) {
    return { status, json: () => Promise.resolve(body) };
}

describe('failureMessage', () => {
    it('prefers the API message when the body is JSON', async () => {
        expect(await failureMessage(jsonResponse(400, { message: 'Cannot find user' })))
            .toBe('Cannot find user (HTTP 400)');
    });

    it('falls back to the status when the body has no message', async () => {
        expect(await failureMessage(jsonResponse(500, {}))).toBe('HTTP 500');
    });

    it('never rejects on a non-JSON body', async () => {
        await expect(failureMessage(htmlErrorPage(503))).resolves.toMatch(/non-JSON/);
    });
});

describe('scoring write failures never become unhandled rejections', () => {
    const OLD_ENV = process.env;
    const realFetch = global.fetch;
    let unhandled;

    beforeEach(() => {
        process.env = { ...OLD_ENV, URL: 'http://test.local', YEAR: '2025' };
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
        // Fail the test if anything in here leaks a rejection, which is the whole
        // point — an unhandled rejection exits the real process.
        unhandled = [];
        process.on('unhandledRejection', (err) => unhandled.push(err));
    });

    afterEach(async () => {
        // Let any leaked rejection surface before asserting none did.
        await new Promise(resolve => setImmediate(resolve));
        process.removeAllListeners('unhandledRejection');
        expect(unhandled).toEqual([]);
        process.env = OLD_ENV;
        global.fetch = realFetch;
        jest.restoreAllMocks();
    });

    // ---- weeklyScore write (updateScores -> PATCH /users/:id) ----------------

    it('reports a failed weeklyScore write instead of crashing on the body', async () => {
        const users = [{ _id: 'u1', league: 'claunts-league', seasons: [{ season: '2025', teams: [], weeklyScore: [] }] }];
        global.fetch = jest.fn((url) => {
            if (url.includes('/users/season/')) return Promise.resolve(jsonResponse(200, users));
            if (url.includes('/scoring-config/')) return Promise.resolve(jsonResponse(200, { model: 'claunts', values: {} }));
            return Promise.resolve(htmlErrorPage(503));   // the PATCH
        });

        await expect(scoringModule.updateScores('regular', 1)).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/Failed to write weeklyScore for user u1.*non-JSON/));
    });

    // ---- cumulativeScore write (updateCumulativeScores -> PATCH /users/:id) --

    it('reports a failed cumulativeScore write instead of crashing on the body', async () => {
        const users = [{ _id: 'u2', seasons: [{ season: '2025', weeklyScore: [{ score: 7 }] }] }];
        global.fetch = jest.fn((url) => url.includes('/users/season/')
            ? Promise.resolve(jsonResponse(200, users))
            : Promise.resolve(htmlErrorPage(503)));

        await expect(scoringModule.updateCumulativeScores()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/Failed to write cumulativeScore for user u2/));
    });

    // Un-awaited, this step resolved before a single write had landed — so the job
    // moved on to team scores, and reported success, with writes still in flight.
    it('does not resolve until every cumulativeScore write has landed', async () => {
        const users = [
            { _id: 'a', seasons: [{ season: '2025', weeklyScore: [{ score: 1 }] }] },
            { _id: 'b', seasons: [{ season: '2025', weeklyScore: [{ score: 2 }] }] }
        ];
        const written = [];
        global.fetch = jest.fn((url, opts) => {
            if (url.includes('/users/season/')) return Promise.resolve(jsonResponse(200, users));
            return new Promise(resolve => setImmediate(() => {
                written.push(JSON.parse(opts.body).cumulativeScore);
                resolve(jsonResponse(200, {}));
            }));
        });

        await scoringModule.updateCumulativeScores();
        expect(written).toEqual([1, 2]);   // not [] — the writes are already done
    });

    // ---- team-score write (PATCH /teams/:id[/:season]) ----------------------

    it('always resolves to a status object on a failed team-score write', async () => {
        global.fetch = jest.fn(() => Promise.resolve(htmlErrorPage(503)));

        // Previously resolved to `undefined`, which made the caller below throw.
        await expect(scoringModule.updateTeamScores(333, { weeklyScore: [] }))
            .resolves.toMatchObject({ status: 503, updatedTeam: null });
        await expect(scoringModule.updateTeamScoresWithYear(2025, 333, { weeklyScore: [] }))
            .resolves.toMatchObject({ status: 503, updatedTeam: null });
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/Failed to write scores for team 333/));
    });

    // The crash path this guards: calculateTeamScores read `.status` off that
    // undefined, throwing a TypeError that rejected up through an async Express 4
    // handler — which does not catch it. The team loop calls that route ~138 times
    // per run, so one bad team could take the app down.
    it('calculateTeamScores reports a failed write rather than throwing', async () => {
        global.fetch = jest.fn((url) => {
            if (url.includes('/games/season/')) return Promise.resolve(jsonResponse(200, []));
            if (url.includes('/scoring-config/')) return Promise.resolve(jsonResponse(200, { model: 'claunts', values: {} }));
            return Promise.resolve(htmlErrorPage(503));   // the team PATCH
        });

        const result = await scoringModule.calculateTeamScores(2025, 333, 'Oregon');
        expect(result).toMatchObject({ status: 503, updatedTeam: null });
    });

    // ---- records tail step -------------------------------------------------

    it('swallows a records failure the way the betting step already did', async () => {
        global.fetch = jest.fn(() => Promise.resolve(htmlErrorPage(503)));
        await expect(recordsModule.updateAllTeamRecords()).resolves.toBeUndefined();
        expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Team Records could not be retrieved.*non-JSON/));
    });

    it('swallows a records network error too', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error('ECONNRESET')));
        await expect(recordsModule.updateAllTeamRecords()).resolves.toBeUndefined();
        expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Team records update failed.*ECONNRESET/));
    });

    // ---- and the happy paths still work ------------------------------------

    it('still reports a successful write', async () => {
        global.fetch = jest.fn(() => Promise.resolve(jsonResponse(200, { id: 333 })));
        await expect(scoringModule.updateTeamScoresWithYear(2025, 333, { weeklyScore: [] }))
            .resolves.toMatchObject({ status: 200, updatedTeam: { id: 333 } });
        expect(console.error).not.toHaveBeenCalled();
    });

    it('tolerates a 200 whose body is not JSON', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            status: 200, json: () => Promise.reject(new SyntaxError('nope'))
        }));
        await expect(scoringModule.updateTeamScoresWithYear(2025, 333, { weeklyScore: [] }))
            .resolves.toMatchObject({ status: 200, updatedTeam: null });
    });
});
