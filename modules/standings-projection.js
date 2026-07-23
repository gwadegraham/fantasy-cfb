// Forward-looking standings analytics: projected final points + Monte-Carlo
// title odds per manager. Reuses the draft-grade projection engine
// (modules/draft-projection.js), but mid-season: points already banked +
// expected points from each rostered team's REMAINING schedule + expected
// postseason. Pure (no I/O) so it's unit-testable; the route feeds it data.

const { projectTeamPoints, spFor, winsFor } = require('./draft-projection');

const nameOf = (u) => `${u.firstName || ''} ${u.lastName ? u.lastName[0] + '.' : ''}`.trim();
const initialsOf = (u) => (((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '')).toUpperCase();

// Count a team's wins among its already-completed regular games (for calibrating
// the remaining schedule to the remaining expected-win total).
function winsSoFar(teamId, games) {
    let w = 0;
    for (const g of games) {
        if (g.seasonType !== 'regular' || g.completed !== true) continue;
        if (g.homePoints == null || g.awayPoints == null) continue;
        const isHome = g.homeId === teamId;
        if ((isHome && g.homePoints > g.awayPoints) || (!isHome && g.awayPoints > g.homePoints)) w++;
    }
    return w;
}

// Per-manager projection for a season. gamesByTeam: { teamId: [Game] }.
function buildProjections(users, teamsById, gamesByTeam, cfg, rankings, poolCtx, season) {
    const out = [];
    for (const u of users) {
        const s = (u.seasons || []).find(x => Number(x.season) === season);
        if (!s || !Array.isArray(s.teams) || !s.teams.length) continue;   // no roster → skip
        const banked = s.cumulativeScore || 0;

        let expReg = 0, expPost = 0, remainingCount = 0;
        const perGame = [];
        for (const rosterTeam of s.teams) {
            const team = teamsById[String(rosterTeam.id)] || rosterTeam;
            const all = gamesByTeam[String(rosterTeam.id)] || [];
            const remaining = all.filter(g => g.seasonType === 'regular' && g.completed !== true);
            remainingCount += remaining.length;
            const expWins = winsFor(team, season);
            const remExpWins = expWins == null ? null : Math.max(0.1, expWins - winsSoFar(rosterTeam.id, all));
            const proj = projectTeamPoints(team, remaining, poolCtx, rankings, cfg, season,
                { expectedWins: remExpWins, perGame: true });
            expReg += proj.regular;
            expPost += proj.cfp + proj.confChamp + proj.bowl;
            (proj.perGame || []).forEach(pg => perGame.push(pg));
        }

        out.push({
            userId: String(u._id), name: nameOf(u), franchise: s.franchiseName || null,
            avatarUrl: u.avatarUrl || null, initials: initialsOf(u), color: u.color || null,
            banked: Math.round(banked),
            projectedFinal: Math.round(banked + expReg + expPost),
            postExpected: banked + expPost,   // deterministic part carried into each sim
            perGame, remainingCount
        });
    }
    return out;
}

// Light Monte-Carlo: sim the remaining regular games N times (postseason carried
// as its expected value), count how often each manager finishes 1st. Ties split
// the championship credit. Returns titleOdds (0..1) keyed by userId.
function simulateTitleOdds(managers, N) {
    N = N || 5000;
    const wins = {};
    managers.forEach(m => { wins[m.userId] = 0; });
    for (let s = 0; s < N; s++) {
        let best = -Infinity, leaders = [];
        for (const m of managers) {
            let total = m.postExpected;
            for (const g of m.perGame) if (Math.random() < g.winProb) total += g.pointsIfWin;
            if (total > best + 1e-9) { best = total; leaders = [m.userId]; }
            else if (Math.abs(total - best) <= 1e-9) leaders.push(m.userId);
        }
        const share = 1 / leaders.length;
        leaders.forEach(id => { wins[id] += share; });
    }
    const odds = {};
    managers.forEach(m => { odds[m.userId] = wins[m.userId] / N; });
    return odds;
}

module.exports = { buildProjections, simulateTitleOdds, winsSoFar };
