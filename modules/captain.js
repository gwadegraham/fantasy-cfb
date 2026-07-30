// Pure helpers for the weekly Captain mechanic (GitHub #230): a manager doubles
// one rostered team each week. DB-free so the scoring job, the pick route, and
// tests all share one implementation. `captains` is [{ week, teamId }] stored on
// the user's season; `roster` is the season's teams; `priorWeekly` is the
// manager's weeklyScore entries BEFORE the target week (for the auto-captain
// default).

// The teamId a manager has captained for a given week, or null if none set.
function captainForWeek(captains, week) {
    const c = (captains || []).find(x => Number(x.week) === Number(week));
    return c && c.teamId != null ? Number(c.teamId) : null;
}

// Auto-captain fallback when a manager doesn't set one: the rostered team with
// the best average over prior weeks (a "ride the hot hand" default). With no
// prior data (week 1) it falls back to the first rostered team, so there's
// always a deterministic pick. Returns a teamId or null (empty roster).
function autoCaptainTeamId(roster, priorWeekly) {
    const teams = (roster || []).filter(t => t && t.id != null);
    if (!teams.length) return null;
    // Sum + count each team's prior game scores from scoreByTeam.
    const agg = {};
    (priorWeekly || []).forEach(wk => (wk.scoreByTeam || []).forEach(st => {
        if (st.teamId == null) return;
        const a = agg[st.teamId] || (agg[st.teamId] = { sum: 0, n: 0 });
        a.sum += (st.score || 0); a.n += 1;
    }));
    let best = null, bestAvg = -Infinity;
    teams.forEach(t => {
        const a = agg[t.id];
        const avg = a && a.n ? a.sum / a.n : -Infinity;   // teams with no prior games rank last
        if (avg > bestAvg) { bestAvg = avg; best = t.id; }
    });
    return best != null && bestAvg > -Infinity ? Number(best) : Number(teams[0].id);
}

// Resolve the effective captain for a week: the manual pick if set, else the
// auto-captain default. Returns a teamId or null.
function resolveCaptain(captains, week, roster, priorWeekly) {
    const picked = captainForWeek(captains, week);
    if (picked != null) return picked;
    return autoCaptainTeamId(roster, priorWeekly);
}

// The extra points from doubling (or N×-ing) the captained team in a week.
// scoreByTeam may list the captained team more than once (multi-game weeks), so
// all of its games are boosted. bonus = (sum of captain's scores) × (mult − 1).
function captainWeeklyBonus(scoreByTeam, captainTeamId, multiplier) {
    if (captainTeamId == null) return 0;
    const mult = multiplier || 2;
    let base = 0;
    (scoreByTeam || []).forEach(st => { if (Number(st.teamId) === Number(captainTeamId)) base += (st.score || 0); });
    return Math.round(base * (mult - 1) * 10) / 10;
}

module.exports = { captainForWeek, autoCaptainTeamId, resolveCaptain, captainWeeklyBonus };
