const scoringModule = require('../modules/scoring.js');
const { CLAUNTS_DEFAULTS } = require('../modules/scoring-defaults');

// These exercise the aggregation paths that were previously untested and that
// the #171 fixes touched: the cumulative-score reduce and the first-week
// weeklyScore write. global.fetch is mocked and routed by URL so the real
// module code runs against controlled data.
describe('scoring aggregation', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = { ...OLD_ENV, URL: 'http://test.local', YEAR: '2025' };
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = OLD_ENV;
        jest.restoreAllMocks();
    });

    describe('updateCumulativeScores', () => {
        it('does not throw when a user has an empty weeklyScore, and sums correctly', async () => {
            // Regression: `.reduce(sum)` with no seed threw "Reduce of empty
            // array with no initial value" for users with no scores yet,
            // aborting the loop for everyone after them.
            const users = [
                { _id: 'u1', seasons: [{ season: '2025', weeklyScore: [] }] },
                { _id: 'u2', seasons: [{ season: '2025', weeklyScore: [{ score: 10 }, { score: 5 }] }] },
            ];
            const patchBodies = {};

            global.fetch = jest.fn((url, opts) => {
                if (url.includes('/users/season/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve(users) });
                }
                // PATCH /users/:id
                const id = url.split('/users/')[1];
                patchBodies[id] = JSON.parse(opts.body);
                return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
            });

            await expect(scoringModule.updateCumulativeScores()).resolves.toBeUndefined();
            // updateUserCumulativeScore is fire-and-forget; flush microtasks.
            await new Promise(resolve => setImmediate(resolve));

            expect(patchBodies['u1'].cumulativeScore).toBe(0);
            expect(patchBodies['u2'].cumulativeScore).toBe(15);
        });

        it('treats a missing/undefined per-week score as 0 instead of NaN', async () => {
            const users = [
                { _id: 'u3', seasons: [{ season: '2025', weeklyScore: [{ score: 8 }, {}, { score: 2 }] }] },
            ];
            const patchBodies = {};

            global.fetch = jest.fn((url, opts) => {
                if (url.includes('/users/season/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve(users) });
                }
                const id = url.split('/users/')[1];
                patchBodies[id] = JSON.parse(opts.body);
                return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
            });

            await scoringModule.updateCumulativeScores();
            await new Promise(resolve => setImmediate(resolve));

            expect(patchBodies['u3'].cumulativeScore).toBe(10);
        });
    });

    describe('updateScores first-week write', () => {
        it('stores the first weekly score as an array, not a bare object', async () => {
            // Regression: the length === 0 branch passed a bare scoreObject,
            // producing an object where weeklyScore is an array everywhere else.
            const user = {
                _id: 'u1',
                league: 'graham-league',
                seasons: [{ season: '2025', teams: [{ id: 333, school: 'Alabama' }], weeklyScore: [] }],
            };
            const game = { id: 1, homeId: 333, awayId: 8, homePoints: 30, awayPoints: 20, seasonType: 'regular' };
            let patchBody;

            global.fetch = jest.fn((url, opts) => {
                if (url.includes('/users/season/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([user]) });
                }
                if (url.includes('/scoring-config/')) {
                    // getScoringConfig now THROWS on a config it can't load, so
                    // every updateScores test has to answer this. It used to fall
                    // back to defaults silently, which is precisely the bug —
                    // these mocks were relying on it without saying so.
                    return Promise.resolve({ status: 200, json: () => Promise.resolve({ model: 'graham', values: {} }) });
                }
                if (url.includes('/games/seasonType/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([game]) });
                }
                // PATCH /users/:id
                patchBody = JSON.parse(opts.body);
                return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
            });
            jest.spyOn(scoringModule, 'calculateScoreV2').mockResolvedValue(7);

            await scoringModule.updateScores('regular', 1);

            expect(Array.isArray(patchBody.weeklyScore)).toBe(true);
            expect(patchBody.weeklyScore).toHaveLength(1);
            expect(patchBody.weeklyScore[0].score).toBe(7);
            expect(patchBody.weeklyScore[0].week).toBe(1);
        });
    });

    describe('structural config is honored end-to-end', () => {
        // Regression: getScoringConfig forwarded only { model, values } to
        // resolveConfig, dropping combineMode/disabled — so the scoring jobs
        // ignored structural config even though the API returned it and the
        // rules page showed it. This drives updateScores with the REAL engine
        // (calculateScoreV1 not mocked) and asserts a saved combineMode changes
        // the computed score.
        function runWithConfig(configResponse, game) {
            const user = {
                _id: 'u1',
                league: 'claunts-league',
                seasons: [{ season: '2025', teams: [{ id: 333, school: 'Alabama' }], weeklyScore: [] }],
            };
            let patchBody;
            global.fetch = jest.fn((url, opts) => {
                if (url.includes('/users/season/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([user]) });
                }
                if (url.includes('/scoring-config/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve(configResponse) });
                }
                if (url.includes('/games/seasonType/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([game]) });
                }
                if (url.includes('/rankings/')) {
                    return Promise.resolve({ json: () => Promise.resolve({ polls: [{ poll: 'AP Top 25', ranks: [] }] }) });
                }
                patchBody = JSON.parse(opts.body); // PATCH /users/:id
                return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
            });
            return scoringModule.updateScores('regular', 5).then(() => patchBody);
        }

        // Conference win vs an unranked opponent.
        const confWin = {
            id: 1, seasonType: 'regular', notes: null, conferenceGame: true,
            homeId: 333, awayId: 8, homeTeam: 'Alabama', awayTeam: 'Auburn',
            homePoints: 30, awayPoints: 20, homeConference: 'SEC', awayConference: 'SEC',
        };

        it('default (first) combine mode scores a conference win as 2', async () => {
            const cfg = { model: 'claunts', combineMode: 'first', values: CLAUNTS_DEFAULTS, disabled: [] };
            const patchBody = await runWithConfig(cfg, confWin);
            expect(patchBody.weeklyScore[0].score).toBe(2);
        });

        it("a saved 'sum' combine mode is honored (conf 2 + base 1 = 3)", async () => {
            const cfg = { model: 'claunts', combineMode: 'sum', values: CLAUNTS_DEFAULTS, disabled: [] };
            const patchBody = await runWithConfig(cfg, confWin);
            expect(patchBody.weeklyScore[0].score).toBe(3);
        });
    });

    describe('postseason week accumulation', () => {
        // Regression/safeguard: postseason entries used to be keyed by
        // season === "postseason" alone, so scoring a second postseason week
        // overwrote the first. Key by (season, week) so they accumulate.
        it('keeps a separate entry per postseason week instead of overwriting', async () => {
            const user = {
                _id: 'u1',
                league: 'graham-league',
                seasons: [{ season: '2025', teams: [{ id: 333, school: 'Alabama' }], weeklyScore: [] }],
            };
            const g1 = { id: 11, homeId: 333, awayId: 8, homePoints: 30, awayPoints: 20, seasonType: 'postseason' };
            const g2 = { id: 22, homeId: 333, awayId: 9, homePoints: 40, awayPoints: 10, seasonType: 'postseason' };

            global.fetch = jest.fn((url, opts) => {
                if (url.includes('/users/season/')) {
                    // Same object ref each call, so updateScores' in-place edits persist.
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([user]) });
                }
                if (url.includes('/scoring-config/')) {
                    // A resolved config, which is what the real route always
                    // returns. A bare {} used to be silently swallowed into
                    // defaults; it now throws, so the stub has to be honest.
                    return Promise.resolve({ status: 200, json: () => Promise.resolve({ model: 'graham', values: {} }) });
                }
                if (url.includes('/games/seasonType/postseason/week/1/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([g1]) });
                }
                if (url.includes('/games/seasonType/postseason/week/2/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([g2]) });
                }
                return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
            });
            jest.spyOn(scoringModule, 'calculateScoreV2').mockResolvedValue(5);

            await scoringModule.updateScores('postseason', 1);
            await scoringModule.updateScores('postseason', 2);

            const post = user.seasons[0].weeklyScore.filter(e => e.season === 'postseason');
            expect(post).toHaveLength(2);
            expect(post.map(e => e.week).sort()).toEqual([1, 2]);
        });

        it('a regular week does not clobber a postseason entry with the same week number', async () => {
            const user = {
                _id: 'u2',
                league: 'graham-league',
                seasons: [{
                    season: '2025',
                    teams: [{ id: 333, school: 'Alabama' }],
                    // Pre-existing postseason entry stored under week 1.
                    weeklyScore: [{ week: 1, score: 9, season: 'postseason', scoreByTeam: [] }],
                }],
            };
            const regGame = { id: 33, homeId: 333, awayId: 8, homePoints: 30, awayPoints: 20, seasonType: 'regular' };

            global.fetch = jest.fn((url, opts) => {
                if (url.includes('/users/season/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([user]) });
                }
                if (url.includes('/scoring-config/')) {
                    // A resolved config, which is what the real route always
                    // returns. A bare {} used to be silently swallowed into
                    // defaults; it now throws, so the stub has to be honest.
                    return Promise.resolve({ status: 200, json: () => Promise.resolve({ model: 'graham', values: {} }) });
                }
                if (url.includes('/games/seasonType/regular/week/1/')) {
                    return Promise.resolve({ status: 200, json: () => Promise.resolve([regGame]) });
                }
                return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
            });
            jest.spyOn(scoringModule, 'calculateScoreV2').mockResolvedValue(3);

            await scoringModule.updateScores('regular', 1);

            const ws = user.seasons[0].weeklyScore;
            const post = ws.find(e => e.season === 'postseason' && e.week === 1);
            const reg = ws.find(e => e.season !== 'postseason' && e.week === 1);
            expect(post).toBeDefined();
            expect(post.score).toBe(9);          // postseason entry preserved
            expect(reg).toBeDefined();
            expect(reg.score).toBe(3);           // regular week added alongside it
            expect(ws).toHaveLength(2);
        });
    });
});

// A config that didn't load is NOT a config of defaults.
//
// getScoringConfig used to swallow every failure and return the model defaults.
// That reads as harmless — the route resolves defaults for a league with no saved
// doc — but the fallback carries an EMPTY engagementBySeason, so the Captain
// bonus silently became 0 for the whole run, and any commissioner point values,
// combine mode or rule toggles were ignored while the rules page kept showing
// them. At log level: nothing. And updateScores caches the config per league per
// run, so one bad fetch poisoned every manager in that league.
describe('a scoring config that will not load fails the run', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = { ...OLD_ENV, URL: 'http://test.local', YEAR: '2026' };
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

    const user = {
        _id: 'u1', league: 'graham-league',
        seasons: [{ season: '2026', teams: [{ id: 333, school: 'Alabama' }], weeklyScore: [] }]
    };
    const mockConfigResponse = (response) => {
        global.fetch = jest.fn((url) => {
            if (url.includes('/users/season/')) return Promise.resolve({ status: 200, json: () => Promise.resolve([user]) });
            if (url.includes('/scoring-config/')) return response();
            return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
        });
    };

    it('throws when the config endpoint errors', async () => {
        mockConfigResponse(() => Promise.resolve({ status: 500, json: () => Promise.resolve({ message: 'boom' }) }));
        await expect(scoringModule.updateScores('regular', 1))
            .rejects.toThrow(/Could not load scoring config for graham-league.*500.*boom/);
    });

    it('throws when the body is not a resolved config', async () => {
        // A 200 with no `values` — the shape the real route never returns. This
        // path did not even reach the old catch; it just fell out into defaults.
        mockConfigResponse(() => Promise.resolve({ status: 200, json: () => Promise.resolve({}) }));
        await expect(scoringModule.updateScores('regular', 1))
            .rejects.toThrow(/Could not load scoring config for graham-league/);
    });

    it('throws when the body is not JSON at all', async () => {
        mockConfigResponse(() => Promise.resolve({ status: 200, json: () => Promise.reject(new SyntaxError('Unexpected token <')) }));
        await expect(scoringModule.updateScores('regular', 1))
            .rejects.toThrow(/Could not load scoring config for graham-league.*Unexpected token/);
    });

    it('throws when the request itself fails', async () => {
        mockConfigResponse(() => Promise.reject(new Error('ECONNRESET')));
        await expect(scoringModule.updateScores('regular', 1))
            .rejects.toThrow(/Could not load scoring config for graham-league.*ECONNRESET/);
    });

    // The consequence that made this worth failing over: a silent default config
    // has no engagement, so Captain scores nothing.
    it('a real config keeps the per-season engagement the fallback would have dropped', async () => {
        mockConfigResponse(() => Promise.resolve({
            status: 200,
            json: () => Promise.resolve({
                model: 'graham', values: {},
                engagementBySeason: { '2026': { captainEnabled: true, captainMultiplier: 2 } }
            })
        }));
        const cfg = await scoringModule.getScoringConfig('graham-league');
        expect(cfg.engagementBySeason['2026'].captainEnabled).toBe(true);
    });
});
