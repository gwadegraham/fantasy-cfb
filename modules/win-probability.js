// Pure, I/O-free probability helpers for the draft-grade projection
// (modules/draft-projection.js). Kept separate so they're trivially unit-tested.
//
// SP+ is a points-scale rating (expected scoring margin vs. an average team), so
// the principled win-probability mapping is a normal CDF of the predicted
// margin. σ ≈ 16.5 is the empirical standard deviation of a college-football
// game's result vs. its prediction (a 3-pt favorite ≈ 57%, 10-pt ≈ 73%,
// 17-pt ≈ 85%). HFA in SP+ space is ~2.5 points.

const DEFAULT_SIGMA = 16.5;

// Abramowitz & Stegun 7.1.26 erf approximation (max error ~1.5e-7).
function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
}

// Standard normal CDF.
function normCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
}

// P(win) from a predicted point margin (already including HFA). Clamped just
// inside (0,1) so downstream logs/products never hit exactly 0 or 1.
function marginToWinProb(margin, sigma = DEFAULT_SIGMA) {
    if (!isFinite(margin)) return 0.5;
    const p = normCdf(margin / (sigma || DEFAULT_SIGMA));
    return Math.min(0.999, Math.max(0.001, p));
}

// Calibrate a team's per-game win probs to a trusted projected win total by
// finding the single additive margin shift δ such that Σ Φ((margin_i + δ)/σ)
// equals `expectedWins`. Additive (not multiplicative) keeps every prob in
// (0,1) and absorbs systematic rating staleness (e.g. 2025 SP+ used for 2026).
//
// margins: array of predicted margins (team − opp + HFA), one per game.
// Returns { probs, delta }. If expectedWins is null/undefined, returns the raw
// (δ=0) probs so callers can no-op gracefully.
function calibrateToExpectedWins(margins, expectedWins, sigma = DEFAULT_SIGMA) {
    const raw = margins.map(m => marginToWinProb(m, sigma));
    if (expectedWins == null || !margins.length) return { probs: raw, delta: 0 };

    const target = Math.min(margins.length - 1e-6, Math.max(1e-6, expectedWins));
    const sumAt = (delta) => margins.reduce((s, m) => s + marginToWinProb(m + delta, sigma), 0);

    // Σ is monotonically increasing in δ; bisect on a wide margin range.
    let lo = -80, hi = 80;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (sumAt(mid) < target) lo = mid; else hi = mid;
    }
    const delta = (lo + hi) / 2;
    return { probs: margins.map(m => marginToWinProb(m + delta, sigma)), delta };
}

// Poisson-binomial distribution: P(exactly k wins) for k = 0..n given
// independent per-game win probs. Returns an array of length n+1.
function winTotalDistribution(probs) {
    let dist = [1];
    for (const p of probs) {
        const next = new Array(dist.length + 1).fill(0);
        for (let k = 0; k < dist.length; k++) {
            next[k] += dist[k] * (1 - p);
            next[k + 1] += dist[k] * p;
        }
        dist = next;
    }
    return dist;
}

// P(win total >= k) from a Poisson-binomial distribution.
function pAtLeast(dist, k) {
    let s = 0;
    for (let i = k; i < dist.length; i++) s += dist[i];
    return s;
}

module.exports = {
    DEFAULT_SIGMA,
    erf,
    normCdf,
    marginToWinProb,
    calibrateToExpectedWins,
    winTotalDistribution,
    pAtLeast
};
