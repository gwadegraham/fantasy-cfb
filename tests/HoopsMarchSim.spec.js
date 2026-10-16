// March as a distribution (#310 PR 5): what the title-odds simulation draws
// a team's postseason from. Its mean must be the March estimate's expected
// value exactly — the projected finish and the simulated odds read the same
// number — and its shape must be March's: mostly nothing, sometimes a lot.

const { defaultModel } = require('../modules/hoops-march');
const { postseasonDistribution, distributionMean, distributionVariance, samplePostseason } = require('../modules/hoops-march-sim');
const { resolveConfig } = require('../modules/scoring-defaults');

const model = defaultModel();
const cfg = resolveConfig('x', { model: 'hoops' });
const ctx = model.contextFor([{ id: 1, conference: 'BE', rating: 25 }, { id: 2, conference: 'BE', rating: 10 }]);

// A seeded generator, so the sampling checks are deterministic.
function lcg(seed) {
    let s = seed;
    return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const STATES = [
    {}, { confTourney: { wins: 1, alive: true } }, { confTourney: 'over' },
    { ncaa: { next: 'ff' } }, { ncaa: { next: 'r64' } }, { ncaa: { next: 's16' } }, { ncaa: { next: 'title' } },
    { ncaa: 'out' }, { ncaa: 'done' }
];

describe('the mean is the March estimate', () => {
    test('across ranks, bases and every decided state', () => {
        [1, 3, 10, 40, 120, 365].forEach(rank => ['preseason', 'march'].forEach(basis => STATES.forEach(decided => {
            const exp = model.expectedPostseason({ id: 1, rank }, ctx, cfg, basis, decided);
            const d = postseasonDistribution(model, { id: 1, rank }, ctx, cfg, basis, decided);
            expect(distributionMean(d)).toBeCloseTo(exp.postseason, 9);
            expect(d.expected).toBeCloseTo(exp.postseason, 9);
        })));
    });

    test('with First Four and upset values switched up, too', () => {
        const rich = resolveConfig('x', { model: 'hoops', values: { ncaaFirstFour: 4, seedUpsetBonus: 3 } });
        [{}, { ncaa: { next: 'ff' } }, { ncaa: { next: 'e8' } }].forEach(decided => {
            const exp = model.expectedPostseason({ id: 2, rank: 60 }, ctx, rich, 'preseason', decided);
            expect(distributionMean(postseasonDistribution(model, { id: 2, rank: 60 }, ctx, rich, 'preseason', decided)))
                .toBeCloseTo(exp.postseason, 9);
        });
    });

    test('the sampler averages to it (seeded)', () => {
        const d = postseasonDistribution(model, { id: 1, rank: 4 }, ctx, cfg, 'preseason', {});
        const rand = lcg(7);
        let sum = 0, sq = 0;
        const N = 200000;
        for (let i = 0; i < N; i++) { const x = samplePostseason(d, rand); sum += x; sq += x * x; }
        const mean = sum / N;
        expect(mean).toBeCloseTo(distributionMean(d), 0);
        expect(Math.sqrt(sq / N - mean * mean)).toBeCloseTo(Math.sqrt(distributionVariance(d)), 0);
    });
});

describe("March's shape", () => {
    test('a top team: a wide spread, nowhere near a fixed number', () => {
        const d = postseasonDistribution(model, { id: 1, rank: 1 }, ctx, cfg, 'preseason', {});
        // ~40 points of standard deviation on a ~75-point mean. Football's
        // whole-manager allowance is 15.
        expect(Math.sqrt(distributionVariance(d))).toBeGreaterThan(30);
        // A champion's run is the whole ladder: 7+9+12+16+21+26+35.
        expect(samplePostseason(d, () => 0)).toBeGreaterThanOrEqual(126);
        // Out in the first round: the r64 appearance, and no more. (u sits
        // between the r64 and r32 reach, and above the title and First Four
        // coins, which the same stub feeds.)
        const u = (d.rungs[0].p + d.rungs[1].p) / 2;
        expect(u).toBeGreaterThan(d.title.p);
        expect(samplePostseason(d, () => u) - d.fixed).toBeCloseTo(7, 9);
    });

    test('a decided tournament has no NCAA variance left', () => {
        ['out', 'done'].forEach(ncaa => {
            const d = postseasonDistribution(model, { id: 1, rank: 1 }, ctx, cfg, 'preseason', { ncaa });
            expect(d.rungs).toEqual([]);
            expect(distributionVariance(d)).toBe(0);
            expect(samplePostseason(d, Math.random)).toBe(0);
        });
    });

    test('a team in the Final Four only draws the last two rungs', () => {
        const d = postseasonDistribution(model, { id: 1, rank: 1 }, ctx, cfg, 'march', { ncaa: { next: 'f4' } });
        expect(d.rungs.map(r => r.pts)).toEqual([21, 26, 35]);
        expect(d.rungs[0].p).toBe(1);          // certain to play the Final Four
        expect(samplePostseason(d, () => 0.999999)).toBe(21);
    });

    test('a deep run carries its upsets with it', () => {
        const rich = resolveConfig('x', { model: 'hoops', values: { seedUpsetBonus: 3 } });
        const d = postseasonDistribution(model, { id: 2, rank: 60 }, ctx, rich, 'march', { ncaa: { next: 'f4' } });
        expect(d.upsetPerWin).toBeGreaterThan(0);
        // Champion from the Final Four: three rungs, two wins.
        expect(samplePostseason(d, () => 0)).toBeCloseTo(21 + 26 + 35 + 2 * d.upsetPerWin, 9);
    });

    test('a First Four team: the play-in rung is fixed, the round of 64 a coin', () => {
        const d = postseasonDistribution(model, { id: 2, rank: 60 }, ctx, cfg, 'march', { ncaa: { next: 'ff' } });
        expect(d.rungs[0]).toMatchObject({ p: 0.5, pts: 7, win: true });
    });

    test('the conference title is a coin at its probability, and only while alive', () => {
        const open = postseasonDistribution(model, { id: 1, rank: 5 }, ctx, cfg, 'preseason', {});
        expect(open.title.pts).toBe(10);
        expect(open.title.p).toBeCloseTo(ctx.titleProb['1'], 12);
        expect(postseasonDistribution(model, { id: 1, rank: 5 }, ctx, cfg, 'preseason', { confTourney: 'over' }).title).toBeNull();
    });

    test('an unknown decided state throws, as the March estimate does', () => {
        expect(() => postseasonDistribution(model, { id: 1, rank: 5 }, ctx, cfg, 'preseason', { ncaa: 'in' })).toThrow(TypeError);
    });
});
