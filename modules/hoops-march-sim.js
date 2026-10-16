// The March estimate as a DISTRIBUTION, for the title-odds simulation
// (#310, PR 5 of the projection plan).
//
// modules/hoops-march.js gives a team's EXPECTED postseason points. That is
// what the projected finish needs, and the wrong thing to hold fixed in a
// Monte Carlo: March is all-or-nothing. A preseason #1 expects ~70 points of
// NCAA ladder, but the realised number is 7 (out in the first round) about a
// third of the time and 126 (champion) about a fifth of it. Football carries
// its postseason as one expected value plus a measured 15-point normal draw
// (standings-projection POSTSEASON_SD); for basketball a fixed value would
// treat a 126-point lottery ticket as already cashed, and a normal draw
// would misshape it — the spread is not symmetric and not the same for every
// team. So each team's March is SAMPLED, from the same reach probabilities
// the expected value is built from.
//
// ---- how one team is sampled ----
//
//   NCAA ladder   ONE uniform u per team per sim; the team reaches every rung
//                 whose (cumulative) reach probability exceeds u. The rungs
//                 are nested (reaching the Elite Eight means reaching the
//                 Sweet 16), so one draw gives exactly the round-reached
//                 distribution the expectation uses. A tournament under way
//                 ({ next: round }) samples the conditional ladder from that
//                 round, the way hoops-march remainingNcaa prices it.
//   First Four    its own coin (worth 0 by default).
//   upset bonus   expected upset points per expected tournament win, times
//                 the wins drawn — so a deep run carries its upsets with it.
//   conference    the title: a coin at P(title). The conference tournament's
//                 quadrant wins (confTourney, ~2.5 pts a pool team, 10.7 at
//                 #1): held at their expected value. Small next to the ladder,
//                 and one season of data is not enough to fit their spread.
//
// The sampled mean is the expected value hoops-march returns, exactly — the
// spec checks it across ranks and every decided state — so the projected
// finish and the simulated odds are built from the same number.
//
// ---- known simplifications ----
//
// Teams are drawn independently. Two teams on one roster can therefore both
// "win" the title in a sim, and two teams from one conference both take its
// tournament. Both events are rare for a single manager (they need two
// top-10 teams on one roster), and they only fatten the right tail a little.
// The draw is also independent of the simulated regular season, as
// football's is (see POSTSEASON_SD's caveat 2).

const { ROUNDS, valueOf } = require('./hoops-march');

const COND = { r64: 'ncaaR64', r32: 'ncaaR32', s16: 'ncaaS16', e8: 'ncaaE8', f4: 'ncaaF4', title: 'ncaaTitleGame', champ: 'ncaaChampion' };

// The distribution of one team's REMAINING postseason points.
//
// team, ctx, cfg, basis, decided: exactly expectedPostseason's arguments
// (`ctx` is the march conference context, attachMarch's confCtx). Throws
// where it throws — on a decided state it does not know.
function postseasonDistribution(model, team, ctx, cfg, basis, decided) {
    const d = decided || {};
    const exp = model.expectedPostseason(team, ctx, cfg, basis, d);
    const p = exp.reach;
    const rungs = [];
    let fixed = exp.confTourney, ff = null;
    const n = d.ncaa;
    if (n === undefined || n === null) {
        ROUNDS.forEach(r => rungs.push({ p: p[r], pts: valueOf(cfg, COND[r]), win: r !== 'r64' }));
        ff = { p: p.ff || 0, pts: valueOf(cfg, 'ncaaFirstFour') };
    } else if (typeof n === 'object') {
        // { next } — validated by expectedPostseason above.
        const from = n.next === 'ff' ? 'r64' : n.next;
        const scale = n.next === 'ff' ? 0.5 : 1;
        if (n.next === 'ff') fixed += valueOf(cfg, 'ncaaFirstFour');
        const base = p[from];
        ROUNDS.slice(ROUNDS.indexOf(from)).forEach((r, i) => rungs.push({
            p: base > 0 ? scale * p[r] / base : 0,
            pts: valueOf(cfg, COND[r]),
            // the First Four game itself is the win that reaches the r64
            win: i > 0 || n.next === 'ff'
        }));
    }
    // 'out' / 'done': no rungs.
    const expWins = rungs.reduce((s, x) => s + (x.win ? x.p : 0), 0);
    const upsetPerWin = expWins > 0 ? exp.upset / expWins : 0;
    const titleValue = valueOf(cfg, 'confTournamentTitle');
    const title = titleValue > 0 && exp.confChamp > 0 ? { p: exp.confChamp / titleValue, pts: titleValue } : null;
    return { expected: exp.postseason, fixed, rungs, ff, title, upsetPerWin };
}

// The mean of a distribution, analytically — what the sampler averages to.
function distributionMean(dist) {
    let m = dist.fixed;
    dist.rungs.forEach(r => { m += r.p * r.pts + (r.win ? r.p * dist.upsetPerWin : 0); });
    if (dist.ff) m += dist.ff.p * dist.ff.pts;
    if (dist.title) m += dist.title.p * dist.title.pts;
    return m;
}

// Its variance, analytically (for the PR's numbers and the spec).
function distributionVariance(dist) {
    // Ladder: comonotone rungs, so the outcome is "reached the first k".
    const sorted = dist.rungs;   // nested, in round order, p non-increasing
    let e1 = 0, e2 = 0, cum = 0, cumWins = 0;
    for (let k = 0; k <= sorted.length; k++) {
        const pk = (k === 0 ? 1 : sorted[k - 1].p) - (k < sorted.length ? sorted[k].p : 0);
        const v = cum + cumWins * dist.upsetPerWin;
        e1 += pk * v; e2 += pk * v * v;
        if (k < sorted.length) { cum += sorted[k].pts; cumWins += sorted[k].win ? 1 : 0; }
    }
    let variance = e2 - e1 * e1;
    if (dist.ff) variance += dist.ff.p * (1 - dist.ff.p) * dist.ff.pts ** 2;
    if (dist.title) variance += dist.title.p * (1 - dist.title.p) * dist.title.pts ** 2;
    return Math.max(0, variance);
}

// One draw. `rand` defaults to Math.random.
function samplePostseason(dist, rand = Math.random) {
    let total = dist.fixed, wins = 0;
    if (dist.rungs.length) {
        const u = rand();
        for (const r of dist.rungs) {
            if (!(u < r.p)) break;
            total += r.pts;
            if (r.win) wins++;
        }
    }
    if (dist.ff && rand() < dist.ff.p) total += dist.ff.pts;
    if (dist.title && rand() < dist.title.p) total += dist.title.pts;
    return total + wins * dist.upsetPerWin;
}

module.exports = { postseasonDistribution, distributionMean, distributionVariance, samplePostseason };
