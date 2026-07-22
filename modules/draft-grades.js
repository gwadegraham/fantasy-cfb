// Post-draft grades — immediate, PRESEASON feedback the moment a draft ends
// (no games required). Blends two signals known at draft time:
//   * roster strength — average preseason SP+ of the teams drafted
//   * draft value      — how much each pick's SP+ quality beat its draft slot
// Each is min-max normalized within the league, blended 50/50, then curved to a
// letter grade. SP+ mirrors the draft pool: the season's rating, falling back to
// the prior season's rating when this season's isn't populated yet.

// Preseason SP+ for a team in a season (prev-season fallback, like the pool).
function spFor(team, season) {
    const seasons = (team && team.seasons) || [];
    const cur = seasons.find(s => Number(s.season) === season);
    if (cur && cur.spRating != null) return cur.spRating;
    const prev = seasons.find(s => Number(s.season) === season - 1);
    if (prev && prev.spRating != null) return prev.spRating;
    return null;
}

// Letter grade from a rank fraction (0 = best in league, 1 = worst).
function letterFor(frac) {
    if (frac <= 0.15) return 'A';
    if (frac <= 0.30) return 'A-';
    if (frac <= 0.45) return 'B+';
    if (frac <= 0.60) return 'B';
    if (frac <= 0.75) return 'B-';
    if (frac <= 0.90) return 'C+';
    return 'C';
}

function displayName(u) {
    return `${u.firstName || ''} ${u.lastName ? u.lastName[0] + '.' : ''}`.trim();
}

function pickView(p) {
    return p ? {
        school: p.school, round: p.round, overall: p.overall,
        sp: Math.round(p.sp * 10) / 10, value: p.value, logo: p.logo || null
    } : null;
}

// draft: a Draft doc (picks). usersById: { userId: user }. teamsById: { teamId: team (w/ seasons) }.
function computeGrades(draft, usersById, teamsById) {
    const season = Number(draft.season);

    // 1. Preseason SP+ per pick (0 = league-average when a team has no rating).
    const picks = (draft.picks || []).map(p => {
        const team = teamsById[String(p.team.id)];
        const sp = spFor(team, season);
        return {
            userId: String(p.userId), overall: p.overall, round: p.round,
            school: p.team.school, logo: (p.team.logos || [])[0],
            sp: sp == null ? 0 : sp
        };
    });

    // 2. Quality rank by SP+ (1 = best) → value = how far it beat its slot.
    picks.slice().sort((a, b) => b.sp - a.sp).forEach((p, i) => { p.qualityRank = i + 1; });
    picks.forEach(p => { p.value = p.overall - p.qualityRank; });

    // 3. Roll up per manager.
    const byUser = {};
    picks.forEach(p => { (byUser[p.userId] = byUser[p.userId] || []).push(p); });

    const managers = Object.keys(byUser).map(uid => {
        const ps = byUser[uid].slice().sort((a, b) => a.overall - b.overall);
        const strength = ps.reduce((s, p) => s + p.sp, 0) / ps.length;
        const avgValue = ps.reduce((s, p) => s + p.value, 0) / ps.length;
        const best = ps.slice().sort((a, b) => b.value - a.value)[0];
        const worst = ps.slice().sort((a, b) => a.value - b.value)[0];
        const u = usersById[uid] || {};
        const us = (u.seasons || []).find(s => Number(s.season) === season) || {};
        return {
            userId: uid, name: displayName(u), franchise: us.franchiseName || null,
            avatarUrl: u.avatarUrl || null,
            strength: Math.round(strength * 10) / 10,
            avgValue: Math.round(avgValue * 10) / 10,
            bestPick: pickView(best), worstPick: pickView(worst)
        };
    });

    // 4. Blend: min-max normalize strength + value within the league, 50/50, curve.
    const normalize = (key) => {
        const vals = managers.map(m => m[key]);
        const mn = Math.min(...vals), mx = Math.max(...vals);
        managers.forEach(m => { m['_' + key] = (mx === mn) ? 0.5 : (m[key] - mn) / (mx - mn); });
    };
    normalize('strength');
    normalize('avgValue');
    managers.forEach(m => { m._blend = 0.5 * m._strength + 0.5 * m._avgValue; });
    managers.sort((a, b) => b._blend - a._blend);

    const n = managers.length;
    managers.forEach((m, i) => {
        m.rank = i + 1;
        m.grade = letterFor(n > 1 ? i / (n - 1) : 0);
        delete m._strength; delete m._avgValue; delete m._blend;
    });
    return managers;
}

module.exports = { computeGrades, spFor, letterFor };
