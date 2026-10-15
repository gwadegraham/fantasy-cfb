// The March estimate (modules/hoops-march.js): the fitted ladder, the
// preseason-to-March drift, conference titles, and how it plugs into the
// projection. Pure-unit. A hand-made calibration is used wherever a test
// needs exact numbers, so the shipped file can be refitted without breaking
// them; the shipped file gets its own sanity checks at the end.

const M = require('../modules/hoops-march');
const P = require('../modules/hoops-projection');
const { resolveConfig } = require('../modules/scoring-defaults');

const cfg = (over = {}) => resolveConfig('any-league', Object.assign({ model: 'hoops' }, over));

// A ladder where every rung is the same logistic in log rank.
const flat = (a, b) => [a, b];
const CAL = {
    march: {
        ff: flat(-4, 0), r64: flat(6, -1.5), r32: flat(2, -0.8), s16: flat(1.5, -0.8),
        e8: flat(1, -0.8), f4: flat(0.5, -0.8), title: flat(0.2, -0.8), champ: flat(0.1, -0.8)
    },
    drift: { a: 0.4, b: 0.9, sd: 0.4 },
    upsetSeeds: { bandwidth: 0.2, grid: [[1, 0], [10, 0.5], [40, 1], [365, 0]] },
    confTitleTemperature: 4,
    confTourneyWins: {
        q1: [[1, 2], [365, 0]], q2: [[1, 0.5], [365, 0]], q3: [[1, 0], [365, 0.5]], q4: [[1, 0], [365, 0.25]]
    }
};
const sig = (x) => 1 / (1 + Math.exp(-x));

describe('fitting helpers', () => {
    test('fitLogistic recovers a known line', () => {
        const rows = [];
        for (let x = -2; x <= 2; x += 0.25) {
            const p = sig(0.7 - 1.3 * x);
            for (let i = 0; i < 400; i++) rows.push({ x, y: i < Math.round(400 * p) ? 1 : 0 });
        }
        const [a, b] = M.fitLogistic(rows, 1);
        expect(a).toBeCloseTo(0.7, 1);
        expect(b).toBeCloseTo(-1.3, 1);
        expect(M.fitLogistic(rows, 2)).toHaveLength(3);
    });

    test('a rung with no positives stays finite', () => {
        const w = M.fitLogistic([{ x: 0, y: 0 }, { x: 1, y: 0 }], 1);
        w.forEach(v => expect(Number.isFinite(v)).toBe(true));
        expect(sig(w[0])).toBeLessThan(0.05);
    });

    test('kernelAt is a weighted mean, tabulate samples it on the grid', () => {
        const rows = [{ x: 0, y: 2 }, { x: 10, y: 8 }];
        expect(M.kernelAt(rows, 0, 0.5)).toBeCloseTo(2, 6);
        expect(M.kernelAt(rows, 5, 0.5)).toBeCloseTo(5, 6);
        expect(M.kernelAt([], 1, 1)).toBe(0);
        const grid = M.tabulate([{ x: Math.log(10), y: 3 }], 1);
        expect(grid.map(g => g[0])).toEqual(M.GRID);
        grid.forEach(([, v]) => expect(v).toBeCloseTo(3, 10));
    });

    test('interp is linear in log rank and clamps at the ends', () => {
        const grid = [[1, 0], [100, 10]];
        expect(M.interp(grid, 1)).toBe(0);
        expect(M.interp(grid, 10)).toBeCloseTo(5, 10);
        expect(M.interp(grid, 0.2)).toBe(0);
        expect(M.interp(grid, 500)).toBe(10);
    });

    test('fitDrift recovers a log-log line and its spread', () => {
        const pairs = [];
        for (let r = 1; r <= 200; r++) {
            const e = (r % 2 ? 1 : -1) * 0.3;
            pairs.push({ pre: r, end: Math.exp(0.5 + 0.8 * Math.log(r) + e) });
        }
        const d = M.fitDrift(pairs);
        expect(d.a).toBeCloseTo(0.5, 1);
        expect(d.b).toBeCloseTo(0.8, 1);
        expect(d.sd).toBeCloseTo(0.3, 1);
    });

    test('normCdf', () => {
        expect(M.normCdf(0)).toBeCloseTo(0.5, 6);
        expect(M.normCdf(1.96)).toBeCloseTo(0.975, 3);
        expect(M.normCdf(-1.96)).toBeCloseTo(0.025, 3);
        expect(M.normCdf(Infinity)).toBe(1);
        expect(M.normCdf(-Infinity)).toBe(0);
    });
});

describe('the ladder', () => {
    test('rungs are conditional, so each round is the product of those before it', () => {
        const p = M.reachFromCoef(CAL.march, 4);
        const x = Math.log(4);
        expect(p.r64).toBeCloseTo(sig(6 - 1.5 * x), 10);
        expect(p.r32).toBeCloseTo(p.r64 * sig(2 - 0.8 * x), 10);
        expect(p.champ).toBeCloseTo(p.title * sig(0.1 - 0.8 * x), 10);
        expect(p.ff).toBeCloseTo(sig(-4), 10);
        const order = M.ROUNDS.map(r => p[r]);
        order.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(order[i]));
    });

    test('expected points stack every rung, from the config', () => {
        const p = { ff: 0.5, r64: 1, r32: 0.5, s16: 0.25, e8: 0, f4: 0, title: 0, champ: 0 };
        const c = cfg({ values: { ncaaFirstFour: 2, ncaaR64: 10, ncaaR32: 20, ncaaS16: 40 } });
        expect(M.expectedNcaaPoints(p, c)).toBeCloseTo(0.5 * 2 + 10 + 10 + 10, 10);
        // A rung a league switched off pays nothing.
        const off = cfg({ values: { ncaaR64: 10, ncaaR32: 20, ncaaS16: 40 }, disabled: ['ncaaR32'] });
        expect(M.expectedNcaaPoints(p, off)).toBeCloseTo(10 + 10, 10);
        expect(M.valueOf(cfg(), 'noSuchRule')).toBe(0);
    });
});

describe('conference titles', () => {
    const teams = [
        { id: 1, conference: 'A', rating: 20 }, { id: 2, conference: 'A', rating: 10 },
        { id: 3, conference: 'A', rating: 0 }, { id: 4, conference: 'B', rating: -5 },
        { id: 5, conference: 'B', rating: null }, { id: 6, conference: null, rating: 9 }
    ];

    test('a softmax of rating / T within each conference', () => {
        const p = M.confTitleProbs(teams, 4);
        expect(p[1] + p[2] + p[3]).toBeCloseTo(1, 10);
        expect(p[1] / p[2]).toBeCloseTo(Math.exp(10 / 4), 8);
        expect(p[4]).toBe(1);
        expect(p[5]).toBeUndefined();
        expect(p[6]).toBeUndefined();
    });

    test('a hotter temperature flattens it toward uniform', () => {
        expect(M.confTitleProbs(teams, 1e6)[1]).toBeCloseTo(1 / 3, 4);
        expect(M.confTitleProbs(teams, 2)[1]).toBeGreaterThan(M.confTitleProbs(teams, 8)[1]);
    });
});

describe('buildMarchModel', () => {
    const model = M.buildMarchModel(CAL);

    test('the march basis is the ladder itself', () => {
        const p = model.reach(10, 'march');
        const direct = M.reachFromCoef(CAL.march, 10);
        M.ROUNDS.forEach(r => expect(p[r]).toBeCloseTo(direct[r], 12));
        expect(p.upsetSeeds).toBeCloseTo(0.5, 10);
        expect(model.reach(10, 'march')).toBe(p);   // cached
    });

    test('drift weights are a distribution centred where the drift says', () => {
        const w = model.driftWeights(20);
        expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
        const median = Math.exp(0.4 + 0.9 * Math.log(20));
        let cum = 0, k = 0;
        while (cum < 0.5) cum += w[k++];
        expect(Math.abs(k - median)).toBeLessThanOrEqual(1.5);
    });

    test('the drift is a reshuffle: every March rank is filled exactly once', () => {
        let col1 = 0, col200 = 0;
        for (let r = 1; r <= M.RANKS; r++) { col1 += model.driftWeights(r)[0]; col200 += model.driftWeights(r)[199]; }
        expect(col1).toBeCloseTo(1, 6);
        expect(col200).toBeCloseTo(1, 6);
        // So the league as a whole expects exactly the March ladder's total.
        let pre = 0, mar = 0;
        for (let r = 1; r <= M.RANKS; r++) { pre += model.reach(r, 'preseason').champ; mar += model.reach(r, 'march').champ; }
        expect(pre).toBeCloseTo(mar, 5);
    });

    test('reach objects are frozen, so no caller can poison the cache', () => {
        expect(Object.isFrozen(model.reach(5, 'march'))).toBe(true);
        expect(Object.isFrozen(model.reach(5, 'preseason'))).toBe(true);
    });

    test('the preseason basis is the ladder averaged over where a rank drifts', () => {
        const pre = model.reach(1, 'preseason'), mar = model.reach(1, 'march');
        // A preseason #1 is not certain to be a March #1, so it goes less deep.
        expect(pre.champ).toBeLessThan(mar.champ);
        expect(pre.r64).toBeLessThan(mar.r64);
        const w = model.driftWeights(1);
        const champ = w.reduce((s, wi, i) => s + wi * M.reachFromCoef(CAL.march, i + 1).champ, 0);
        expect(pre.champ).toBeCloseTo(champ, 8);
        // Out-of-range or missing ranks are the bottom of the country.
        expect(model.reach(undefined, 'preseason')).toBe(model.reach(M.RANKS, 'preseason'));
    });

    test('expectedPostseason prices every term through the config', () => {
        const ctx = model.contextFor([{ id: 7, conference: 'A', rating: 10 }, { id: 8, conference: 'A', rating: 0 }]);
        const c = cfg();
        const out = model.expectedPostseason({ id: 7, rank: 1 }, ctx, c, 'preseason');
        const p = model.reach(1, 'preseason');
        expect(out.ncaa).toBeCloseTo(M.expectedNcaaPoints(p, c), 10);
        expect(out.upset).toBeCloseTo(p.upsetSeeds * c.values.seedUpsetBonus, 10);
        expect(out.confChamp).toBeCloseTo(c.values.confTournamentTitle / (1 + Math.exp(-10 / 4)), 8);
        expect(out.confTourney).toBeCloseTo(2 * c.values.q1Win + 0.5 * c.values.q2Win, 8);
        expect(out.postseason).toBeCloseTo(out.ncaa + out.upset + out.confChamp + out.confTourney, 10);
        expect(out.makeProb).toBe(p.r64);

        const doubled = model.expectedPostseason({ id: 7, rank: 1 }, ctx, cfg({ values: { seedUpsetBonus: 2, confTournamentTitle: 20 } }), 'preseason');
        expect(doubled.upset).toBeCloseTo(2 * out.upset, 10);
        expect(doubled.confChamp).toBeCloseTo(2 * out.confChamp, 10);

        const off = model.expectedPostseason({ id: 7, rank: 1 }, ctx, cfg({ disabled: ['confTournamentTitle'] }), 'preseason');
        expect(off.confChamp).toBe(0);
    });

    test('on the march basis the conference tournament GAMES are banked, the title odds stay', () => {
        const ctx = model.contextFor([{ id: 9, conference: 'A', rating: 3 }, { id: 10, conference: 'A', rating: 1 }]);
        const out = model.expectedPostseason({ id: 9, rank: 30 }, ctx, cfg(), 'march');
        expect(out.confTourney).toBe(0);
        expect(out.confChamp).toBeGreaterThan(0);
        expect(out.ncaa).toBeGreaterThan(0);
    });

    test('a missing rank is the bottom of the country on every term', () => {
        const c = cfg();
        const bottom = model.expectedPostseason({ id: 1, rank: M.RANKS }, null, c);
        [null, 0, undefined, '', 'abc'].forEach(rank => {
            const out = model.expectedPostseason({ id: 1, rank }, null, c);
            expect(out.ncaa).toBeCloseTo(bottom.ncaa, 12);
            expect(out.confTourney).toBeCloseTo(bottom.confTourney, 12);
            expect(Number.isFinite(out.postseason)).toBe(true);
        });
        expect(model.expectedPostseason({ id: 1, rank: 9999 }, null, c).ncaa).toBeCloseTo(bottom.ncaa, 12);
    });
});

describe('attachMarch fills projectHoopsTeam’s postseason', () => {
    const teams = [
        { id: 1, conference: 'X', preseason: { rank: 3, barthag: 0.93, projectedRecord: '26-5', adjOE: 121, adjDE: 93 } },
        { id: 2, conference: 'X', preseason: { rank: 70, barthag: 0.62, projectedRecord: '17-14', adjOE: 108, adjDE: 102 } },
        { id: 3, conference: 'X', preseason: { rank: null, barthag: 0.3, projectedRecord: '9-22', adjOE: null, adjDE: 105 } }
    ];
    const c = cfg();
    const model = M.buildMarchModel(CAL);
    const ctx = M.attachMarch(P.buildHoopsPoolContext(teams, { ranks: { 1: 3, 2: 70, 3: 250 }, cfg: c }), teams, { model });
    const sched = [{ id: 1, week: 1, seasonType: 'regular', homeTeamId: 1, awayTeamId: 2, neutralSite: false }];

    test('total = regular + every postseason term', () => {
        const out = P.projectHoopsTeam(teams[0], sched, ctx);
        const post = model.expectedPostseason({ id: 1, rank: 3 }, ctx.march.confCtx, c, 'preseason');
        expect(out.ncaa).toBeCloseTo(post.ncaa, 10);
        expect(out.confTourney).toBeCloseTo(post.confTourney, 10);
        expect(out.postseason).toBeCloseTo(post.postseason, 10);
        expect(out.total).toBeCloseTo(out.regular + out.postseason, 10);
        expect(out.makeProb).toBe(post.makeProb);
        expect(out.regular).toBeGreaterThan(0);
    });

    test('a team with no rank gets no postseason, and no rating means no title odds', () => {
        const out = P.projectHoopsTeam(teams[2], sched, ctx);
        expect(out.postseason).toBe(0);
        expect(out.makeProb).toBeNull();
        expect(ctx.march.confCtx.titleProb[3]).toBeUndefined();
        // The two rated teams share the conference.
        expect(ctx.march.confCtx.titleProb[1] + ctx.march.confCtx.titleProb[2]).toBeCloseTo(1, 10);
    });

    test('a march-basis caller supplies its own ranks and ratings', () => {
        const c2 = M.attachMarch(P.buildHoopsPoolContext(teams, { cfg: c }), teams,
            { model, basis: 'march', rankById: { 1: 40 }, ratingById: { 1: 5, 2: 5 } });
        expect(c2.march.rankById).toEqual({ 1: 40 });
        expect(c2.march.confCtx.titleProb[1]).toBeCloseTo(0.5, 10);
        expect(P.projectHoopsTeam(teams[0], sched, c2).confTourney).toBe(0);
    });
});

describe('the shipped calibration', () => {
    const cal = require('../data/hoops-march-calibration.json');
    const model = M.defaultModel();

    test('documents where it came from', () => {
        expect(cal.provenance.sources.length).toBeGreaterThanOrEqual(3);
        expect(cal.provenance.seasons).not.toContain(2020);
        expect(model).toBe(M.defaultModel());
    });

    test('a better rank never expects fewer NCAA points, on either basis', () => {
        const c = cfg();
        ['march', 'preseason'].forEach(basis => {
            let last = Infinity;
            for (let r = 1; r <= M.RANKS; r += 4) {
                const e = M.expectedNcaaPoints(model.reach(r, basis), c);
                expect(e).toBeLessThanOrEqual(last + 1e-9);
                last = e;
            }
        });
    });

    test('the field adds up on both bases: about 64 main-bracket teams and one champion a season', () => {
        ['march', 'preseason'].forEach(basis => {
            let r64 = 0, f4 = 0, champ = 0;
            for (let r = 1; r <= M.RANKS; r++) { const p = model.reach(r, basis); r64 += p.r64; f4 += p.f4; champ += p.champ; }
            expect(r64).toBeGreaterThan(60);
            expect(r64).toBeLessThan(68);
            expect(f4).toBeGreaterThan(3.8);
            expect(f4).toBeLessThan(4.2);
            expect(champ).toBeGreaterThan(0.95);
            expect(champ).toBeLessThan(1.05);
        });
    });
});
