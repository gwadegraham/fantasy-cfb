// Post-draft grades — immediate PRESEASON feedback the moment a draft ends.
//
// The grade is now a per-league EXPECTED-FANTASY-POINTS projection: each drafted
// team's season is projected and scored through that league's real scoring
// engine (see modules/draft-projection.js), so Claunts (V1) and Graham (V2)
// grade the same roster differently, matching how each league actually scores.
// A manager's roster is graded on ABSOLUTE per-league bands (snake-draft
// anchors from the team pool) so the letter never depends on how leaguemates
// drafted.

const { resolveConfig } = require('./scoring-defaults');
const {
    buildRankingProxy, buildPoolContext, projectTeamPoints, computeLeagueBands,
    spFor, winsFor
} = require('./draft-projection');

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

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
        points: Math.round(p.points), value: p.value, logo: p.logo || null
    } : null;
}

// Group season games by the FBS team ids that appear in them (a game with two
// drafted-pool teams lands under both).
function groupGamesByTeam(games, teamsById) {
    const by = {};
    for (const g of games || []) {
        const h = String(g.homeId), a = String(g.awayId);
        if (teamsById[h]) (by[h] = by[h] || []).push(g);
        if (teamsById[a]) (by[a] = by[a] || []).push(g);
    }
    return by;
}

// draft: a Draft doc. usersById: { userId: user }. teamsById: { teamId: team }.
// opts: { games, config, apPoll } supplied by the route (kept out of here so the
// projection stays pure/sync and unit-testable).
function computeGrades(draft, usersById, teamsById, opts = {}) {
    const season = Number(draft.season);
    const league = draft.league;
    const cfg = opts.config || resolveConfig(league, null);
    const rankings = buildRankingProxy(season, teamsById, opts.apPoll);
    const poolCtx = buildPoolContext(teamsById, season);
    const gamesByTeam = groupGamesByTeam(opts.games, teamsById);

    // Project every team in the pool (needed for the absolute bands + reused for
    // the drafted picks).
    const projByTeam = {};
    Object.keys(teamsById).forEach(id => {
        projByTeam[id] = projectTeamPoints(teamsById[id], gamesByTeam[id], poolCtx, rankings, cfg, season);
    });
    const sortedTotals = Object.keys(projByTeam).map(id => projByTeam[id].total).sort((a, b) => b - a);
    const L = (draft.draftOrder || []).length || Object.keys(usersById).length || 6;
    const bands = computeLeagueBands(sortedTotals, L, draft.totalRounds || 10);
    const denom = (bands.eliteAvg - bands.replacementAvg) || 1;

    // Per pick: projected points, wins, make-prob.
    const picks = (draft.picks || []).map(p => {
        const proj = projByTeam[String(p.team.id)] || { total: 0, projWins: 0, makeProb: 0 };
        return {
            userId: String(p.userId), overall: p.overall, round: p.round,
            school: p.team.school, logo: (p.team.logos || [])[0],
            points: proj.total, wins: proj.projWins, makeProb: proj.makeProb || 0,
            reg: proj.regular || 0,                                   // regular-season floor
            post: (proj.cfp || 0) + (proj.confChamp || 0) + (proj.bowl || 0)  // postseason upside
        };
    });

    // Steal/reach highlight = how far a pick beat its draft slot on projected
    // points: rank picks by projected points, value = overall − pointsRank.
    picks.slice().sort((a, b) => b.points - a.points).forEach((p, i) => { p.pointsRank = i + 1; });
    picks.forEach(p => { p.value = p.overall - p.pointsRank; });

    const byUser = {};
    picks.forEach(p => { (byUser[p.userId] = byUser[p.userId] || []).push(p); });

    return Object.keys(byUser).map(uid => {
        const ps = byUser[uid].slice().sort((a, b) => a.overall - b.overall);
        const totalPoints = ps.reduce((s, p) => s + p.points, 0);
        const avgPoints = totalPoints / ps.length;
        const projWins = ps.reduce((s, p) => s + p.wins, 0) / ps.length;
        const cfpCount = Math.round(ps.reduce((s, p) => s + (p.makeProb || 0), 0) * 10) / 10;
        const regPoints = Math.round(ps.reduce((s, p) => s + p.reg, 0));
        const postPoints = Math.round(ps.reduce((s, p) => s + p.post, 0));
        const best = ps.slice().sort((a, b) => b.value - a.value)[0];
        const worst = ps.slice().sort((a, b) => a.value - b.value)[0];
        const u = usersById[uid] || {};
        const us = (u.seasons || []).find(s => Number(s.season) === season) || {};
        const score = clamp01((avgPoints - bands.replacementAvg) / denom);

        return {
            userId: uid, name: displayName(u), franchise: us.franchiseName || null,
            avatarUrl: u.avatarUrl || null,
            projPoints: Math.round(totalPoints),
            regPoints, postPoints,
            projWins: Math.round(projWins * 10) / 10,
            cfpCount,
            grade: letterFor(score),
            bestPick: (best && best.value >= 5) ? pickView(best) : null,
            worstPick: (worst && worst.value <= -5) ? pickView(worst) : null
        };
    }).sort((a, b) => {
        const order = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D'];
        return order.indexOf(a.grade) - order.indexOf(b.grade) || b.projPoints - a.projPoints;
    });
}

module.exports = { computeGrades, letterFor, spFor, winsFor };
