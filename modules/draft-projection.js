// Expected-fantasy-points projection for the draft grade. For each team we
// project its season and score it through THAT league's real scoring engine
// (modules/scoring.js `evaluate`) by synthesizing games and weighting each by
// its probability — so both leagues, and any commissioner config overrides,
// fall out automatically. See .claude/plans for the full design + rationale.

const { evaluate } = require('./scoring');
const { isConferenceChampion } = require('./scoring-detectors');
const { americanToProb } = require('./cfp-odds');
const { marginToWinProb, calibrateToExpectedWins, winTotalDistribution, pAtLeast } = require('./win-probability');

// --- tunables ---
const HFA = 2.5;              // home-field advantage in SP+ points
const FCS_SP_GAP = 30;        // assumed SP+ deficit of an FCS (non-DB) opponent
const CONF_T = 9;             // conference-title softmax temperature
const BOWL_WIN_PROB = 0.5;    // bowls ≈ coin flips (preseason)
const CFP_FIELD = 12;         // playoff field size (make-prob normalization)
const ROUND_NOTES = {
    FR: 'CFP First Round', QF: 'CFP Quarterfinal',
    SF: 'CFP Semifinal', F: 'CFP National Championship'
};

// --- season-value helpers (prior-season fallback, like draft-grades) ---
function seasonVal(team, season, field) {
    const seasons = (team && team.seasons) || [];
    const cur = seasons.find(s => Number(s.season) === season);
    if (cur && cur[field] != null) return cur[field];
    const prev = seasons.find(s => Number(s.season) === season - 1);
    if (prev && prev[field] != null) return prev[field];
    return null;
}
const spFor = (t, s) => seasonVal(t, s, 'spRating');
const winsFor = (t, s) => seasonVal(t, s, 'expectedWins');
const confFor = (t, s) => seasonVal(t, s, 'conference') || (t && t.conference) || null;

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// --- ranking proxy -------------------------------------------------------
// Reuses the real AP poll if one is stored for the season; otherwise builds a
// synthetic "AP Top 25" from SP+ rank. Poll name is always 'AP Top 25' so the
// detector's findPoll matches either source (swap to real AP is then free).
// Ranked entries include each team's alternateNames so the name-join to the
// Game docs can't silently miss.
function buildRankingProxy(season, teamsById, apPoll) {
    if (apPoll && Array.isArray(apPoll.ranks) && apPoll.ranks.length) {
        return { polls: [{ poll: 'AP Top 25', ranks: apPoll.ranks }] };
    }
    const rated = Object.keys(teamsById)
        .map(id => ({ t: teamsById[id], sp: spFor(teamsById[id], season) }))
        .filter(x => x.sp != null)
        .sort((a, b) => b.sp - a.sp)
        .slice(0, 25);
    const ranks = [];
    rated.forEach((x, i) => {
        const rank = i + 1;
        ranks.push({ school: x.t.school, rank });
        (x.t.alternateNames || []).forEach(n => { if (n) ranks.push({ school: n, rank }); });
    });
    return { polls: [{ poll: 'AP Top 25', ranks }] };
}

// --- pool context (built once) ------------------------------------------
// De-vigs the CFP market across the whole pool (make-probs → Σ≈12, champ → Σ=1),
// derives a top-4-seed probability, and precomputes SP+ ranks + conference
// softmax denominators.
function buildPoolContext(teamsById, season) {
    const ids = Object.keys(teamsById);

    // De-vig make/champ by pool normalization.
    let sumMake = 0, sumChamp = 0;
    const rawMake = {}, rawChamp = {};
    ids.forEach(id => {
        const t = teamsById[id];
        const mo = seasonVal(t, season, 'cfpMakeOdds');
        const co = seasonVal(t, season, 'cfpChampOdds');
        if (mo != null) { rawMake[id] = americanToProb(mo); sumMake += rawMake[id]; }
        if (co != null) { rawChamp[id] = americanToProb(co); sumChamp += rawChamp[id]; }
    });
    const makeScale = sumMake > 0 ? CFP_FIELD / sumMake : 0;
    const champScale = sumChamp > 0 ? 1 / sumChamp : 0;

    const make = {}, champ = {}, seed = {};
    ids.forEach(id => {
        make[id] = rawMake[id] != null ? Math.min(0.99, rawMake[id] * makeScale) : null;
        champ[id] = rawChamp[id] != null ? rawChamp[id] * champScale : null;
    });
    // Top-4 seed prob: contenders (by de-vigged champ prob) are likeliest byes;
    // Σβ ≈ 4. Independents can't win a conference → never a top-4 seed.
    ids.forEach(id => {
        const t = teamsById[id];
        const indep = confFor(t, season) === 'FBS Independents';
        if (make[id] == null || indep) { seed[id] = 0; return; }
        seed[id] = Math.min(make[id], 4 * (champ[id] || 0));
    });

    // SP+ national rank (1 = best) for the odds fallback.
    const spRankById = {};
    ids.map(id => ({ id, sp: spFor(teamsById[id], season) }))
        .filter(x => x.sp != null)
        .sort((a, b) => b.sp - a.sp)
        .forEach((x, i) => { spRankById[x.id] = i + 1; });

    // Conference softmax denominators (exclude independents / no-SP+).
    const confDenom = {};
    ids.forEach(id => {
        const t = teamsById[id];
        const conf = confFor(t, season), sp = spFor(t, season);
        if (!conf || conf === 'FBS Independents' || sp == null) return;
        confDenom[conf] = (confDenom[conf] || 0) + Math.exp(sp / CONF_T);
    });

    return { make, champ, seed, spRankById, confDenom, teamsById, season };
}

// Rough CFP make-prob when no market odds exist (e.g. historical seasons).
function makeFallback(rank) {
    if (rank == null) return 0.02;
    if (rank <= 4) return 0.85;
    if (rank <= 12) return 0.5;
    if (rank <= 25) return 0.15;
    return 0.03;
}

// --- synthetic games -----------------------------------------------------
function synthWin(game, teamId) {
    const isHome = game.homeId === teamId;
    return Object.assign({}, game, {
        homePoints: isHome ? 1 : 0,
        awayPoints: isHome ? 0 : 1
    });
}

function synthResult(base, teamId, teamIsHome, won) {
    const g = Object.assign({
        id: -1, season: 0, week: 1, conferenceGame: false,
        homeId: teamIsHome ? teamId : -999, awayId: teamIsHome ? -999 : teamId,
        homeTeam: teamIsHome ? 'TEAM' : 'OPP', awayTeam: teamIsHome ? 'OPP' : 'TEAM',
        homeConference: 'X', awayConference: 'Y'
    }, base);
    const teamScored = won ? 1 : 0, oppScored = won ? 0 : 1;
    g.homePoints = teamIsHome ? teamScored : oppScored;
    g.awayPoints = teamIsHome ? oppScored : teamScored;
    return g;
}

function evalPost(teamId, round, isTop4, won, rankings, cfg) {
    const g = synthResult({ seasonType: 'postseason', notes: ROUND_NOTES[round], neutralSite: round === 'F' }, teamId, !!isTop4, won);
    return evaluate(cfg.model, teamId, g, rankings, cfg);
}

// Solve the single per-round win prob q from c = m·[β·q³ + (1−β)·q⁴].
function solveQ(m, c, beta) {
    if (m <= 0) return 0;
    const cc = Math.min(c, m * 0.999);
    if (cc <= 0) return 0.001;
    let lo = 0, hi = 1;
    for (let i = 0; i < 50; i++) {
        const q = (lo + hi) / 2;
        const f = m * (beta * q * q * q + (1 - beta) * q * q * q * q);
        if (f < cc) lo = q; else hi = q;
    }
    return (lo + hi) / 2;
}

// Expected CFP points: probability-weighted walk of bracket outcomes. Non-bye
// teams start in the First Round; bye teams start in the QF as a top-4 seed
// (homeId=team) so Graham's bye bonus fires. Values come from the engine.
function expectedCfpPoints(teamId, m, beta, q, rankings, cfg) {
    const E = (round, isTop4) =>
        q * evalPost(teamId, round, isTop4, true, rankings, cfg)
        + (1 - q) * evalPost(teamId, round, isTop4, false, rankings, cfg);
    const wNon = m * (1 - beta), wBye = m * beta;
    const nonBye = E('FR', false) + q * E('QF', false) + q * q * E('SF', false) + q * q * q * E('F', false);
    const bye = E('QF', true) + q * E('SF', false) + q * q * E('F', false);
    return wNon * nonBye + wBye * bye;
}

// --- per-team projection -------------------------------------------------
// opts.expectedWins: calibration target for the games passed (default: the
//   team's season expected wins — used for a full-season projection; the
//   standings projection passes REMAINING expected wins for a remaining subset).
// opts.perGame: also return perGame [{ winProb, pointsIfWin }] for Monte-Carlo.
function projectTeamPoints(team, teamGames, poolCtx, rankings, cfg, season, opts = {}) {
    const teamId = team.id;
    const sp = spFor(team, season);
    const mySp = sp == null ? 0 : sp;

    // 1. Regular season: expected points = Σ P(win) · points-if-win.
    //    Exclude conference-title games (modeled separately) and any non-regular.
    const reg = (teamGames || []).filter(g => g.seasonType === 'regular' && !isConferenceChampion(g));
    const margins = reg.map(g => {
        const isHome = g.homeId === teamId;
        const oppId = isHome ? g.awayId : g.homeId;
        const opp = poolCtx.teamsById[String(oppId)];
        const oppSp = opp ? spFor(opp, season) : null;           // null → FCS / non-DB
        const effOpp = oppSp == null ? (mySp - FCS_SP_GAP) : oppSp;
        const hfa = g.neutralSite ? 0 : (isHome ? HFA : -HFA);
        return (mySp - effOpp) + hfa;
    });
    const target = opts.expectedWins != null ? opts.expectedWins : winsFor(team, season);
    const { probs } = calibrateToExpectedWins(margins, target);
    let regular = 0;
    const perGame = [];
    reg.forEach((g, i) => {
        const pts = evaluate(cfg.model, teamId, synthWin(g, teamId), rankings, cfg);
        regular += probs[i] * pts;
        if (opts.perGame) perGame.push({ winProb: probs[i], pointsIfWin: pts });
    });
    const projWins = probs.reduce((a, b) => a + b, 0);

    // 2. CFP (market odds, else SP+-rank fallback).
    let m = poolCtx.make[String(teamId)];
    let c = poolCtx.champ[String(teamId)];
    let beta = poolCtx.seed[String(teamId)] || 0;
    if (m == null) {
        const r = poolCtx.spRankById[String(teamId)];
        m = makeFallback(r); c = m * 0.05; beta = (r != null && r <= 4) ? m * 0.5 : 0;
    }
    let cfp = 0;
    if (m > 0) cfp = expectedCfpPoints(teamId, m, beta, solveQ(m, c, beta), rankings, cfg);

    // 3. Conference title (softmax over conference SP+; independents = 0).
    let confChamp = 0;
    const conf = confFor(team, season);
    if (conf && conf !== 'FBS Independents' && sp != null && poolCtx.confDenom[conf]) {
        const pConf = Math.exp(sp / CONF_T) / poolCtx.confDenom[conf];
        const g = synthResult({ seasonType: 'regular', notes: `${conf} Championship`, neutralSite: true, conferenceGame: true, homeConference: conf, awayConference: conf }, teamId, true, true);
        confChamp = pConf * evaluate(cfg.model, teamId, g, rankings, cfg);
    }

    // 4. Bowl (non-playoff): P(≥6 wins)·(1 − P(make CFP)) × expected bowl value.
    const dist = winTotalDistribution(probs);
    const pBowl = pAtLeast(dist, 6) * (1 - m);
    const bowlWin = evaluate(cfg.model, teamId, synthResult({ seasonType: 'postseason', notes: 'Bowl', neutralSite: true }, teamId, true, true), rankings, cfg);
    const bowlLose = evaluate(cfg.model, teamId, synthResult({ seasonType: 'postseason', notes: 'Bowl', neutralSite: true }, teamId, true, false), rankings, cfg);
    const bowl = pBowl * (BOWL_WIN_PROB * bowlWin + (1 - BOWL_WIN_PROB) * bowlLose);

    const total = regular + cfp + confChamp + bowl;
    return { regular, cfp, confChamp, bowl, total, projWins, makeProb: m, perGame };
}

// --- absolute per-league bands ------------------------------------------
// Grades a roster on its PER-TEAM caliber, anchored to the pool:
//   eliteAvg       = projection at rank R      → "your typical team is top-R caliber"
//   replacementAvg = projection at rank L·R    → "your typical team is the last one drafted"
// A roster whose average team sits at top-R caliber earns an A; one made of
// last-drafted-caliber teams earns a D. Anchors depend only on the team pool +
// league scoring config + league size/rounds — never on who actually drafted —
// so the letter is absolute. (Averaging the literal top-R teams was rejected:
// no single roster can hold them in a snake draft, so it under-grades everyone;
// snake-slot anchors were also rejected — snake balances total value across
// seats and collapses the range.) A small window smooths rank cliffs.
function computeLeagueBands(sortedTotalsDesc, leagueSize, rounds) {
    const N = sortedTotalsDesc.length;
    const L = Math.max(2, leagueSize || 6), R = Math.max(1, rounds || 10);
    const windowAvg = (centerRank) => {
        const c = Math.min(N, Math.max(1, centerRank));
        let s = 0, n = 0;
        for (let rank = c - 2; rank <= c + 2; rank++) {
            if (rank >= 1 && rank <= N) { s += sortedTotalsDesc[rank - 1]; n++; }
        }
        return n ? s / n : 0;
    };
    return {
        eliteAvg: windowAvg(R),
        replacementAvg: windowAvg(Math.min(N, L * R))
    };
}

module.exports = {
    buildRankingProxy, buildPoolContext, projectTeamPoints, computeLeagueBands,
    // helpers reused by draft-grades / tests:
    seasonVal, spFor, winsFor, confFor, makeFallback, solveQ, expectedCfpPoints,
    HFA, FCS_SP_GAP
};
