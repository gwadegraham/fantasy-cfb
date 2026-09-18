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
            // The week's games are fetched in ONE batched call before the user
            // loop, and it insists on an array — a `{}` catch-all would fail the
            // run there instead of at the config, which is what these tests are
            // about.
            if (url.includes('/games/')) return Promise.resolve({ status: 200, json: () => Promise.resolve([]) });
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

// updateScores used to fetch the week's games ONCE PER ROSTERED TEAM, over
// HTTP, sequentially: 120 team-slots in the 2026 season measured 120 round trips
// and 7.98s, against 0.44s for the one batched request that covers the same 69
// distinct teams. The cost was the round trips, not the payload (69KB across the
// 120 replies, 32KB for the one), so it is the REQUEST COUNT these guard.
describe('updateScores reads the week in one batched request', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = { ...OLD_ENV, URL: 'http://test.local', YEAR: '2025' };
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

    // Two managers, ten teams each, and one game that both of them have a side
    // of — the case the deduplicated union has to credit twice.
    const SHARED = { id: 900, homeId: 333, awayId: 99, homePoints: 30, awayPoints: 20, seasonType: 'regular' };
    const userA = {
        _id: 'uA', league: 'graham-league',
        seasons: [{ season: '2025', weeklyScore: [], teams: [
            { id: 333, school: 'Alabama' }, { id: 2, school: 'B' }, { id: 3, school: 'C' },
            { id: 4, school: 'D' }, { id: 5, school: 'E' },
        ] }],
    };
    const userB = {
        _id: 'uB', league: 'graham-league',
        seasons: [{ season: '2025', weeklyScore: [], teams: [
            { id: 99, school: 'Auburn' }, { id: 6, school: 'F' }, { id: 7, school: 'G' },
            { id: 8, school: 'H' }, { id: 9, school: 'I' },
        ] }],
    };

    const mockFetch = (gamesReply) => {
        const gameUrls = [];
        const patchBodies = {};
        global.fetch = jest.fn((url, opts) => {
            if (url.includes('/users/season/')) {
                return Promise.resolve({ status: 200, json: () => Promise.resolve([userA, userB]) });
            }
            if (url.includes('/scoring-config/')) {
                return Promise.resolve({ status: 200, json: () => Promise.resolve({ model: 'graham', values: {} }) });
            }
            if (url.includes('/games/')) {
                gameUrls.push(url);
                return gamesReply();
            }
            patchBodies[url.split('/users/')[1]] = JSON.parse(opts.body);
            return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
        });
        return { gameUrls, patchBodies };
    };

    it('asks for the whole week once, not once per rostered team', async () => {
        const { gameUrls } = mockFetch(() => Promise.resolve({ status: 200, json: () => Promise.resolve([SHARED]) }));
        jest.spyOn(scoringModule, 'calculateScoreV2').mockResolvedValue(7);

        await scoringModule.updateScores('regular', 1);

        // Ten rostered slots across the two managers. One request.
        expect(gameUrls).toHaveLength(1);
        expect(gameUrls[0]).toContain('/games/seasonType/regular/week/1/teams?');
        // The per-team route is what the N+1 used; it must not be reached.
        expect(gameUrls[0]).not.toMatch(/\/week\/1\/team\/\d/);
    });

    it('sends every rostered team id, deduplicated, and the season being scored', async () => {
        const { gameUrls } = mockFetch(() => Promise.resolve({ status: 200, json: () => Promise.resolve([SHARED]) }));
        jest.spyOn(scoringModule, 'calculateScoreV2').mockResolvedValue(0);

        await scoringModule.updateScores('regular', 1);

        const q = new URL(gameUrls[0]).searchParams;
        expect(q.get('ids').split(',').sort((a, b) => a - b)).toEqual(
            ['2', '3', '4', '5', '6', '7', '8', '9', '99', '333'].sort((a, b) => a - b));
        // Explicit, not left to the route's activeSeason() default: this pass
        // runs for minutes while the season cache re-primes every 60s.
        expect(q.get('season')).toBe('2025');
    });

    it('credits a game to BOTH managers who rostered a side of it', async () => {
        // The batched route answers the union deduplicated, so this game comes
        // back once. The per-team route returned it to each of them, and that
        // is the behaviour scoring still needs.
        const { patchBodies } = mockFetch(() => Promise.resolve({ status: 200, json: () => Promise.resolve([SHARED]) }));
        jest.spyOn(scoringModule, 'calculateScoreV2').mockResolvedValue(7);

        await scoringModule.updateScores('regular', 1);

        expect(patchBodies.uA.weeklyScore[0].scoreByTeam).toEqual(
            [{ team: 'Alabama', teamId: 333, gameId: 900, score: 7 }]);
        expect(patchBodies.uB.weeklyScore[0].scoreByTeam).toEqual(
            [{ team: 'Auburn', teamId: 99, gameId: 900, score: 7 }]);
    });

    it('throws on a failed batch instead of writing everyone a zero', async () => {
        // One shared request is one shared failure. The per-team loop it
        // replaced logged and carried on, costing that team its points; here an
        // empty map would score EVERY manager 0 and write those zeros over real
        // totals with clean job logs.
        const { patchBodies } = mockFetch(() =>
            Promise.resolve({ status: 500, json: () => Promise.resolve({ message: 'boom' }) }));

        await expect(scoringModule.updateScores('regular', 1))
            .rejects.toThrow(/Could not load week 1 games for scoring.*boom/);
        expect(patchBodies).toEqual({});
    });
});

// The batched route is asked in chunks of 200 ids, because it rejects more than
// that. With more than one chunk, a game whose two rostered teams land in
// DIFFERENT chunks comes back from BOTH requests — the first matches it on
// homeId, the second on awayId. Mapping each response as it arrived pushed that
// game onto both teams twice and doubled the week for both managers.
//
// models/game.js keeps a unique index on `id` for exactly this failure: "a
// second doc with the same id DOUBLES that team's score for the week."
// Duplicating in application code puts it back where that index cannot see it.
describe('updateScores does not double-count a game that spans two id chunks', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        process.env = { ...OLD_ENV, URL: 'http://test.local', YEAR: '2025' };
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

    it('credits a cross-chunk game exactly once to each side', async () => {
        // 201 distinct rostered ids forces two chunks. uA holds id 1 (chunk 1)
        // and uB holds id 500 (chunk 2); they play each other.
        const filler = Array.from({ length: 199 }, (_, i) => ({ id: i + 2, school: `T${i + 2}` }));
        const userA = {
            _id: 'uA', league: 'graham-league',
            seasons: [{ season: '2025', weeklyScore: [], teams: [{ id: 1, school: 'Alpha' }, ...filler] }],
        };
        const userB = {
            _id: 'uB', league: 'graham-league',
            seasons: [{ season: '2025', weeklyScore: [], teams: [{ id: 500, school: 'Omega' }] }],
        };
        const SHARED = { id: 900, homeId: 1, awayId: 500, homePoints: 28, awayPoints: 14, seasonType: 'regular' };

        const gameUrls = [];
        const patchBodies = {};
        global.fetch = jest.fn((url, opts) => {
            if (url.includes('/users/season/')) {
                return Promise.resolve({ status: 200, json: () => Promise.resolve([userA, userB]) });
            }
            if (url.includes('/scoring-config/')) {
                return Promise.resolve({ status: 200, json: () => Promise.resolve({ model: 'graham', values: {} }) });
            }
            if (url.includes('/games/')) {
                gameUrls.push(url);
                // Each chunk's query matches the shared game on its own side,
                // which is what Mongo really answers.
                const asked = new URL(url).searchParams.get('ids').split(',');
                const hit = asked.includes('1') || asked.includes('500');
                return Promise.resolve({ status: 200, json: () => Promise.resolve(hit ? [SHARED] : []) });
            }
            patchBodies[url.split('/users/')[1]] = JSON.parse(opts.body);
            return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
        });
        jest.spyOn(scoringModule, 'calculateScoreV2').mockResolvedValue(7);

        await scoringModule.updateScores('regular', 1);

        // Two chunks really were requested — otherwise this proves nothing.
        expect(gameUrls).toHaveLength(2);
        // One entry each, not two, and 7 points rather than 14.
        expect(patchBodies.uA.weeklyScore[0].scoreByTeam.filter(t => t.gameId === 900)).toHaveLength(1);
        expect(patchBodies.uB.weeklyScore[0].scoreByTeam).toHaveLength(1);
        expect(patchBodies.uA.weeklyScore[0].score).toBe(7);
        expect(patchBodies.uB.weeklyScore[0].score).toBe(7);
    });
});
