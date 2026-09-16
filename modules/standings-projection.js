// Forward-looking standings analytics: projected final points + Monte-Carlo
// title odds per manager. Reuses the draft-grade projection engine
// (modules/draft-projection.js), but mid-season: points already banked +
// expected points from each rostered team's REMAINING schedule + expected
// postseason. Pure (no I/O) so it's unit-testable; the route feeds it data.

const { projectTeamPoints, spFor, winsFor } = require('./draft-projection');

// How many games it takes for a team's ACTUAL results to earn half the say in
// its remaining-wins forecast, against its preseason win total.
//
// The old forecast was subtraction: preseason expectedWins MINUS wins banked. A
// loss left the target untouched while the games left to hold it shrank, so a
// .500 team was projected to win every remaining game from week 4 on — and a 4-3
// team out-projected a 6-1 one on the same schedule. Losing did not lower the
// forecast, it just crammed the same wins into fewer games.
//
// This is a rate instead: blend the preseason pace with the pace actually being
// played, weighting reality by gp / (gp + K) as games accumulate, then multiply
// by the games left. It cannot exceed the games remaining, because both paces
// are per-game rates in [0, 1] — which is why the explicit 0.90 ceiling this
// replaced is gone rather than kept alongside.
//
// K = 10 backtested against 2024 + 2025 (3,003 team-weeks, remaining wins
// predicted from every point in every season):
//
//   subtraction   mean abs error 1.633 wins   predicted a certain win in every
//                                             remaining game 11.5% of the time
//   blend K=10                      1.199     0%
//   7+ games in    1.275 -> 0.730
//   record diverged from prior      1.935 -> 0.906
//
// Per-season best was K=16 (2024) and K=10 (2025), and everything from 8 to 18
// scores within 0.005 wins of the optimum — so this is the middle of a wide flat
// zone, not a tuned constant.
//
// Known residual: the blend over-predicts by ~0.23 wins on average, and the bias
// tracks schedule strength (+0.61 when the remaining schedule is harder than the
// one played, -0.58 when it is easier). Correcting that needs opponent strength
// in the term, which cannot be backtested honestly until 2026 has enough weekly
// spHistory — the stored SP+ for past seasons is end-of-season and knows how
// they finished.
const BLEND_GAMES = 10;

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

// Completed regular games, i.e. the sample the actual pace is measured over.
function gamesPlayed(teamId, games) {
    let n = 0;
    for (const g of games) {
        if (g.seasonType !== 'regular' || g.completed !== true) continue;
        if (g.homePoints == null || g.awayPoints == null) continue;
        if (g.homeId === teamId || g.awayId === teamId) n++;
    }
    return n;
}

// Expected wins from a team's REMAINING schedule (see BLEND_GAMES above).
// Returns null when there is no preseason number to anchor on, which the
// projection engine answers by falling back to its raw SP+ probabilities.
function remainingWinsTarget(expWins, teamId, allGames, remainingCount) {
    if (expWins == null) return null;
    if (!remainingCount) return 0;

    const played = gamesPlayed(teamId, allGames);
    const total = played + remainingCount;
    if (!total) return null;

    const priorPace = expWins / total;
    // Before a single game is played there is nothing to blend, so the preseason
    // pace carries the whole forecast.
    if (!played) return Math.min(Math.max(priorPace, 0), 1) * remainingCount;

    const actualPace = winsSoFar(teamId, allGames) / played;
    const weight = played / (played + BLEND_GAMES);
    const pace = (1 - weight) * priorPace + weight * actualPace;
    return Math.min(Math.max(pace, 0), 1) * remainingCount;
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
            const remExpWins = remainingWinsTarget(expWins, rosterTeam.id, all, remaining.length);
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

module.exports = { buildProjections, simulateTitleOdds, winsSoFar, gamesPlayed, remainingWinsTarget, BLEND_GAMES };
