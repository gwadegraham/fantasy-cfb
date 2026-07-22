// Post-draft grades: how well each manager drafted, measured by how much their
// picks beat their draft slot. Uses ACTUAL fantasy points (from weeklyScore),
// so grades fill in as the season is played rather than needing a projection.
//
//   value(pick) = overall - performanceRank
//     performanceRank = the team's rank by fantasy points among ALL drafted
//     teams (1 = most points). A team taken late (high overall) that scored a
//     lot (low performanceRank) has a big positive value — a steal. An early
//     pick that flopped has a big negative value — a bust.
//
// A manager's grade comes from their average pick value, curved within the
// league (best average = A). Because overall and performanceRank are both
// permutations of 1..N, league-wide value sums to zero — so the grade measures
// draft skill relative to slot, not just who had the early picks. That keeps it
// distinct from the standings (which are just total points).

// Total fantasy points a manager's team earned in a season (summed across the
// weekly per-team breakdown).
function teamSeasonPoints(userSeason, teamId) {
    let pts = 0;
    (userSeason.weeklyScore || []).forEach(wk => {
        (wk.scoreByTeam || []).forEach(st => {
            if (Number(st.teamId) === Number(teamId)) pts += (st.score || 0);
        });
    });
    return pts;
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
    return {
        school: p.school, round: p.round, overall: p.overall,
        points: Math.round(p.points), value: p.value, logo: p.logo || null
    };
}

// draft: a Draft doc (with picks). usersById: { <userId>: user (w/ seasons) }.
function computeGrades(draft, usersById) {
    const season = Number(draft.season);

    // 1. Points scored by each pick's team for the manager who drafted it.
    const picks = (draft.picks || []).map(p => {
        const u = usersById[String(p.userId)];
        const us = u && (u.seasons || []).find(s => Number(s.season) === season);
        const points = us ? teamSeasonPoints(us, p.team.id) : 0;
        return {
            userId: String(p.userId), overall: p.overall, round: p.round,
            teamId: p.team.id, school: p.team.school,
            logo: (p.team.logos || [])[0], points
        };
    });

    // 2. Performance rank (1 = most points among all drafted teams).
    picks.slice().sort((a, b) => b.points - a.points)
        .forEach((p, i) => { p.performanceRank = i + 1; });

    // 3. Value = how far the team outperformed its draft slot.
    picks.forEach(p => { p.value = p.overall - p.performanceRank; });

    // 4. Roll up per manager.
    const byUser = {};
    picks.forEach(p => { (byUser[p.userId] = byUser[p.userId] || []).push(p); });

    const managers = Object.keys(byUser).map(uid => {
        const ps = byUser[uid].slice().sort((a, b) => a.overall - b.overall);
        const totalPoints = ps.reduce((s, p) => s + p.points, 0);
        const avgValue = ps.reduce((s, p) => s + p.value, 0) / ps.length;
        const best = ps.slice().sort((a, b) => b.value - a.value)[0];
        const worst = ps.slice().sort((a, b) => a.value - b.value)[0];
        const u = usersById[uid] || {};
        const us = (u.seasons || []).find(s => Number(s.season) === season) || {};
        return {
            userId: uid,
            name: displayName(u),
            franchise: us.franchiseName || null,
            avatarUrl: u.avatarUrl || null,
            totalPoints: Math.round(totalPoints),
            avgValue: Math.round(avgValue * 10) / 10,
            bestPick: best ? pickView(best) : null,
            worstPick: worst ? pickView(worst) : null,
            picks: ps.map(pickView)
        };
    });

    // 5. Curve the grade off average pick value (best average = A).
    managers.sort((a, b) => b.avgValue - a.avgValue);
    const n = managers.length;
    managers.forEach((m, i) => {
        m.rank = i + 1;
        m.grade = letterFor(n > 1 ? i / (n - 1) : 0);
    });
    return managers;
}

module.exports = { computeGrades, teamSeasonPoints, letterFor };
