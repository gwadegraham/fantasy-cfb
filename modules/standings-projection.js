// Forward-looking standings analytics: projected final points + Monte-Carlo
// title odds per manager. Reuses the draft-grade projection engine
// (modules/draft-projection.js), but mid-season: points already banked +
// expected points from each rostered team's REMAINING schedule + expected
// postseason. Pure (no I/O) so it's unit-testable; the route feeds it data.

const { projectTeamPoints, spFor, winsFor } = require('./draft-projection');
const { scheduleForWeeks, matchupWinProb, H2H_MAX_WEEK } = require('./h2h');

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

// Standard deviation, in points, of the part of a manager's POSTSEASON haul the
// projection cannot see coming.
//
// simulateTitleOdds carries postseason as a single expected value — one number
// per manager, identical in all N sims. That is a claim that a ~70-point chunk
// of the season, a third of the final score, is already settled in September,
// and it is the reason a 16-point projected gap in week 3 came out as 93% title
// odds: the only thing left to vary was the regular season, whose 99 remaining
// games average out to a standard deviation of about 8.
//
// Measured against the 30 completed manager-seasons on file (2023-2025, both
// leagues): postseason points have a pooled WITHIN-league-season standard
// deviation of 16.4. Of that, the projection already anticipates 6.2 (the spread
// of its own per-manager postseason forecasts), leaving
// sqrt(16.4^2 - 6.2^2) = 15.2 that it does not. Rounded to 15.
//
// Additive rather than proportional because that is how it was measured — the
// spread did not track roster strength in a sample this size. It is applied to
// the FORECAST portion only (postRemaining), never to banked points, which are
// known; and the forecast is floored at zero, since a postseason cannot pay out
// negative points.
//
// Three caveats for whoever revisits this.
//
// 1. 30 manager-seasons is 24 degrees of freedom, and 2024 Claunts is inflated
//    by a single 117-point postseason. The direction is solid, the magnitude is
//    worth +/- a few points.
// 2. The draw is independent of the simulated regular season, but the two are
//    not: the same teams winning out is what puts a roster in the playoff and
//    wins it bowls. A title race between two managers therefore still misses
//    2*[Cov(reg,post)] of spread, which is positive — so these odds remain
//    somewhat too confident, in the same direction as the bug this fixes. It is
//    also worth noting that 15.2 was measured against REALISED postseason
//    points, so it already contains whatever the regular season explains;
//    injecting all of it independently is a defensible approximation, not the
//    estimator that was measured.
// 3. It does not shrink as the postseason actually resolves — every sim treats
//    the bowls as equally unknown in December as in September.
//
// The zero floor also means the draw is not strictly mean-zero: truncation
// lifts the drawn mean above the forecast. At the ~70-point forecasts this
// league produces that shift is about 1e-5 points, i.e. nothing, but it grows
// once a forecast drops under ~25 (+0.3) and would matter for a roster shut out
// of the postseason entirely.
const POSTSEASON_SD = 15;

// Box-Muller standard normal. Kept local: the only randomness this module needs
// beyond Math.random() is this one draw per manager per sim.
function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

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
        // The captain doubles ONE team's week, so the flat perGame list is not
        // enough — the same week's games have to stay grouped by team.
        const byWeek = {};
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
            const mine = [];
            (proj.perGame || []).forEach(pg => {
                perGame.push(pg);
                mine.push(pg);
                const wk = (byWeek[pg.week] = byWeek[pg.week] || []);
                let slot = wk.find(x => x.teamId === rosterTeam.id);
                if (!slot) { slot = { teamId: rosterTeam.id, games: [] }; wk.push(slot); }
                slot.games.push(pg);
            });
        }

        out.push({
            userId: String(u._id), name: nameOf(u), franchise: s.franchiseName || null,
            avatarUrl: u.avatarUrl || null, initials: initialsOf(u), color: u.color || null,
            banked: Math.round(banked),
            projectedFinal: Math.round(banked + expReg + expPost),
            postExpected: banked + expPost,   // banked + the postseason forecast
            // The forecast half of postExpected, split out so the sim can put
            // POSTSEASON_SD of uncertainty on it without disturbing banked points.
            postRemaining: expPost,
            perGame, byWeek, remainingCount,
            expCaptain: 0, expH2H: 0
        });
    }
    return out;
}


// --- engagement terms (Captain + H2H) ------------------------------------
//
// graham-league 2026 runs both, and banked points already include them — the
// scoring job applies them week by week. The FORWARD half of the projection did
// not, which understated every manager by 35-50 points, roughly a fifth of the
// projected total. Neither term moves the ranking much (both scale with roster
// quality), but "Projected final points" has to mean what it says.
//
// Both are regular-season only, matching modules/scoring.js: the captain is
// explicitly skipped in the postseason, and the H2H schedule stops at
// H2H_MAX_WEEK.

// Expected points a manager's captain adds in one week.
//
// A manager picks BEFORE kickoff, so the choice is the team with the highest
// expected score; the bonus is that team's realised score. The expectation of
// the bonus is therefore just that team's expected score — no simulation, and
// no peeking at results. (Taking the best team after the fact would be worth
// ~10 more points a season, which is the luck in the mechanic, not the skill.)
// A captained team that loses scores nothing, which falls out of the per-game
// probabilities: every regular-season rule requires a win.
function expectedCaptainWeek(teamsThisWeek, multiplier) {
    let best = 0;
    (teamsThisWeek || []).forEach(t => {
        let exp = 0;
        (t.games || []).forEach(g => { exp += (g.winProb || 0) * (g.pointsIfWin || 0); });
        if (exp > best) best = exp;
    });
    return best * ((multiplier || 2) - 1);
}

// Expected captain points across a manager's whole remaining schedule.
function expectedCaptain(byWeek, multiplier) {
    let total = 0;
    Object.keys(byWeek || {}).forEach(w => { total += expectedCaptainWeek(byWeek[w], multiplier); });
    return total;
}

// Expected H2H bonus per manager over the remaining weeks.
//
// Zero-sum by construction: each week pairs managers off and pays only the
// higher weekly total, so a six-manager league awards at most 3 x winBonus a
// week however well everyone plays. The pairing schedule is POSITIONAL, so the
// id list and its order must match what the scoring job uses (pinnedH2HIds) or
// the matchups are not the ones that will actually be played.
function expectedH2H(managers, ids, weeks, winBonus, tieBonus) {
    const out = {};
    (ids || []).forEach(id => { out[id] = 0; });
    if (!ids || ids.length < 2 || !weeks.length) return out;

    const byId = {};
    managers.forEach(m => { byId[m.userId] = m; });
    const schedule = scheduleForWeeks(ids, weeks);

    weeks.forEach(w => {
        (schedule[w] || []).forEach(([a, b]) => {
            const ma = byId[a], mb = byId[b];
            if (!ma || !mb) return;
            const flat = (m) => ((m.byWeek || {})[w] || []).flatMap(t => t.games || []);
            const prob = matchupWinProb(flat(ma), flat(mb));
            if (!prob) return;
            // matchupWinProb folds ties into `a` at half weight, which is the
            // right call for a win-probability bar but loses the tie mass a
            // bonus needs. Recover it from the raw distributions.
            const pA = prob.a, pB = prob.b;
            out[a] += winBonus * pA;
            out[b] += winBonus * pB;
        });
    });
    return out;
}

// Attach both engagement terms to already-built managers, in place. `engagement`
// is the season's resolved entry (see modules/scoring-defaults). Returns the
// same array so callers can chain.
function applyEngagement(managers, engagement, opts = {}) {
    const eng = engagement || {};
    if (eng.captainEnabled) {
        managers.forEach(m => {
            m.expCaptain = expectedCaptain(m.byWeek, eng.captainMultiplier);
            m.projectedFinal = Math.round(m.projectedFinal + m.expCaptain);
        });
    }
    if (eng.h2hEnabled) {
        const weeks = [...new Set(managers.flatMap(m => Object.keys(m.byWeek || {}).map(Number)))]
            .filter(w => w <= (opts.maxWeek || H2H_MAX_WEEK))
            .sort((a, b) => a - b);
        const ids = (opts.pinnedIds && opts.pinnedIds.length)
            ? opts.pinnedIds.filter(id => managers.some(m => m.userId === id))
            : managers.map(m => m.userId);
        const h = expectedH2H(managers, ids, weeks, eng.h2hWinBonus || 0, eng.h2hTieBonus || 0);
        managers.forEach(m => {
            m.expH2H = h[m.userId] || 0;
            m.projectedFinal = Math.round(m.projectedFinal + m.expH2H);
        });
    }
    return managers;
}

// Light Monte-Carlo: sim the remaining regular games N times, draw each
// manager's postseason haul around its forecast (see POSTSEASON_SD), and count
// how often each finishes 1st. Ties split the championship credit. Returns
// titleOdds (0..1) keyed by userId.
//
// The postseason draw is what keeps the odds honest early in the year. Without
// it the only thing that varied was ~99 regular-season games, which average out
// to a standard deviation of about 8 points, so any projected gap wider than
// ~15 read as a near-certainty in week 3.
//
// Two paths. Without engagement the games are independent draws and order does
// not matter, so the flat perGame list is simulated directly. With Captain or
// H2H switched on the week structure becomes load-bearing — the captain doubles
// one team's week, and H2H compares two managers' weekly totals — so the sim
// walks week by week instead. The totals and the odds then come from the same
// model, rather than the tile including engagement points the odds ignore.
function simulateTitleOdds(managers, N, opts = {}) {
    N = N || 5000;
    const eng = opts.engagement || {};
    const weekly = !!(eng.captainEnabled || eng.h2hEnabled)
        && managers.some(m => m.byWeek && Object.keys(m.byWeek).length);

    const wins = {};
    managers.forEach(m => { wins[m.userId] = 0; });

    let weeks = [], schedule = {}, captainPick = {};
    if (weekly) {
        weeks = [...new Set(managers.flatMap(m => Object.keys(m.byWeek || {}).map(Number)))].sort((a, b) => a - b);
        if (eng.h2hEnabled) {
            const ids = (opts.pinnedIds && opts.pinnedIds.length)
                ? opts.pinnedIds.filter(id => managers.some(m => m.userId === id))
                : managers.map(m => m.userId);
            const h2hWeeks = weeks.filter(w => w <= (opts.maxWeek || H2H_MAX_WEEK));
            schedule = scheduleForWeeks(ids, h2hWeeks);
        }
        // The captain is chosen before kickoff, so which team gets doubled is
        // fixed per week and does NOT vary between sims. Resolve it once.
        managers.forEach(m => {
            const perWeek = {};
            weeks.forEach(w => {
                const list = (m.byWeek || {})[w] || [];
                let bestIdx = -1, bestExp = -1;
                list.forEach((t, i) => {
                    let exp = 0;
                    (t.games || []).forEach(g => { exp += (g.winProb || 0) * (g.pointsIfWin || 0); });
                    if (exp > bestExp) { bestExp = exp; bestIdx = i; }
                });
                perWeek[w] = bestIdx;
            });
            captainPick[m.userId] = perWeek;
        });
    }

    // Managers built by anything other than buildProjections (unit tests, and any
    // future caller) carry no postRemaining, so they get no postseason draw and
    // behave exactly as before.
    const postSd = opts.postseasonSd == null ? POSTSEASON_SD : opts.postseasonSd;

    for (let s = 0; s < N; s++) {
        const total = {};
        managers.forEach(m => {
            const forecast = m.postRemaining || 0;
            const drawn = (postSd && forecast)
                ? Math.max(0, forecast + postSd * gaussian())
                : forecast;
            total[m.userId] = m.postExpected - forecast + drawn;
        });

        if (!weekly) {
            managers.forEach(m => {
                for (const g of m.perGame) if (Math.random() < g.winProb) total[m.userId] += g.pointsIfWin;
            });
        } else {
            for (const w of weeks) {
                const weekTotal = {};
                for (const m of managers) {
                    const list = (m.byWeek || {})[w] || [];
                    let sum = 0, captained = 0;
                    const pick = captainPick[m.userId][w];
                    list.forEach((t, i) => {
                        let ts = 0;
                        (t.games || []).forEach(g => { if (Math.random() < g.winProb) ts += g.pointsIfWin; });
                        sum += ts;
                        if (i === pick) captained = ts;   // a captain that loses doubles nothing
                    });
                    if (eng.captainEnabled) sum += captained * ((eng.captainMultiplier || 2) - 1);
                    weekTotal[m.userId] = sum;
                    total[m.userId] += sum;
                }
                (schedule[w] || []).forEach(([a, b]) => {
                    if (weekTotal[a] == null || weekTotal[b] == null) return;
                    if (weekTotal[a] > weekTotal[b]) total[a] += eng.h2hWinBonus || 0;
                    else if (weekTotal[b] > weekTotal[a]) total[b] += eng.h2hWinBonus || 0;
                    else { total[a] += eng.h2hTieBonus || 0; total[b] += eng.h2hTieBonus || 0; }
                });
            }
        }

        let best = -Infinity, leaders = [];
        managers.forEach(m => {
            const v = total[m.userId];
            if (v > best + 1e-9) { best = v; leaders = [m.userId]; }
            else if (Math.abs(v - best) <= 1e-9) leaders.push(m.userId);
        });
        const share = 1 / leaders.length;
        leaders.forEach(id => { wins[id] += share; });
    }
    const odds = {};
    managers.forEach(m => { odds[m.userId] = wins[m.userId] / N; });
    return odds;
}

module.exports = { buildProjections, simulateTitleOdds, winsSoFar, gamesPlayed, remainingWinsTarget,
                   expectedCaptainWeek, expectedCaptain, expectedH2H, applyEngagement, BLEND_GAMES,
                   POSTSEASON_SD };
