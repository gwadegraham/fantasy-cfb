#!/usr/bin/env node
//
// Calibrates and backtests the basketball March estimate
// (modules/hoops-march.js) and writes data/hoops-march-calibration.json.
//
//   node scripts/hoops-march-backtest.js            # report only
//   node scripts/hoops-march-backtest.js --write    # also rewrite the data file
//
// Reads ONLY local, gitignored pulls in scripts/.dev-data/hoops-backtest/ —
// nothing here calls an API or touches a database:
//
//   ncaa-all.json, ncaa-2015on.json   CBBD /games?tournament=NCAA (seeds, rounds)
//   ratings-adjusted-all.json         CBBD /ratings/adjusted, 2014-2026, END of season
//   reg2026.json, torvik-tm-20251102.json   see scripts/hoops-projection-backtest.js

const fs = require('fs');
const path = require('path');
const BT = require('./hoops-projection-backtest');
const M = require('../modules/hoops-march');
const P = require('../modules/hoops-projection');
const { ncaaRoundFor } = require('../modules/hoops-detectors');
const { isFinal } = require('../modules/hoops-scoring-pass');
const { quadrantFor } = require('../modules/hoops-quadrants');
const { resolveConfig } = require('../modules/scoring-defaults');
const { blendRanks, blendWeight } = require('../modules/hoops-ranks');

const cfg = resolveConfig('backtest', { model: 'hoops' });
const fmt = (x, d = 3) => (x === null || x === undefined || !Number.isFinite(x)) ? '—' : x.toFixed(d);
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026];
const ROUNDS = M.ROUNDS;   // ['r64','r32','s16','e8','f4','title','champ']

// ------------------------------------------------------------ tournaments --

// 2014 and 2015 name the rounds the old way: the First Four was the "1st
// Round", the round of 64 the "2nd", the round of 32 the "3rd".
function roundOf(g) {
    if (g.season <= 2015) {
        const label = String(g.gameNotes || '').split(' - ').pop().trim().toLowerCase();
        return { '1st round': 'ff', '2nd round': 'r64', '3rd round': 'r32' }[label] || ncaaRoundFor(g);
    }
    return ncaaRoundFor(g);
}

const ORDER = ['ff', 'r64', 'r32', 's16', 'e8', 'f4', 'title'];

function tournaments() {
    const games = BT.load('ncaa-all.json').filter(g => g.season === 2014).concat(BT.load('ncaa-2015on.json'));
    const out = {};   // season -> teamId -> { seed, deepest, champ, upset, games: [] }
    for (const g of games) {
        const r = roundOf(g);
        if (!r) continue;   // 2021's uncontested VCU-Oregon game
        const s = (out[g.season] = out[g.season] || {});
        for (const side of ['home', 'away']) {
            const id = g[`${side}TeamId`], other = side === 'home' ? 'away' : 'home';
            const t = (s[id] = s[id] || { seed: g[`${side}Seed`], deepest: -1, ff: false, champ: false, upset: 0, games: [] });
            const idx = ORDER.indexOf(r);
            if (r === 'ff') t.ff = true;
            if (idx > t.deepest) t.deepest = idx;
            const won = g[`${side}Points`] > g[`${other}Points`];
            if (won && r === 'title') t.champ = true;
            if (won) t.upset += Math.max(0, g[`${side}Seed`] - g[`${other}Seed`]);
            t.games.push({ won, margin: g[`${side}Points`] - g[`${other}Points`], opp: g[`${other}TeamId`] });
        }
    }
    // A First Four loser never reaches the round of 64; a winner does, by
    // playing in it. 2017's feed is missing two First Four games, which only
    // ever drops a 0-point rung.
    return out;
}

// reached(t, round) for the ladder
function reached(t, round) {
    if (!t) return false;
    if (round === 'champ') return t.champ;
    return t.deepest >= ORDER.indexOf(round);
}

// ------------------------------------------------------------ ratings -----

function seasonRatings() {
    const adj = BT.load('ratings-adjusted-all.json');
    const by = {};
    adj.forEach(r => { (by[r.season] = by[r.season] || []).push(r); });
    return by;
}

// Rank 1 = best, by a numeric field.
function rankBy(rows, key) {
    const out = {};
    [...rows].sort((a, b) => b[key] - a[key]).forEach((r, i) => { out[r.teamId] = i + 1; });
    return out;
}

// END-of-season net rating with the tournament taken back out.
//
// CBBD's season ratings include the NCAA games, so a champion's rating has
// six extra wins in it — the hindsight this backtest has to bound. Each
// tournament game's performance is approximated as the scoring margin per
// 100 possessions (68 a game, roughly D-I average) plus the opponent's net
// rating, and removed from a season average over ~32 regular games.
const PACE = 68, REG_GAMES = 32;
function deHindsight(rows, tourney) {
    const net = {};
    rows.forEach(r => { net[r.teamId] = r.netRating; });
    return rows.map(r => {
        const t = tourney[r.teamId];
        if (!t) return Object.assign({}, r, { preNet: r.netRating });
        const perfs = t.games.map(g => g.margin * 100 / PACE + (net[g.opp] || 0));
        const n = REG_GAMES + perfs.length;
        const preNet = (n * r.netRating - perfs.reduce((a, b) => a + b, 0)) / REG_GAMES;
        return Object.assign({}, r, { preNet });
    });
}

// The committee's order, dropped into the slots the field occupies.
//
// Seeds are announced BEFORE the tournament, so they are the one honest
// ordering of the field there is. Every non-tournament team keeps its
// end-of-season rank (it played no NCAA games for hindsight to come from);
// the tournament teams are re-dealt into the rank slots they jointly hold,
// best seed first, ties within a seed line broken by the de-hindsighted
// rating. The result is a full 1..N ranking whose top is pre-tournament.
function scurveRank(rows, tourney) {
    const end = rankBy(rows, 'netRating');
    const pre = {};
    deHindsight(rows, tourney).forEach(r => { pre[r.teamId] = r.preNet; });
    const field = rows.filter(r => tourney[r.teamId]).map(r => r.teamId);
    const slots = field.map(id => end[id]).sort((a, b) => a - b);
    field.sort((a, b) => (tourney[a].seed - tourney[b].seed) || (pre[b] - pre[a]));
    const out = Object.assign({}, end);
    field.forEach((id, i) => { out[id] = slots[i]; });
    return out;
}

// ------------------------------------------------------------- fitting ----

// Rows for the conditional chain: P(reach round k | reached k-1, rank).
function chainRows(dataset, round) {
    const k = ROUNDS.indexOf(round);
    const prev = k === 0 ? null : ROUNDS[k - 1];
    return dataset
        .filter(d => prev === null || reached(d.t, prev))
        .map(d => ({ x: Math.log(d.rank), y: reached(d.t, round) ? 1 : 0 }));
}

// degree: a number, or 'mixed' — quadratic for the rungs with hundreds of
// events (First Four to Elite Eight), linear for the three with 48, 24 and 12.
const LATE = ['f4', 'title', 'champ'];
function fitChain(dataset, degree) {
    const deg = (r) => degree === 'mixed' ? (LATE.includes(r) ? 1 : 2) : degree;
    const coef = {};
    ROUNDS.forEach(r => { coef[r] = M.fitLogistic(chainRows(dataset, r), deg(r)); });
    coef.ff = M.fitLogistic(dataset.map(d => ({ x: Math.log(d.rank), y: d.t && d.t.ff ? 1 : 0 })), deg('ff'));
    return coef;
}

// Raw bucketed rates, the thing smoothing has to beat.
const BUCKETS = [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 1e9];
function fitBuckets(dataset) {
    const out = {};
    const bucketOf = (rank) => BUCKETS.findIndex(b => rank <= b);
    [...ROUNDS, 'ff'].forEach(r => {
        const n = new Array(BUCKETS.length).fill(0), y = new Array(BUCKETS.length).fill(0);
        dataset.forEach(d => {
            const b = bucketOf(d.rank);
            n[b]++; if (r === 'ff' ? (d.t && d.t.ff) : reached(d.t, r)) y[b]++;
        });
        out[r] = n.map((c, i) => c ? (y[i] + 0.01) / (c + 0.02) : 0.001);
    });
    return { reach: (rank) => {
        const b = bucketOf(rank);
        const o = {}; [...ROUNDS, 'ff'].forEach(r => { o[r] = out[r][b]; }); return o;
    } };
}

function datasetFor(seasons, rankKey, T, R) {
    const rows = [];
    for (const s of seasons) {
        const rk = rankKey === 'scurve' ? scurveRank(R[s], T[s] || {})
            : rankKey === 'pre' ? rankBy(deHindsight(R[s], T[s] || {}), 'preNet') : rankBy(R[s], 'netRating');
        R[s].forEach(r => rows.push({ season: s, id: r.teamId, rank: rk[r.teamId], t: (T[s] || {})[r.teamId] || null }));
    }
    return rows;
}

// Points actually banked in the tournament, from the ladder (not the upset).
function actualNcaa(t) {
    if (!t) return 0;
    let pts = t.ff ? cfg.values.ncaaFirstFour : 0;
    ROUNDS.forEach(r => { if (reached(t, r)) pts += cfg.values[M.POINTS_KEY[r]]; });
    return pts;
}

function evalModel(name, reachOf, test) {
    let ll = 0, n = 0, absErr = 0, sumE = 0, sumA = 0;
    const top = { e: 0, a: 0 };
    test.forEach(d => {
        const p = reachOf(d.rank);
        [...ROUNDS, 'ff'].forEach(r => {
            const y = r === 'ff' ? (d.t && d.t.ff ? 1 : 0) : (reached(d.t, r) ? 1 : 0);
            const q = Math.min(1 - 1e-9, Math.max(1e-9, p[r]));
            ll -= y ? Math.log(q) : Math.log(1 - q); n++;
        });
        const e = M.expectedNcaaPoints(p, cfg), a = actualNcaa(d.t);
        absErr += Math.abs(e - a); sumE += e; sumA += a;
        if (d.rank <= 16) { top.e += e; top.a += a; }
    });
    return { name, ll: ll / n, mae: absErr / test.length, sumE, sumA, top };
}

// --------------------------------------------------------------- main -----

function main() {
    const write = process.argv.includes('--write');
    const T = tournaments(), R = seasonRatings();
    const all = datasetFor(SEASONS, 'end', T, R);

    console.log(`seasons: ${SEASONS.join(', ')} (no 2020 tournament); ${all.length} team-seasons, `
        + `${all.filter(d => d.t).length} tournament appearances`);

    // ---- 1. smoothing choice, leave-one-season-out ----
    const cands = {
        'raw buckets': (train) => fitBuckets(train).reach,
        'logistic chain, linear log-rank': (train) => { const c = fitChain(train, 1); return (r) => M.reachFromCoef(c, r); },
        'logistic chain, quadratic log-rank': (train) => { const c = fitChain(train, 2); return (r) => M.reachFromCoef(c, r); },
        'logistic chain, quadratic to E8, linear after': (train) => { const c = fitChain(train, 'mixed'); return (r) => M.reachFromCoef(c, r); }
    };
    const datasets = { end: all, scurve: datasetFor(SEASONS, 'scurve', T, R) };
    for (const [basis, data] of Object.entries(datasets)) {
        console.log(`\n## Round-reach model, leave-one-season-out (${basis === 'end' ? 'END-of-season rank' : 'S-curve rank (shipped basis)'})`);
        console.log('| model | log loss / outcome | NCAA pts MAE / team | Σ expected | Σ actual | top-16 Σ exp | top-16 Σ act |');
        console.log('|---|---|---|---|---|---|---|');
        for (const [name, fit] of Object.entries(cands)) {
            const agg = { ll: 0, mae: 0, sumE: 0, sumA: 0, te: 0, ta: 0, n: 0 };
            SEASONS.forEach(s => {
                const train = data.filter(d => d.season !== s), test = data.filter(d => d.season === s);
                const r = evalModel(name, fit(train), test);
                agg.ll += r.ll; agg.mae += r.mae; agg.sumE += r.sumE; agg.sumA += r.sumA; agg.te += r.top.e; agg.ta += r.top.a; agg.n++;
            });
            console.log(`| ${name} | ${fmt(agg.ll / agg.n, 4)} | ${fmt(agg.mae / agg.n, 3)} | ${fmt(agg.sumE, 0)} | ${fmt(agg.sumA, 0)} | ${fmt(agg.te, 0)} | ${fmt(agg.ta, 0)} |`);
        }
    }

    const degree = process.env.DEGREE ? Number(process.env.DEGREE) : 'mixed';
    const coefEnd = fitChain(all, degree);
    const preAll = datasets.scurve;
    const coefPre = fitChain(preAll, degree);
    const coefDeh = fitChain(datasetFor(SEASONS, 'pre', T, R), degree);

    // ---- 2. hindsight ----
    console.log(`\n## Hindsight: the ladder fitted on three rank sources (degree ${degree})`);
    console.log('end = CBBD end-of-season (knows the tournament); S-curve = seeds dealt into the field\'s slots (shipped); removed = tournament games subtracted from the rating');
    console.log('| rank | P(S16) end / S-curve / removed | P(F4) | P(champ) | E[NCAA pts] |');
    console.log('|---|---|---|---|---|');
    [1, 2, 4, 8, 16, 25, 40, 60, 100].forEach(rank => {
        const a = M.reachFromCoef(coefEnd, rank), b = M.reachFromCoef(coefPre, rank), c = M.reachFromCoef(coefDeh, rank);
        const tri = (k, d) => `${fmt(a[k], d)} / ${fmt(b[k], d)} / ${fmt(c[k], d)}`;
        console.log(`| ${rank} | ${tri('s16', 3)} | ${tri('f4', 3)} | ${tri('champ', 3)} | ${fmt(M.expectedNcaaPoints(a, cfg), 1)} / ${fmt(M.expectedNcaaPoints(b, cfg), 1)} / ${fmt(M.expectedNcaaPoints(c, cfg), 1)} |`);
    });
    // Elo at tip-off is a pre-tournament number by construction.
    const games = BT.load('ncaa-all.json').filter(g => g.season === 2014).concat(BT.load('ncaa-2015on.json'));
    const firstElo = {};
    games.sort((a, b) => a.startDate < b.startDate ? -1 : 1).forEach(g => {
        for (const side of ['home', 'away']) {
            const k = `${g.season}:${g[`${side}TeamId`]}`;
            if (firstElo[k] === undefined) firstElo[k] = g[`${side}TeamEloStart`];
        }
    });
    const conc = (rankFn) => {
        let n = 0, f4 = 0, champ = 0;
        SEASONS.forEach(s => {
            const field = Object.keys(T[s]).map(Number);
            const ordered = rankFn(s, field);
            ordered.slice(0, 8).forEach(id => { n++; if (reached(T[s][id], 'f4')) f4++; if (T[s][id].champ) champ++; });
        });
        return `${f4} of ${SEASONS.length * 4} Final Four spots, ${champ} of ${SEASONS.length} titles`;
    };
    const endRankOf = {}, preRankOf = {}, scRankOf = {};
    SEASONS.forEach(s => { endRankOf[s] = rankBy(R[s], 'netRating'); preRankOf[s] = rankBy(deHindsight(R[s], T[s]), 'preNet'); scRankOf[s] = scurveRank(R[s], T[s]); });
    console.log(`\nThe 8 best teams in each field went on to take:`);
    console.log(`- by END-of-season CBBD rank: ${conc((s, f) => f.sort((a, b) => endRankOf[s][a] - endRankOf[s][b]))}`);
    console.log(`- tournament removed:        ${conc((s, f) => f.sort((a, b) => preRankOf[s][a] - preRankOf[s][b]))}`);
    console.log(`- by Elo at first tip-off:    ${conc((s, f) => f.sort((a, b) => (firstElo[`${s}:${b}`] || 0) - (firstElo[`${s}:${a}`] || 0)))}`);
    console.log(`- by S-curve rank (shipped):   ${conc((s, f) => f.sort((a, b) => scRankOf[s][a] - scRankOf[s][b]))}`);

    // ---- 3. upset bonus ----
    console.log('\n## Upset bonus (seeds of difference per team-season), kernel-smoothed on log rank');
    const upsetRows = (set) => set.map(d => ({ x: Math.log(d.rank), y: d.t ? d.t.upset : 0 }));
    console.log('| bandwidth | LOSO mean sq. error |');
    console.log('|---|---|');
    let bestBw = null;
    [0.15, 0.25, 0.35, 0.5, 0.75].forEach(bw => {
        let se = 0, n = 0;
        SEASONS.forEach(s => {
            const train = upsetRows(preAll.filter(d => d.season !== s));
            preAll.filter(d => d.season === s).forEach(d => {
                const e = M.kernelAt(train, Math.log(d.rank), bw);
                se += (e - (d.t ? d.t.upset : 0)) ** 2; n++;
            });
        });
        if (!bestBw || se / n < bestBw.mse) bestBw = { bw, mse: se / n };
        console.log(`| ${bw} | ${fmt(se / n, 4)} |`);
    });
    const upsetGrid = M.tabulate(upsetRows(preAll), bestBw.bw);
    console.log(`chosen ${bestBw.bw}. Expected seeds of upset at rank: ` + [1, 10, 25, 40, 60, 100].map(r => `${r}: ${fmt(M.interp(upsetGrid, r), 2)}`).join(', '));

    // ---- 4. preseason -> March drift (2026) ----
    const S = BT.loadSeason();
    const endRank26 = rankBy(R[2026], 'netRating');
    const preRank26 = scurveRank(R[2026], T[2026]);
    const pairs = S.hoopsTeams.map(t => ({ pre: t.preseason.rank, end: preRank26[t.id] })).filter(p => p.end);
    const drift = M.fitDrift(pairs);
    console.log(`\n## Preseason Torvik rank -> March rank (2025-26, ${pairs.length} teams)`);
    console.log(`log(March rank) = ${fmt(drift.a, 3)} + ${fmt(drift.b, 3)} * log(preseason rank), residual sd ${fmt(drift.sd, 3)}`);
    const q = (r) => { const m = Math.exp(drift.a + drift.b * Math.log(r)); return `${r} -> median ${fmt(m, 0)}, 80% ${fmt(m * Math.exp(-1.2816 * drift.sd), 0)}-${fmt(m * Math.exp(1.2816 * drift.sd), 0)}`; };
    console.log([1, 10, 40, 100].map(q).join('; '));

    // ---- 5. conference title (2026) ----
    const reg = BT.load('reg2026.json');
    const finals = reg.filter(g => isFinal(g) && g.conferenceGame && !String(g.tournament || '').trim()
        && /\b(championship|tournament|playoffs?)\b/i.test(g.gameNotes || '')
        && /^(final|championship)$/i.test(String(g.gameNotes).split(' - ').pop().trim()));
    const champs = {};
    finals.forEach(g => { champs[g.homePoints > g.awayPoints ? g.homeTeamId : g.awayTeamId] = true; });
    const confOf = {};
    R[2026].forEach(r => { confOf[r.teamId] = r.conference; });
    const confTeams = S.hoopsTeams.map(t => ({ id: t.id, conference: confOf[t.id], rating: S.pre[t.id].adjOE - S.pre[t.id].adjDE }));
    const llConf = (Tc, teams) => {
        const p = M.confTitleProbs(teams, Tc);
        let ll = 0, n = 0;
        Object.keys(champs).forEach(id => { if (p[id] !== undefined) { ll += Math.log(p[id]); n++; } });
        return { ll, n };
    };
    console.log(`\n## Conference tournament title, softmax on preseason Torvik AdjEM (2025-26, ${finals.length} finals)`);
    console.log('| temperature | log-likelihood of the 31 champions |');
    console.log('|---|---|');
    let bestT = null;
    [2, 3, 4, 5, 6, 8, 10, 15, 1e6].forEach(Tc => {
        const { ll } = llConf(Tc, confTeams);
        if (!bestT || ll > bestT.ll) bestT = { T: Tc, ll };
        console.log(`| ${Tc >= 1e6 ? 'uniform' : Tc} | ${fmt(ll, 2)} |`);
    });
    for (let Tc = Math.max(1, bestT.T - 2); Tc <= bestT.T + 2; Tc += 0.25) {
        const { ll } = llConf(Tc, confTeams);
        if (ll > bestT.ll) bestT = { T: Tc, ll };
    }
    const pTitle = M.confTitleProbs(confTeams, bestT.T);
    const favs = {};
    confTeams.forEach(t => { if (!favs[t.conference] || pTitle[t.id] > pTitle[favs[t.conference]]) favs[t.conference] = t.id; });
    const favP = Object.values(favs).reduce((s, id) => s + pTitle[id], 0);
    const favWon = Object.values(favs).filter(id => champs[id]).length;
    console.log(`best T = ${bestT.T} (log-lik ${fmt(bestT.ll, 2)}). Preseason favourites: expected ${fmt(favP, 1)} titles, won ${favWon}.`);

    // ---- 6. conference tournament quadrant wins (2026, by preseason rank) ----
    const weeks = {};
    const start = reg.map(g => g.startDate).sort()[0];
    const { weekOf, seasonStartFrom } = require('../modules/hoops-calendar');
    const ss = seasonStartFrom(start);
    const rankByWeek = (w) => (weeks[w] = weeks[w] || blendRanks(S.preRank, endRank26, blendWeight(w)));
    const ctRows = { 1: [], 2: [], 3: [], 4: [] };
    S.hoopsTeams.forEach(t => {
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
        reg.filter(g => (g.homeTeamId === t.id || g.awayTeamId === t.id) && isFinal(g) && P.isConfTournamentGame(g) && P.wonGame(t.id, g))
            .forEach(g => {
                const opp = g.homeTeamId === t.id ? g.awayTeamId : g.homeTeamId;
                counts[quadrantFor(rankByWeek(weekOf(g.startDate, ss))[opp], P.venueOfGame(t.id, g))]++;
            });
        [1, 2, 3, 4].forEach(qd => ctRows[qd].push({ x: Math.log(t.preseason.rank), y: counts[qd] }));
    });
    // Bandwidth by leave-one-team-out error on the points those wins bank.
    const qv = [0, cfg.values.q1Win, cfg.values.q2Win, cfg.values.q3Win, cfg.values.q4Win];
    console.log('\n## Conference tournament quadrant points: bandwidth, leave-one-team-out');
    console.log('| bandwidth | mean sq. error (pts) |');
    console.log('|---|---|');
    let ctBw = null;
    [0.15, 0.25, 0.35, 0.5, 0.75, 1.0].forEach(bw => {
        let se = 0;
        const n = ctRows[1].length;
        for (let i = 0; i < n; i++) {
            let e = 0, a = 0;
            [1, 2, 3, 4].forEach(qd => {
                const rest = ctRows[qd].filter((_, j) => j !== i);
                e += qv[qd] * M.kernelAt(rest, ctRows[qd][i].x, bw);
                a += qv[qd] * ctRows[qd][i].y;
            });
            se += (e - a) ** 2;
        }
        if (!ctBw || se / n < ctBw.mse) ctBw = { bw, mse: se / n };
        console.log(`| ${bw} | ${fmt(se / n, 3)} |`);
    });
    const ctGrid = {};
    [1, 2, 3, 4].forEach(qd => { ctGrid[`q${qd}`] = M.tabulate(ctRows[qd], ctBw.bw); });
    console.log(`\n## Conference tournament wins by quadrant, by preseason rank (2025-26, kernel bw ${ctBw.bw})`);
    console.log('| preseason rank | Q1 | Q2 | Q3 | Q4 | expected pts |');
    console.log('|---|---|---|---|---|---|');
    [1, 10, 25, 50, 80, 120].forEach(r => {
        const w = [1, 2, 3, 4].map(qd => M.interp(ctGrid[`q${qd}`], r));
        const pts = w[0] * cfg.values.q1Win + w[1] * cfg.values.q2Win + w[2] * cfg.values.q3Win + w[3] * cfg.values.q4Win;
        console.log(`| ${r} | ${w.map(x => fmt(x, 2)).join(' | ')} | ${fmt(pts, 2)} |`);
    });

    // ---- the calibration file ----
    const calibration = {
        provenance: {
            built: 'node scripts/hoops-march-backtest.js --write',
            sources: [
                'CBBD /games?tournament=NCAA&seasonType=postseason (2014-2026, no 2020): seeds, rounds, results',
                'CBBD /ratings/adjusted (2014-2026, end of season): netRating, re-ordered within the NCAA field by seed (scurveRank)',
                'barttorvik.com/timemachine/team_results/20251102_team_results.json.gz: 2025-26 preseason T-Rank',
                'CBBD /games season=2026 seasonType=regular: 2025-26 conference tournaments'
            ],
            seasons: SEASONS,
            note: 'March rank = the S-curve rank: CBBD end-of-season net rank, with the NCAA field re-dealt into its own slots in seed order (ties by rating with the tournament games removed). See scripts/hoops-march-backtest.js scurveRank.'
        },
        degree,
        march: Object.fromEntries(Object.entries(coefPre).map(([k, v]) => [k, v.map(x => Number(x.toFixed(5)))])),
        drift: { a: Number(drift.a.toFixed(4)), b: Number(drift.b.toFixed(4)), sd: Number(drift.sd.toFixed(4)) },
        upsetSeeds: { bandwidth: bestBw.bw, grid: upsetGrid.map(([r, v]) => [r, Number(v.toFixed(4))]) },
        confTitleTemperature: bestT.T,
        confTourneyBandwidth: ctBw.bw,
        confTourneyWins: Object.fromEntries(Object.entries(ctGrid).map(([k, g]) => [k, g.map(([r, v]) => [r, Number(v.toFixed(4))])]))
    };

    // ---- 7. the shipped estimate, preseason basis, against 2025-26 ----
    // March fit WITHOUT 2026 so the check is out of sample for the ladder.
    const coefNo26 = fitChain(datasetFor(SEASONS.filter(s => s !== 2026), 'scurve', T, R), degree);
    const calNo26 = Object.assign({}, calibration, { march: coefNo26 });
    const model = M.buildMarchModel(calNo26);
    console.log('\n## Expected NCAA ladder points from PRESEASON rank vs 2025-26 actual (ladder fit excludes 2026)');
    console.log('| preseason rank | teams | with drift: expected | naive (no drift) | actual |');
    console.log('|---|---|---|---|---|');
    const groups = [[1, 10], [11, 25], [26, 50], [51, 80], [81, 120], [121, 365], [1, 120]];
    const tour26 = T[2026];
    groups.forEach(([lo, hi]) => {
        const set = S.hoopsTeams.filter(t => t.preseason.rank >= lo && t.preseason.rank <= hi);
        const e = set.reduce((s, t) => s + M.expectedNcaaPoints(model.reach(t.preseason.rank, 'preseason'), cfg), 0);
        const nv = set.reduce((s, t) => s + M.expectedNcaaPoints(model.reach(t.preseason.rank, 'march'), cfg), 0);
        const a = set.reduce((s, t) => s + actualNcaa(tour26[t.id]), 0);
        console.log(`| ${lo}-${hi} | ${set.length} | ${fmt(e, 0)} | ${fmt(nv, 0)} | ${fmt(a, 0)} |`);
    });
    // Per-team error for the pool, the number a draft grade actually feels.
    const pool = S.hoopsTeams.filter(t => t.preseason.rank <= 120);
    const mae = (fn) => pool.reduce((s, t) => s + Math.abs(fn(t) - actualNcaa(tour26[t.id])), 0) / pool.length;
    console.log(`pool per-team MAE: with drift ${fmt(mae(t => M.expectedNcaaPoints(model.reach(t.preseason.rank, 'preseason'), cfg)), 2)}, `
        + `naive ${fmt(mae(t => M.expectedNcaaPoints(model.reach(t.preseason.rank, 'march'), cfg)), 2)}, `
        + `flat pool mean ${fmt(mae(() => pool.reduce((s, x) => s + actualNcaa(tour26[x.id]), 0) / pool.length), 2)}`);

    // Total postseason term for pool teams, all parts.
    const shipped = M.buildMarchModel(calibration);
    const ctx = shipped.contextFor(confTeams);
    const tot = pool.map(t => shipped.expectedPostseason({ id: t.id, rank: t.preseason.rank }, ctx, cfg, 'preseason'));
    const mean = (k) => tot.reduce((s, x) => s + x[k], 0) / tot.length;
    console.log(`\npool mean postseason term (preseason basis, shipped calibration): confChamp ${fmt(mean('confChamp'), 2)}, confTourney ${fmt(mean('confTourney'), 2)}, `
        + `ncaa ${fmt(mean('ncaa'), 2)}, upset ${fmt(mean('upset'), 2)}, total ${fmt(mean('postseason'), 2)}`);

    if (write) {
        const file = path.join(__dirname, '..', 'data', 'hoops-march-calibration.json');
        fs.writeFileSync(file, JSON.stringify(calibration, null, 1) + '\n');
        console.log(`\nwrote ${file}`);
    }
}

if (require.main === module) main();
