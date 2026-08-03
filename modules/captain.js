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

// --- Per-manager kickoff lock (spec: captain locks when the manager's own
// first team of the week kicks off, not at the league-wide first game). ---

// First & last kickoff (ms since epoch) among a manager's rostered teams in a
// set of week games, or null if they don't play that week. `weekGames` =
// regular-season games for one week as { homeId, awayId, startDate, startTimeTbd }.
// TBD-kickoff games carry a placeholder startDate that only firms up ~12 days
// out, so they're excluded while any firm-time game exists — a placeholder must
// never lock the pick early.
function captainWeekWindow(weekGames, teamIds) {
    const ids = new Set((teamIds || []).map(Number));
    const mine = (weekGames || []).filter(g => ids.has(Number(g.homeId)) || ids.has(Number(g.awayId)));
    if (!mine.length) return null;
    const firm = mine.filter(g => !g.startTimeTbd);
    const pool = firm.length ? firm : mine;
    const times = pool.map(g => Date.parse(g.startDate)).filter(t => !Number.isNaN(t));
    if (!times.length) return null;
    return { first: Math.min.apply(null, times), last: Math.max.apply(null, times) };
}

// The lock instant for a week: the manager's earliest kickoff. null = no game
// (or no usable kickoff) that week → nothing to lock.
function captainLockMs(weekGames, teamIds) {
    const w = captainWeekWindow(weekGames, teamIds);
    return w ? w.first : null;
}

// The week the Captain tile should focus on: the earliest regular-season week
// (1..16) the manager plays that isn't over yet (now < last kickoff + grace).
// So a week stays in focus through its games — editable before the manager's
// first kickoff, then shown locked — and only advances to the next week once
// this week's games are done. Returns { week, first, last } or null at season end.
// `games` = the manager's regular-season games across the season.
function captainFocusWeek(games, teamIds, nowMs, graceMs) {
    const byWeek = {};
    (games || []).forEach(g => {
        if (g.seasonType !== 'regular') return;
        const w = Number(g.week);
        if (w >= 1 && w <= 16) (byWeek[w] = byWeek[w] || []).push(g);
    });
    for (let w = 1; w <= 16; w++) {
        const win = captainWeekWindow(byWeek[w], teamIds);
        if (win && nowMs < win.last + graceMs) return { week: w, first: win.first, last: win.last };
    }
    return null;
}

module.exports = {
    captainForWeek, autoCaptainTeamId, resolveCaptain, captainWeeklyBonus,
    captainWeekWindow, captainLockMs, captainFocusWeek
};
