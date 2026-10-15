// The March estimate: expected POSTSEASON fantasy points for a basketball
// team, from its rank (#310, PR 2 of the projection engine). The basketball
// counterpart of the cfp + confChamp + bowl terms in draft-projection's
// projectTeamPoints, and plugged into modules/hoops-projection.js the same way.
//
// Four terms, each priced through the league's own config:
//
//   ncaa         Σ P(reach round) × that rung's points (the ladder stacks)
//   upset        expected seeds-of-upset × seedUpsetBonus
//   confChamp    P(conference tournament title) × confTournamentTitle
//   confTourney  expected conference-tournament QUADRANT wins × q-values —
//                real games against real opponents that the regular-season
//                projection leaves out
//
// Pure. The fitted numbers live in data/hoops-march-calibration.json, which
// scripts/hoops-march-backtest.js writes from local pulls and documents.
//
// ---- two bases ----
//
// 'march'      the rank is a pre-Selection-Sunday rank. The ladder is fit on
//              8 tournaments (2015-16, 2019, 2021-22, 2024-26; CBBD's stored
//              ratings for 2014, 2017, 2018 and 2023 are corrupt and are
//              dropped — see the backtest) against an "S-curve" rank:
//              CBBD's end-of-season net rank, with the NCAA field re-dealt
//              into its own rank slots in SEED order. CBBD's season rating
//              includes the tournament, so ranking on it raw hands the
//              champion the #1 slot after the fact — fitted that way, a #1
//              wins the title 42% of the time; on the S-curve, 38%. Seeds
//              (and the Elo that breaks ties within a seed line) are known
//              before tip-off, so the S-curve top is honest. 38% still
//              rests on 8 champions, all of whom were top-8 on the S-curve.
// 'preseason'  the rank is a preseason Torvik rank — what the draft has. A
//              preseason #5 is not a March #5: the March ladder is averaged
//              over where a preseason rank ends up by March, a lognormal
//              drift measured on 2025-26 (the only season with an archived
//              preseason file, so the drift is in-sample by necessity).
//
// ---- smoothing ----
//
// Per-rank raw rates would be noise: twelve tournaments give each rank twelve
// draws. Each ladder rung is a logistic in log(rank), fitted CONDITIONALLY —
// P(reach round k | reached k-1) — so the cumulative ladder can never rise
// from one round to the next. Quadratic in log(rank) for the rungs with
// hundreds of events (to the Elite Eight), linear for the Final Four, title
// game and title (32, 16 and 8 events), where a quadratic can let a #2
// out-win a #1. Leave-one-season-out it has the best log loss of the four
// candidates (0.0815, against 0.0818 quadratic, 0.0819 linear and 0.0850
// for raw rank buckets) — see the PR for the table.

const { ruleEnabled, STRUCTURES } = require('./scoring-defaults');

const ROUNDS = ['r64', 'r32', 's16', 'e8', 'f4', 'title', 'champ'];
const POINTS_KEY = {
    ff: 'ncaaFirstFour', r64: 'ncaaR64', r32: 'ncaaR32', s16: 'ncaaS16',
    e8: 'ncaaE8', f4: 'ncaaF4', title: 'ncaaTitleGame', champ: 'ncaaChampion'
};
const RANKS = 365;   // D-I teams; the drift integrates over March ranks 1..RANKS

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// A rule's points under a config, 0 when the league has switched it off.
function valueOf(cfg, condition) {
    const rule = STRUCTURES.hoops.postseason.concat(STRUCTURES.hoops.regularWin).find(r => r.condition === condition);
    if (!rule || !ruleEnabled(rule, cfg.disabled, cfg.enabled)) return 0;
    return Number(cfg.values[rule.pointsKey]) || 0;
}

// ---- fitting helpers (used by the backtest; pure) ----

// Logistic regression of y on [1, x, x², …] by Newton's method, with a tiny
// ridge so a rung with no positives (or all) cannot run off to infinity.
function fitLogistic(rows, degree = 1) {
    const k = degree + 1;
    const feats = (x) => Array.from({ length: k }, (_, i) => x ** i);
    let w = new Array(k).fill(0);
    for (let it = 0; it < 100; it++) {
        const g = new Array(k).fill(0);
        const H = Array.from({ length: k }, () => new Array(k).fill(0));
        for (const r of rows) {
            const f = feats(r.x);
            const p = sigmoid(f.reduce((s, fi, i) => s + fi * w[i], 0));
            for (let i = 0; i < k; i++) {
                g[i] += (r.y - p) * f[i];
                for (let j = 0; j < k; j++) H[i][j] += p * (1 - p) * f[i] * f[j];
            }
        }
        for (let i = 0; i < k; i++) { g[i] -= 1e-3 * w[i]; H[i][i] += 1e-3; }
        const step = solve(H, g);
        w = w.map((wi, i) => wi + step[i]);
        if (Math.max(...step.map(Math.abs)) < 1e-9) break;
    }
    return w;
}

// Gaussian elimination for the small systems above.
function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
        [M[c], M[piv]] = [M[piv], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
        }
    }
    return M.map((row, i) => row[n] / row[i]);
}

// Nadaraya-Watson: a Gaussian-weighted mean of y around x.
function kernelAt(rows, x, bw) {
    let num = 0, den = 0;
    for (const r of rows) {
        const w = Math.exp(-0.5 * ((r.x - x) / bw) ** 2);
        num += w * r.y; den += w;
    }
    return den ? num / den : 0;
}

// The ranks a smoothed curve is stored at; interp() fills between them in
// log-rank.
const GRID = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75, 90, 110, 130, 160, 200, 250, 300, 365];
function tabulate(rows, bw) {
    return GRID.map(r => [r, kernelAt(rows, Math.log(r), bw)]);
}
function interp(grid, rank) {
    const r = Math.min(grid[grid.length - 1][0], Math.max(grid[0][0], Number(rank)));
    // r is clamped into the grid, so a segment always contains it.
    const i = Math.max(1, grid.findIndex(g => r <= g[0]));
    const [r0, v0] = grid[i - 1], [r1, v1] = grid[i];
    const t = (Math.log(r) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
    return v0 + t * (v1 - v0);
}

// log(March rank) = a + b·log(preseason rank) + N(0, sd²), by least squares.
function fitDrift(pairs) {
    const xs = pairs.map(p => Math.log(p.pre)), ys = pairs.map(p => Math.log(p.end));
    const n = xs.length, mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    const b = sxy / sxx, a = my - b * mx;
    const sd = Math.sqrt(xs.reduce((s, x, i) => s + (ys[i] - a - b * x) ** 2, 0) / (n - 2));
    return { a, b, sd };
}

// ---- the ladder ----

// Cumulative reach probabilities at a rank from the conditional rungs.
// { ff, r64, r32, s16, e8, f4, title, champ }; each round ≤ the one before.
function reachFromCoef(coef, rank) {
    const x = Math.log(Math.max(1, Number(rank)));
    const at = (w) => sigmoid(w.reduce((s, wi, i) => s + wi * x ** i, 0));
    const out = { ff: at(coef.ff) };
    let p = 1;
    ROUNDS.forEach(r => { p *= at(coef[r]); out[r] = p; });
    return out;
}

// Σ P(reach) × points, through the league's config. The First Four rung is
// worth 0 by default, and only a First Four team can collect it.
function expectedNcaaPoints(reach, cfg) {
    let pts = (reach.ff || 0) * valueOf(cfg, 'ncaaFirstFour');
    const cond = { r64: 'ncaaR64', r32: 'ncaaR32', s16: 'ncaaS16', e8: 'ncaaE8', f4: 'ncaaF4', title: 'ncaaTitleGame', champ: 'ncaaChampion' };
    ROUNDS.forEach(r => { pts += (reach[r] || 0) * valueOf(cfg, cond[r]); });
    return pts;
}

// ---- conference titles ----

// P(title) per team: a softmax of rating / T within each conference.
// teams: [{ id, conference, rating }] — rating on an efficiency-margin scale
// (Torvik AdjOE − AdjDE). A team with no conference or rating gets nothing.
function confTitleProbs(teams, T) {
    const denom = {};
    // NOT Number.isFinite(Number(x)) alone: Number(null) is 0, which would
    // enter an unrated team as an exactly-average one.
    const ok = (t) => t.conference && t.rating !== null && t.rating !== undefined && t.rating !== ''
        && Number.isFinite(Number(t.rating));
    (teams || []).forEach(t => {
        if (!ok(t)) return;
        denom[t.conference] = (denom[t.conference] || 0) + Math.exp(Number(t.rating) / T);
    });
    const out = {};
    (teams || []).forEach(t => { if (ok(t)) out[String(t.id)] = Math.exp(Number(t.rating) / T) / denom[t.conference]; });
    return out;
}

// ---- the model ----

function buildMarchModel(cal) {
    const cache = { march: new Map(), preseason: new Map() };

    // The raw lognormal row: where preseason rank r lands in March.
    function lognormalRow(rank) {
        const mu = cal.drift.a + cal.drift.b * Math.log(Math.max(1, rank));
        const w = [];
        let total = 0;
        for (let k = 1; k <= RANKS; k++) {
            // mass of log-rank in [log(k - 0.5), log(k + 0.5)]
            const lo = k === 1 ? -Infinity : (Math.log(k - 0.5) - mu) / cal.drift.sd;
            const hi = k === RANKS ? Infinity : (Math.log(k + 0.5) - mu) / cal.drift.sd;
            const m = normCdf(hi) - normCdf(lo);
            w.push(m); total += m;
        }
        return w.map(m => m / total);
    }

    // P(March rank = k | preseason rank r) as a DOUBLY stochastic matrix.
    //
    // Raw lognormal rows each sum to 1, but nothing makes every March rank
    // land on exactly one team: the top ranks are under-filled (a preseason
    // #1 can only drift down, a #300 rarely drifts to #1), and summed over
    // D-I the preseason basis paid out 0.83 champions a season instead of 1.
    // Sinkhorn balancing — alternately scaling rows and columns to 1 — keeps
    // the measured shape while making it a proper reshuffle of the 365 ranks,
    // so the whole league's expected tournament is exactly one tournament.
    let matrix = null;
    function driftMatrix() {
        if (matrix) return matrix;
        const W = [];
        for (let r = 1; r <= RANKS; r++) W.push(lognormalRow(r));
        for (let it = 0; it < 500; it++) {
            let worst = 0;
            for (let k = 0; k < RANKS; k++) {
                let col = 0;
                for (let r = 0; r < RANKS; r++) col += W[r][k];
                for (let r = 0; r < RANKS; r++) W[r][k] /= col;
            }
            for (let r = 0; r < RANKS; r++) {
                let row = 0;
                for (let k = 0; k < RANKS; k++) row += W[r][k];
                worst = Math.max(worst, Math.abs(row - 1));
                for (let k = 0; k < RANKS; k++) W[r][k] /= row;
            }
            if (worst < 1e-9) break;
        }
        matrix = W;
        return W;
    }
    const driftWeights = (rank) => driftMatrix()[Math.round(Math.max(1, Math.min(RANKS, rank))) - 1];

    function reach(rank, basis = 'preseason') {
        const r = Math.round(Math.max(1, Math.min(RANKS, Number(rank) || RANKS)));
        const c = cache[basis === 'march' ? 'march' : 'preseason'];
        if (c.has(r)) return c.get(r);
        let out;
        if (basis === 'march') out = Object.assign(reachFromCoef(cal.march, r), { upsetSeeds: interp(cal.upsetSeeds.grid, r) });
        else {
            out = { ff: 0, r64: 0, r32: 0, s16: 0, e8: 0, f4: 0, title: 0, champ: 0, upsetSeeds: 0 };
            driftWeights(r).forEach((w, i) => {
                if (w < 1e-12) return;
                const m = reachFromCoef(cal.march, i + 1);
                Object.keys(m).forEach(k => { out[k] += w * m[k]; });
                out.upsetSeeds += w * interp(cal.upsetSeeds.grid, i + 1);
            });
        }
        // Frozen: the object is shared by every caller through the cache.
        Object.freeze(out);
        c.set(r, out);
        return out;
    }

    // Conference title odds for a pool of teams, built once.
    function contextFor(teams) {
        return { titleProb: confTitleProbs(teams, cal.confTitleTemperature) };
    }

    // { confChamp, confTourney, ncaa, upset, postseason, makeProb } for one
    // team. team: { id, rank }. On the 'march' basis the conference
    // tournaments are taken to be in the past (banked), so confTourney is 0;
    // confChamp stays, for the caller to drop once titles are decided.
    function expectedPostseason(team, ctx, cfg, basis = 'preseason') {
        // One clamped rank for every term. A missing rank reads as the bottom
        // of the country — NOT Number(null) = 0, which interp would clamp to
        // #1 and pay a top team's conference tournament.
        const n = Number(team.rank);
        const rank = (team.rank === null || team.rank === undefined || team.rank === '' || !Number.isFinite(n) || n < 1)
            ? RANKS : Math.min(RANKS, Math.round(n));
        const p = reach(rank, basis);
        const ncaa = expectedNcaaPoints(p, cfg);
        const upset = p.upsetSeeds * valueOf(cfg, 'seedUpsetBonus');
        const pTitle = (ctx && ctx.titleProb && ctx.titleProb[String(team.id)]) || 0;
        const confChamp = pTitle * valueOf(cfg, 'confTournamentTitle');
        let confTourney = 0;
        if (basis !== 'march') {
            [1, 2, 3, 4].forEach(q => {
                confTourney += interp(cal.confTourneyWins[`q${q}`], rank) * valueOf(cfg, `q${q}Win`);
            });
        }
        return {
            confChamp, confTourney, ncaa, upset,
            postseason: confChamp + confTourney + ncaa + upset,
            // P(a main-bracket game), football's makeProb.
            makeProb: p.r64, reach: p
        };
    }

    return { reach, contextFor, expectedPostseason, driftWeights };
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26, as win-probability.js).
function normCdf(z) {
    if (z === Infinity) return 1;
    if (z === -Infinity) return 0;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return 0.5 * (1 + (z < 0 ? -y : y));
}

// The shipped model, from the committed calibration file. Lazy, so the pure
// helpers above load without it.
let shipped = null;
function defaultModel() {
    if (!shipped) shipped = buildMarchModel(require('../data/hoops-march-calibration.json'));
    return shipped;
}

// Give a projection context (hoops-projection buildHoopsPoolContext) the
// March estimate, so projectHoopsTeam fills its postseason terms.
//
// teams: the season's HoopsTeam rows. On the 'preseason' basis each team's
// rank is its preseason.rank and its conference-title rating is Torvik's
// AdjOE − AdjDE; a caller on the 'march' basis passes its own rankById (a
// pre-Selection-Sunday rank) and may pass ratingById.
function attachMarch(ctx, teams, { basis = 'preseason', model = defaultModel(), rankById, ratingById } = {}) {
    const ranks = {}, pool = [];
    (teams || []).forEach(t => {
        const id = String(t.id), pre = t.preseason || {};
        const rank = rankById ? rankById[id] : pre.rank;
        if (Number.isFinite(Number(rank)) && Number(rank) > 0) ranks[id] = Number(rank);
        const rating = ratingById ? ratingById[id]
            : (Number.isFinite(Number(pre.adjOE)) && Number.isFinite(Number(pre.adjDE)) && pre.adjOE !== null && pre.adjDE !== null
                ? Number(pre.adjOE) - Number(pre.adjDE) : null);
        pool.push({ id: t.id, conference: t.conference, rating });
    });
    ctx.march = { model, basis, rankById: ranks, confCtx: model.contextFor(pool) };
    return ctx;
}

module.exports = {
    attachMarch,
    ROUNDS, POINTS_KEY, GRID, RANKS,
    fitLogistic, kernelAt, tabulate, interp, fitDrift,
    reachFromCoef, expectedNcaaPoints, confTitleProbs, valueOf, normCdf,
    buildMarchModel, defaultModel
};
