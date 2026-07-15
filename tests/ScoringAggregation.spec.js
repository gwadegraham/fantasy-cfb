const scoringModule = require('../modules/scoring.js');

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
                    return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
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
                    return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
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
