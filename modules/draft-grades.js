// Post-draft grades — immediate, PRESEASON feedback the moment a draft ends
// (no games required). Each draft is judged on its OWN MERIT against fixed
// thresholds (absolute bands), so a manager's grade never depends on how their
// leaguemates drafted.
//
// The grade blends three preseason roster-quality signals, chosen to match how
// THIS league actually scores (wins + ranked wins + deep CFP runs):
//   * team quality  — average SP+
//   * projected wins — average expected wins (the win-based core of scoring)
//   * CFP upside     — reward stacking likely-playoff teams (advancing in the
//                      12-team CFP is worth the most points). Uses MARKET odds
//                      when entered (make-CFP probability + a championship-odds
//                      bonus for deep-run upside), falling back to the SP+ rank
//                      proxy when a season has no odds.
//
// Each signal is normalized against fixed anchors (tunable below) and blended,
// then mapped to a letter. SP+/wins mirror the draft pool (season value, prior-
// season fallback). Best-value / biggest-reach picks (shown as highlights, not
// part of the letter) use projected-wins rank vs. draft slot.

const { americanToProb } = require('./cfp-odds');

// --- absolute grading anchors + weights (tune here) ---
const STRENGTH_LOW = -3, STRENGTH_HIGH = 16;   // roster avg SP+  → 0..1
const WINS_LOW = 6.0, WINS_HIGH = 9.0;         // roster avg expected wins → 0..1
const CFP_LOW = 0, CFP_HIGH = 3.0;             // roster CFP-upside sum → 0..1
const W_STRENGTH = 0.35, W_WINS = 0.35, W_CFP = 0.30;
const CHAMP_WEIGHT = 2;                        // deep-run (title) upside multiplier

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// A season value on a team (SP+ or expected wins), with prior-season fallback.
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

// CFP upside for a team, by its SP+ national rank (1 = best). Top seeds advance
// further in the 12-team playoff, so they're worth the most.
function cfpTier(rank) {
    if (rank == null) return 0;
    if (rank <= 4) return 1.0;    // bye-caliber — deep run likely
    if (rank <= 12) return 0.6;   // in the field
    if (rank <= 25) return 0.25;  // bubble / ranked
    return 0;
}

// Letter grade from an absolute 0..1 score (fixed bands).
function letterFor(score) {
    if (score >= 0.85) return 'A';
    if (score >= 0.75) return 'A-';
    if (score >= 0.65) return 'B+';
    if (score >= 0.55) return 'B';
    if (score >= 0.45) return 'B-';
    if (score >= 0.35) return 'C+';
    if (score >= 0.25) return 'C';
    return 'D';
}

function displayName(u) {
    return `${u.firstName || ''} ${u.lastName ? u.lastName[0] + '.' : ''}`.trim();
}

function pickView(p) {
    return p ? {
        school: p.school, round: p.round, overall: p.overall,
        wins: Math.round(p.wins * 10) / 10, value: p.value, logo: p.logo || null
    } : null;
}

// draft: a Draft doc (picks). usersById: { userId: user }. teamsById: { teamId: team (w/ seasons) }.
function computeGrades(draft, usersById, teamsById) {
    const season = Number(draft.season);

    // National reference curves for this season.
    const allTeams = Object.keys(teamsById).map(k => teamsById[k]);
    // SP+ rank per team id (1 = best).
    const spRankById = {};
    allTeams.map(t => ({ id: t.id, sp: spFor(t, season) }))
        .filter(x => x.sp != null)
        .sort((a, b) => b.sp - a.sp)
        .forEach((x, i) => { spRankById[String(x.id)] = i + 1; });
    // 1. Per pick: SP+, projected wins, and CFP upside.
    //    CFP upside uses market odds when entered (make-CFP probability + a
    //    championship-odds bonus for deep-run upside), else the SP+ rank proxy.
    const picks = (draft.picks || []).map(p => {
        const team = teamsById[String(p.team.id)];
        const sp = spFor(team, season);
        const wins = winsFor(team, season);
        const makeOdds = seasonVal(team, season, 'cfpMakeOdds');
        const champOdds = seasonVal(team, season, 'cfpChampOdds');
        const makeProb = makeOdds != null ? americanToProb(makeOdds) : null;
        const champProb = champOdds != null ? americanToProb(champOdds) : 0;
        const cfp = makeProb != null
            ? makeProb + CHAMP_WEIGHT * champProb
            : cfpTier(spRankById[String(p.team.id)] || null);
        return {
            userId: String(p.userId), overall: p.overall, round: p.round,
            school: p.team.school, logo: (p.team.logos || [])[0],
            sp: sp == null ? 0 : sp, wins: wins == null ? 0 : wins,
            spRank: spRankById[String(p.team.id)] || null,
            makeProb, cfp
        };
    });
    const oddsPresent = picks.some(p => p.makeProb != null);

    // Highlight value = how far a pick beat its draft slot on projected wins:
    // rank all picks by projected wins (1 = most), then value = overall − winsRank.
    // Big positive = a win-heavy team that fell (steal); big negative = a low-win
    // team taken early (reach). Elite early picks rank high, so they aren't
    // penalized. This drives the steal/reach highlights only — not the grade.
    picks.slice().sort((a, b) => b.wins - a.wins).forEach((p, i) => { p.winsRank = i + 1; });
    picks.forEach(p => { p.value = p.overall - p.winsRank; });

    // 2. Roll up per manager.
    const byUser = {};
    picks.forEach(p => { (byUser[p.userId] = byUser[p.userId] || []).push(p); });

    return Object.keys(byUser).map(uid => {
        const ps = byUser[uid].slice().sort((a, b) => a.overall - b.overall);
        const strength = ps.reduce((s, p) => s + p.sp, 0) / ps.length;
        const projWins = ps.reduce((s, p) => s + p.wins, 0) / ps.length;
        const cfpSum = ps.reduce((s, p) => s + p.cfp, 0);
        // Display: expected # of CFP teams (sum of make-odds probability) when
        // odds are in; else a hard count of top-12 SP+ teams.
        const cfpCount = oddsPresent
            ? Math.round(ps.reduce((s, p) => s + (p.makeProb || 0), 0) * 10) / 10
            : ps.filter(p => p.spRank != null && p.spRank <= 12).length;
        const best = ps.slice().sort((a, b) => b.value - a.value)[0];
        const worst = ps.slice().sort((a, b) => a.value - b.value)[0];
        const u = usersById[uid] || {};
        const us = (u.seasons || []).find(s => Number(s.season) === season) || {};

        // 3. Absolute blended score → letter (each draft on its own merit).
        const sStr = clamp01((strength - STRENGTH_LOW) / (STRENGTH_HIGH - STRENGTH_LOW));
        const sWin = clamp01((projWins - WINS_LOW) / (WINS_HIGH - WINS_LOW));
        const sCfp = clamp01((cfpSum - CFP_LOW) / (CFP_HIGH - CFP_LOW));
        const score = W_STRENGTH * sStr + W_WINS * sWin + W_CFP * sCfp;

        return {
            userId: uid, name: displayName(u), franchise: us.franchiseName || null,
            avatarUrl: u.avatarUrl || null,
            strength: Math.round(strength * 10) / 10,
            projWins: Math.round(projWins * 10) / 10,
            cfpCount,
            grade: letterFor(score),
            // Only surface a steal/reach when it beat (or lagged) its slot by a
            // few rounds — otherwise there's no notable story to tell.
            bestPick: (best && best.value >= 5) ? pickView(best) : null,
            worstPick: (worst && worst.value <= -5) ? pickView(worst) : null
        };
    }).sort((a, b) => {
        const order = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D'];
        return order.indexOf(a.grade) - order.indexOf(b.grade) || b.projWins - a.projWins;
    });
}

module.exports = { computeGrades, spFor, winsFor, cfpTier, letterFor };
