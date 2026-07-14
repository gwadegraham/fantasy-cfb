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
});
