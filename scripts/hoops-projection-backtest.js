#!/usr/bin/env node
//
// Backtest of the basketball projection engine (modules/hoops-projection.js)
// against the 2025-26 season.
//
//   node scripts/hoops-projection-backtest.js [--data scripts/.dev-data/hoops-backtest]
//
// Reads ONLY local files — nothing here calls an API or touches a database.
// The inputs are gitignored raw pulls (see the PR for the exact calls):
//
//   torvik-tm-20251102.json   barttorvik.com/timemachine/team_results/
//                             20251102_team_results.json.gz — Torvik's ratings
//                             as published the day before 2025-26 tipped off.
//                             THE HONEST INPUT: it cannot know how the season
//                             went.
//   reg2026.json              CBBD /games, season 2026, seasonType regular
//                             (three date windows, de-duplicated by id)
//   ratings-adjusted-all.json CBBD /ratings/adjusted, every season. END of
//                             season: used only to approximate the ranks wins
//                             were banked at, and to measure hindsight.

const fs = require('fs');
const path = require('path');
const P = require('../modules/hoops-projection');
const { log5 } = require('../modules/hoops-win-prob');
const { resolveConfig } = require('../modules/scoring-defaults');
const { matchTeams } = require('../modules/torvik-pool');
const { weekOf, seasonStartFrom } = require('../modules/hoops-calendar');
const { blendRanks, blendWeight } = require('../modules/hoops-ranks');
const { isFinal } = require('../modules/hoops-scoring-pass');
const { evaluate } = require('../modules/scoring');
const { quadrantFor } = require('../modules/hoops-quadrants');

const argDir = process.argv.indexOf('--data');
const DIR = argDir === -1 ? path.join(__dirname, '.dev-data', 'hoops-backtest') : process.argv[argDir + 1];
const load = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

const cfg = resolveConfig('backtest', { model: 'hoops' });
const fmt = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x)) ? '—' : x.toFixed(d);

// ---------------------------------------------------------------- data ----

function loadSeason() {
    const adj = load('ratings-adjusted-all.json').filter(r => r.season === 2026);
    const teams = adj.map(r => ({ id: r.teamId, school: r.team, conference: r.conference }));
    const torvik = load('torvik-tm-20251102.json').map(r => ({
        rank: r[0], school: r[1], conference: r[2],
        adjOE: r[4], adjDE: r[6], barthag: r[8],
        projectedRecord: `${Math.round(r[10])}-${Math.round(r[11])}`,
        projW: r[10], projL: r[11]
    }));
    // St. Francis (PA) left D-I after 2025-26, so the shipped alias table
    // (built against 2027) does not carry it.
    torvik.forEach(r => { if (r.school === 'Saint Francis') r.school = 'St. Francis (PA)'; });
    const m = matchTeams(torvik, teams);
    if (m.unmatched.length || m.doubleClaimed.length) {
        console.error('match problems', JSON.stringify({ unmatched: m.unmatched, double: m.doubleClaimed }));
    }
    const pre = {};
    m.matched.forEach(({ team, rating }) => { pre[team.id] = rating; });

    // End-of-season rank by CBBD net rating, 1 = best.
    const endRank = {};
    [...adj].sort((a, b) => b.netRating - a.netRating).forEach((r, i) => { endRank[r.teamId] = i + 1; });
    const endNet = {};
    adj.forEach(r => { endNet[r.teamId] = r; });

    const raw = load('reg2026.json');
    const start = seasonStartFrom(raw.map(g => g.startDate).sort()[0]);
    const games = raw.map(g => Object.assign({}, g, { week: weekOf(g.startDate, start) }));

    const hoopsTeams = Object.keys(pre).map(id => ({
        id: Number(id), school: pre[id].school,
        preseason: { rank: pre[id].rank, barthag: pre[id].barthag, projectedRecord: pre[id].projectedRecord }
    }));
    const preRank = {};
    hoopsTeams.forEach(t => { preRank[t.id] = t.preseason.rank; });
    return { hoopsTeams, pre, preRank, endRank, endNet, games, matched: m.matched.length, unclaimed: m.unclaimed };
}

// ------------------------------------------------------------- metrics ----

function brier(rows) { return rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / rows.length; }
function logLoss(rows) {
    return -rows.reduce((s, r) => s + (r.y ? Math.log(r.p) : Math.log(1 - r.p)), 0) / rows.length;
}
function reliability(rows, edges = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]) {
    const out = [];
    for (let i = 0; i < edges.length - 1; i++) {
        const b = rows.filter(r => r.p >= edges[i] && r.p < edges[i + 1]);
        if (!b.length) continue;
        out.push({
            bucket: `${Math.round(edges[i] * 100)}-${Math.min(100, Math.round(edges[i + 1] * 100))}%`,
            n: b.length,
            predicted: b.reduce((s, r) => s + r.p, 0) / b.length,
            actual: b.reduce((s, r) => s + r.y, 0) / b.length
        });
    }
    return out;
}
// Logistic regression of the outcome on logit(p): slope 1 = calibrated,
// < 1 = overconfident. Newton's method on two parameters.
function calibrationSlope(rows) {
    let a = 0, b = 1;
    for (let it = 0; it < 50; it++) {
        let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
        for (const r of rows) {
            const x = P.logit(Math.min(1 - 1e-9, Math.max(1e-9, r.p)));
            const q = P.sigmoid(a + b * x);
            const w = q * (1 - q);
            ga += r.y - q; gb += (r.y - q) * x;
            haa += w; hab += w * x; hbb += w * x * x;
        }
        const det = haa * hbb - hab * hab;
        a += (hbb * ga - hab * gb) / det;
        b += (haa * gb - hab * ga) / det;
    }
    return { intercept: a, slope: b };
}
function corr(xs, ys) {
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
}

// ---------------------------------------------------------------- main ----

function main() {
    const S = loadSeason();
    const { hoopsTeams, pre, preRank, endRank, games } = S;
    console.log(`Torvik preseason matched to CBBD: ${S.matched} teams (unclaimed: ${S.unclaimed.join(', ') || 'none'})`);

    const rated = (id) => pre[id] !== undefined;
    const d1 = games.filter(g => isFinal(g) && rated(g.homeTeamId) && rated(g.awayTeamId));
    const regular = d1.filter(g => !P.isConfTournamentGame(g));
    console.log(`games: ${games.length} regular-season rows, ${d1.length} final D-I vs D-I, ${regular.length} excluding conference tournaments`);

    // ---- 1. home-court odds, by maximum likelihood on raw log5 ----
    const homeWon = (g) => Number(g.homePoints) > Number(g.awayPoints);
    const venueRows = (h, set) => set.map(g => {
        const v = g.neutralSite ? 'neutral' : 'home';
        return { p: P.teamWinProb(pre[g.homeTeamId].barthag, pre[g.awayTeamId].barthag, v, h), y: homeWon(g) ? 1 : 0, neutral: !!g.neutralSite };
    });
    console.log('\n## Home-court odds multiplier (raw log5, preseason barthag, home side)');
    console.log('| H | log loss | Brier |');
    console.log('|---|---|---|');
    let bestH = null;
    for (let h = 1.0; h <= 2.401; h += 0.1) {
        const rows = venueRows(h, d1);
        const ll = logLoss(rows);
        if (!bestH || ll < bestH.ll) bestH = { h, ll };
        if (Math.abs((h * 10) % 2) < 1e-6 || Math.abs(h - 1.4) < 1e-6 || Math.abs(h - 1.5) < 1e-6) console.log(`| ${h.toFixed(1)} | ${fmt(ll, 4)} | ${fmt(brier(rows), 4)} |`);
    }
    // finer grid around the best
    for (let h = bestH.h - 0.1; h <= bestH.h + 0.1; h += 0.01) {
        const ll = logLoss(venueRows(h, d1));
        if (ll < bestH.ll) bestH = { h, ll };
    }
    console.log(`best H = ${bestH.h.toFixed(2)} (log loss ${fmt(bestH.ll, 4)})`);
    const nonNeutral = d1.filter(g => !g.neutralSite);
    console.log(`home teams won ${(nonNeutral.filter(homeWon).length / nonNeutral.length * 100).toFixed(1)}% of ${nonNeutral.length} non-neutral games; `
        + `model at H=1.4 expected ${(venueRows(1.4, nonNeutral).reduce((s, r) => s + r.p, 0) / nonNeutral.length * 100).toFixed(1)}%, `
        + `at best H ${(venueRows(bestH.h, nonNeutral).reduce((s, r) => s + r.p, 0) / nonNeutral.length * 100).toFixed(1)}%`);
    // Split-half stability: fit on Nov-Dec, check on Jan-Mar.
    const early = d1.filter(g => g.startDate < '2026-01-01'), late = d1.filter(g => g.startDate >= '2026-01-01');
    const fitH = (set) => { let b = null; for (let h = 1.0; h <= 2.4; h += 0.01) { const ll = logLoss(venueRows(h, set)); if (!b || ll < b.ll) b = { h, ll }; } return b.h; };
    // Record against non-D-I opponents (NON_D1_WIN_RATE).
    let nonN = 0, nonW = 0;
    games.filter(isFinal).forEach(g => {
        const h = rated(g.homeTeamId), a = rated(g.awayTeamId);
        if (h === a) return;
        nonN++;
        if ((h && homeWon(g)) || (a && !homeWon(g))) nonW++;
    });
    console.log(`D-I teams against non-D-I opponents: ${nonW} of ${nonN} (${fmt(nonW / nonN, 3)})`);
    console.log(`split-half: best H on Nov-Dec = ${fitH(early).toFixed(2)}, on Jan-Mar = ${fitH(late).toFixed(2)}`);

    // Everything below uses H fitted on this same season, so it is in-sample
    // for H. Run with H=1.62 (the Nov-Dec-only fit) to see that it barely
    // matters: the log-loss curve is flat from 1.5 to 1.6.
    const H = Number(process.env.H || bestH.h.toFixed(2));

    // ---- 2. team-perspective probabilities: raw vs calibrated ----
    const ctx = P.buildHoopsPoolContext(hoopsTeams, { ranks: preRank, cfg, homeOdds: H });
    const byTeam = {};
    regular.forEach(g => {
        [g.homeTeamId, g.awayTeamId].forEach(id => { (byTeam[id] = byTeam[id] || []).push(g); });
    });
    // all scheduled regular games (final or not) per team for the full-season projection
    const schedByTeam = {};
    games.forEach(g => [g.homeTeamId, g.awayTeamId].forEach(id => { (schedByTeam[id] = schedByTeam[id] || []).push(g); }));

    // Probability-space shift for comparison: p + d, clamped, bisected.
    function probShift(probs, target) {
        const sumAt = (d) => probs.reduce((s, p) => s + Math.min(0.999, Math.max(0.001, p + d)), 0);
        let lo = -1, hi = 1;
        for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (sumAt(mid) < target) lo = mid; else hi = mid; }
        const d = (lo + hi) / 2;
        return probs.map(p => Math.min(0.999, Math.max(0.001, p + d)));
    }
    const variants = { raw: [], logit: [], prob: [], logitRawRate: [] };
    let rateSum = 0, rateN = 0;
    Object.keys(byTeam).forEach(id => {
        const team = { id: Number(id) };
        const sched = schedByTeam[id] || [];
        const gs = P.projectableGames(id, byTeam[id], ctx);
        const raw = gs.map(g => {
            const opp = Number(g.homeTeamId) === Number(id) ? g.awayTeamId : g.homeTeamId;
            return P.teamWinProb(ctx.barthagById[id], ctx.barthagById[opp], P.venueOfGame(id, g), H);
        });
        const y = gs.map(g => P.wonGame(id, g) ? 1 : 0);
        const rateD1 = P.d1WinRate(id, sched, ctx);
        // logit: the module as shipped (D-I rate, logit shift)
        const rawT = raw;
        const cal = P.calibrateProbs(rawT, rateD1 * gs.length).probs;
        // prob: same target, additive probability-space shift
        const ps = probShift(rawT, rateD1 * gs.length);
        // logitRawRate: the first version — Torvik's rate applied straight to D-I games
        const calRaw = P.calibrateProbs(raw, ctx.winRateById[id] * gs.length).probs;
        gs.forEach((g, i) => {
            variants.raw.push({ p: raw[i], y: y[i] });
            variants.logit.push({ p: cal[i], y: y[i] });
            variants.prob.push({ p: ps[i], y: y[i] });
            variants.logitRawRate.push({ p: calRaw[i], y: y[i] });
        });
        rateSum += ctx.winRateById[id]; rateN++;
    });
    console.log(`\n## Win probability, team's side, ${variants.raw.length} team-games (each D-I game twice), H=${H}`);
    console.log('| variant | Brier | log loss | calibration slope | intercept |');
    console.log('|---|---|---|---|---|');
    for (const [k, rows] of Object.entries(variants)) {
        const c = calibrationSlope(rows);
        console.log(`| ${k} | ${fmt(brier(rows), 4)} | ${fmt(logLoss(rows), 4)} | ${fmt(c.slope, 3)} | ${fmt(c.intercept, 3)} |`);
    }
    const base = variants.raw.reduce((s, r) => s + r.y, 0) / variants.raw.length;
    console.log(`(coin-flip Brier 0.2500; base rate ${fmt(base, 3)}; mean Torvik projected win rate ${fmt(rateSum / rateN, 3)})`);

    console.log('\n## Reliability (logit-calibrated)');
    console.log('| bucket | n | predicted | actual |');
    console.log('|---|---|---|---|');
    reliability(variants.logit).forEach(b => console.log(`| ${b.bucket} | ${b.n} | ${fmt(b.predicted, 3)} | ${fmt(b.actual, 3)} |`));

    // ---- 3. hindsight: the same model on END-of-season ratings ----
    const pyth = (r) => r.offensiveRating ** 11.5 / (r.offensiveRating ** 11.5 + r.defensiveRating ** 11.5);
    const endRows = d1.map(g => {
        const a = S.endNet[g.homeTeamId], b = S.endNet[g.awayTeamId];
        if (!a || !b) return null;
        return { p: P.teamWinProb(pyth(a), pyth(b), g.neutralSite ? 'neutral' : 'home', H), y: homeWon(g) ? 1 : 0 };
    }).filter(Boolean);
    const preRows = venueRows(H, d1);
    console.log('\n## Hindsight: preseason Torvik vs END-of-season CBBD ratings (home side, raw log5)');
    console.log(`preseason: Brier ${fmt(brier(preRows), 4)}, log loss ${fmt(logLoss(preRows), 4)}, slope ${fmt(calibrationSlope(preRows).slope, 3)}`);
    console.log(`end-of-season: Brier ${fmt(brier(endRows), 4)}, log loss ${fmt(logLoss(endRows), 4)}, slope ${fmt(calibrationSlope(endRows).slope, 3)}`);

    // ---- 4. season points: projected (preseason) vs actual ----
    // "Actual" is what the league WOULD have banked: each final win scored by
    // the real engine at the opponent's rank in that week. Weekly ranks for
    // 2025-26 were never stored, so they are approximated by hoops-ranks'
    // own blend from preseason Torvik into END-of-season CBBD.
    const weeks = [...new Set(games.map(g => g.week))];
    const rankByWeek = {};
    weeks.forEach(w => { rankByWeek[w] = blendRanks(preRank, endRank, blendWeight(w)); });
    const rows = [];
    hoopsTeams.forEach(t => {
        const id = String(t.id);
        const sched = schedByTeam[id] || [];
        const proj = P.projectHoopsTeam(t, sched, ctx, { perGame: true });
        // Projected with END ranks for points-if-win (isolates win-prob error from rank drift).
        // The same win probabilities, each game graded at the rank the
        // "actual" column banks it at — isolates win-probability error from
        // rank drift.
        const projEndRanks = { regular: proj.perGame.reduce((s, pg) => {
            const g = sched.find(x => x.id === pg.gameId);
            return s + pg.winProb * P.pointsIfWin(t.id, g, rankByWeek[g.week], cfg);
        }, 0) };
        const played = P.projectableGames(id, sched, ctx).filter(isFinal);
        let actual = 0, wins = 0;
        played.forEach(g => {
            if (!P.wonGame(id, g)) return;
            wins++;
            actual += evaluate('hoops', t.id, g, rankByWeek[g.week], cfg);
        });
        // Conference tournament games this projection leaves out, as banked.
        let confT = 0;
        sched.filter(g => isFinal(g) && P.isConfTournamentGame(g) && P.wonGame(id, g)).forEach(g => {
            confT += evaluate('hoops', t.id, g, rankByWeek[g.week], cfg);
        });
        rows.push({ id, rank: t.preseason.rank, proj: proj.regular, projEnd: projEndRanks.regular, projWins: proj.projWins, actual, wins, n: played.length, confT });
    });
    const report = (label, set) => {
        const err = set.map(r => r.proj - r.actual);
        const mae = err.reduce((s, e) => s + Math.abs(e), 0) / set.length;
        const bias = err.reduce((s, e) => s + e, 0) / set.length;
        const rmse = Math.sqrt(err.reduce((s, e) => s + e * e, 0) / set.length);
        const winsMae = set.reduce((s, r) => s + Math.abs(r.projWins - r.wins), 0) / set.length;
        const winsBias = set.reduce((s, r) => s + r.projWins - r.wins, 0) / set.length;
        const errEnd = set.map(r => r.projEnd - r.actual);
        const biasEnd = errEnd.reduce((a, e) => a + e, 0) / set.length;
        const maeEnd = errEnd.reduce((s, e) => s + Math.abs(e), 0) / set.length;
        const meanA = set.reduce((s, r) => s + r.actual, 0) / set.length;
        const meanP = set.reduce((s, r) => s + r.proj, 0) / set.length;
        const confT = set.reduce((s, r) => s + r.confT, 0) / set.length;
        console.log(`| ${label} | ${set.length} | ${fmt(meanP, 1)} | ${fmt(meanA, 1)} | ${fmt(bias, 2)} | ${fmt(mae, 2)} | ${fmt(rmse, 2)} | ${fmt(corr(set.map(r => r.proj), set.map(r => r.actual)), 3)} | ${fmt(maeEnd, 2)} (bias ${fmt(biasEnd, 2)}) | ${fmt(winsMae, 2)} (bias ${fmt(winsBias, 2)}) | ${fmt(confT, 2)} |`);
    };
    console.log('\n## Regular-season points: preseason projection vs banked (approx.)');
    console.log('| teams | n | mean proj | mean actual | bias | MAE | RMSE | r | MAE if banked ranks known | wins MAE | conf-tourney pts left out |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    report('pool (rank 1-120)', rows.filter(r => r.rank <= 120));
    report('rank 1-40', rows.filter(r => r.rank <= 40));
    report('rank 41-80', rows.filter(r => r.rank > 40 && r.rank <= 80));
    report('rank 81-120', rows.filter(r => r.rank > 80 && r.rank <= 120));
    report('all D-I', rows);

    // Where the points bias comes from: pool teams' win rate by quadrant,
    // every game graded on END-of-season ranks.
    console.log('\n## Pool teams by quadrant (graded on END-of-season ranks)');
    console.log('| quadrant | games | projected win rate | actual win rate |');
    console.log('|---|---|---|---|');
    const qd = { 1: [0, 0, 0], 2: [0, 0, 0], 3: [0, 0, 0], 4: [0, 0, 0] };
    hoopsTeams.filter(t => t.preseason.rank <= 120).forEach(t => {
        const id = String(t.id), sched = schedByTeam[id] || [];
        const gs = P.projectableGames(id, sched, ctx);
        P.projectHoopsTeam(t, sched, ctx, { perGame: true }).perGame.forEach((pg, i) => {
            const g = gs[i];
            if (!isFinal(g)) return;
            const opp = Number(g.homeTeamId) === t.id ? g.awayTeamId : g.homeTeamId;
            const q = quadrantFor(endRank[opp], P.venueOfGame(t.id, g));
            qd[q][0]++; qd[q][1] += pg.winProb; qd[q][2] += P.wonGame(id, g) ? 1 : 0;
        });
    });
    [1, 2, 3, 4].forEach(q => console.log(`| Q${q} | ${qd[q][0]} | ${fmt(qd[q][1] / qd[q][0], 3)} | ${fmt(qd[q][2] / qd[q][0], 3)} |`));

    // ---- 5. remaining-wins blend constant K ----
    console.log('\n## Remaining-wins blend: K (games for reality to earn half the say)');
    console.log('| K | MAE remaining wins | bias |');
    console.log('|---|---|---|');
    const ks = [0, 3, 5, 7, 10, 15, 20, 30, 1e9];
    for (const K of ks) {
        let absErr = 0, sumErr = 0, n = 0;
        hoopsTeams.forEach(t => {
            const id = String(t.id);
            const sched = P.projectableGames(id, schedByTeam[id] || [], ctx).filter(isFinal)
                .sort((a, b) => a.startDate < b.startDate ? -1 : 1);
            const rate = P.d1WinRate(id, schedByTeam[id] || [], ctx);
            for (const w of weeks) {
                const done = sched.filter(g => g.week < w), rem = sched.filter(g => g.week >= w);
                if (!rem.length || !done.length) continue;
                const wins = done.filter(g => P.wonGame(id, g)).length;
                const target = P.remainingWinsTarget(rate, done.length, wins, rem.length, K);
                const actual = rem.filter(g => P.wonGame(id, g)).length;
                absErr += Math.abs(target - actual); sumErr += target - actual; n++;
            }
        });
        console.log(`| ${K >= 1e9 ? 'inf (preseason only)' : K} | ${fmt(absErr / n, 3)} | ${fmt(sumErr / n, 3)} |`);
    }
}

if (require.main === module) main();

module.exports = { loadSeason, load, brier, logLoss, reliability, calibrationSlope, corr, DIR };
