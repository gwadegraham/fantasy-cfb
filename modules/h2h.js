// Head-to-head scheduling + matchup resolution for the optional weekly
// "win-bonus" engagement format (see GitHub #230). A round-robin schedule pairs
// the managers each regular week; the higher weekly total wins a flat point
// bonus that folds into the season total. Pure + DB-free so it's unit-testable
// and shared by the scoring job, the standings route, and backtests. Managers
// are stable id strings; the caller supplies weekly totals.

// Circle-method round-robin. Returns an array of rounds; each round is an array
// of [idA, idB] pairs. With an odd number of managers one sits out each round
// (a "bye" — no pair emitted for them). The id order is the caller's to fix, so
// the schedule is deterministic for a given league+season.
function buildRoundRobin(ids) {
    const arr = ids.slice();
    if (arr.length < 2) return [];
    if (arr.length % 2 === 1) arr.push('BYE');
    const n = arr.length;
    const fixed = arr[0];
    let rot = arr.slice(1);
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
        const line = [fixed, ...rot];
        const pairs = [];
        for (let i = 0; i < n / 2; i++) {
            const a = line[i], b = line[n - 1 - i];
            if (a !== 'BYE' && b !== 'BYE') pairs.push([a, b]);
        }
        rounds.push(pairs);
        rot = [rot[rot.length - 1], ...rot.slice(0, -1)];   // rotate all but the fixed slot
    }
    return rounds;
}

// Map each week number to its pairings, cycling the round-robin so pairings
// stay balanced across a long season. `weeks` is an ordered list of week
// numbers (e.g. [1..16]). Returns { [week]: [[a,b], ...] }.
function scheduleForWeeks(ids, weeks) {
    const rounds = buildRoundRobin(ids);
    const out = {};
    if (!rounds.length) return out;
    weeks.forEach((w, i) => { out[w] = rounds[i % rounds.length]; });
    return out;
}

// Resolve one week's matchups. `totals` is { [id]: weeklyTotal } (missing → 0).
// Returns { [id]: { result: 'W'|'L'|'T', bonus, opponent, for, against } } for
// every manager who had a matchup that week (managers on a bye are omitted).
function resolveWeek(pairs, totals, winBonus, tieBonus) {
    tieBonus = tieBonus || 0;   // default 0 keeps the original "ties push" behavior
    const out = {};
    (pairs || []).forEach(([a, b]) => {
        const fa = totals[a] || 0, fb = totals[b] || 0;
        let ra, rb, ba, bb;
        if (fa > fb) { ra = 'W'; rb = 'L'; ba = winBonus; bb = 0; }
        else if (fb > fa) { ra = 'L'; rb = 'W'; ba = 0; bb = winBonus; }
        else { ra = rb = 'T'; ba = bb = tieBonus; }   // ties: each gets the tie bonus (0 = push)
        out[a] = { result: ra, bonus: ba, opponent: b, for: fa, against: fb };
        out[b] = { result: rb, bonus: bb, opponent: a, for: fb, against: fa };
    });
    return out;
}

// Full-season head-to-head standings. `totalsByIdWeek` is { [id]: { [week]: total } }.
// Returns { [id]: { wins, losses, ties, bonus, pointsFor, pointsAgainst, weeks: [ {week, ...resolveWeek entry} ] } }.
function seasonH2H(ids, weeks, totalsByIdWeek, winBonus, tieBonus) {
    const schedule = scheduleForWeeks(ids, weeks);
    const acc = {};
    ids.forEach(id => { acc[id] = { wins: 0, losses: 0, ties: 0, bonus: 0, pointsFor: 0, pointsAgainst: 0, weeks: [] }; });
    weeks.forEach(w => {
        const totals = {};
        ids.forEach(id => { totals[id] = (totalsByIdWeek[id] && totalsByIdWeek[id][w]) || 0; });
        const res = resolveWeek(schedule[w] || [], totals, winBonus, tieBonus);
        Object.keys(res).forEach(id => {
            const r = res[id], a = acc[id];
            if (r.result === 'W') a.wins++;
            else if (r.result === 'L') a.losses++;
            else a.ties++;
            a.bonus += r.bonus;
            a.pointsFor += r.for;
            a.pointsAgainst += r.against;
            a.weeks.push({ week: w, ...r });
        });
    });
    return acc;
}

// H2H matchups run the fantasy regular season only. Weeks 15+ (conference
// championships, Army/Navy) and the postseason still count toward season totals,
// but their thin slates make for unfair matchups — so no H2H past this cap.
// Shared by the standings read model and the scoring-time persistence pass so
// they can never disagree on the range.
const H2H_LAST_WEEK = 14;

// The season subdocument for a user, tolerating both document shapes in use:
// a full `seasons` array (routes querying by league) and a single-entry array
// from an $elemMatch projection (GET /users/season/:year).
function seasonEntry(user, season) {
    return ((user && user.seasons) || []).find(s => String(s.season) === String(season)) || null;
}

// The BASE (pre-bonus) weekly total for a stored weeklyScore entry.
//
// The H2H win bonus is folded INTO entry.score once awarded (the same way the
// Captain bonus is), so it reaches cumulativeScore and every surface that reads
// it. That means matchups must always be resolved from the base — resolving from
// entry.score would feed a week's own bonus back into deciding that week, and a
// rescore would compound it. Subtracting the stored bonus is what makes the
// whole pass idempotent.
function baseWeekScore(entry) {
    if (!entry) return 0;
    return (entry.score || 0) - (entry.h2hBonus || 0);
}

// The bonus already folded into a season's stored scores. The standings read
// model subtracts this from the bonus it computes, so it renders the same total
// whether or not the scoring job has persisted the current values yet.
function persistedBonus(season) {
    return ((season && season.weeklyScore) || [])
        .reduce((sum, e) => sum + (e.h2hBonus || 0), 0);
}

// The managers in a league+season's H2H, as a DETERMINISTIC id list.
//
// The pairing schedule is positional (circle-method round robin), so the id
// ORDER decides who plays whom. Sorting by id makes that stable regardless of
// document order — previously the list came back in Mongo's natural order, so
// an unrelated write could in principle reshuffle a season's matchups. Managers
// with no scored week yet are excluded (nothing to match up), which is what
// keeps the preseason empty rather than a table of 0-0-0 rows.
function h2hManagerIds(users, season) {
    return (users || [])
        .filter(u => {
            const s = seasonEntry(u, season);
            return !!(s && (s.weeklyScore || []).length);
        })
        .map(u => String(u._id))
        .sort();
}

const round1 = (v) => Math.round(v * 10) / 10;

// The single source of truth for "who won which H2H week, and what is it worth".
// Used by BOTH the standings read model and the scoring-time persistence pass,
// so the number shown in the standings and the number banked in cumulativeScore
// come from the same computation.
//
// A week only settles once every game involving a drafted team is complete AND
// somebody has been scored for it — an in-progress week has no decided winner.
//
// `users` are docs (or lean objects) carrying the season's teams + weeklyScore;
// `games` are that season's regular-season games involving drafted teams.
// Returns:
//   awards      { [userId]: { [week]: { result, bonus, opponent, for, against } } }
//   weekFinal   { [week]: bool }
//   finalWeeks  settled weeks, ascending
//   currentWeek the first week with games that hasn't settled (or null)
function computeH2HAwards({ users, games, season, winBonus, tieBonus, lastWeek }) {
    const last = lastWeek || H2H_LAST_WEEK;
    const weeks = Array.from({ length: last }, (_, i) => i + 1);
    const ids = h2hManagerIds(users, season);

    const awards = {};
    ids.forEach(id => { awards[id] = {}; });

    // Base weekly totals + which weeks anyone has been scored for.
    const totals = {}, scored = new Set(), drafted = new Set();
    (users || []).forEach(u => {
        const s = seasonEntry(u, season);
        if (!s) return;
        ((s.teams) || []).forEach(t => drafted.add(Number(t.id)));
        const id = String(u._id);
        if (!awards[id]) return;
        const tw = {};
        (s.weeklyScore || []).forEach(e => {
            if (e.season === 'postseason' || e.week > last) return;
            tw[e.week] = (tw[e.week] || 0) + baseWeekScore(e);
            scored.add(e.week);
        });
        totals[id] = tw;
    });

    // A week's games, restricted to the ones that can gate it: regular season,
    // in range, involving a drafted team.
    const gamesByWeek = {};
    (games || []).forEach(g => {
        if (g.seasonType && g.seasonType !== 'regular') return;
        if (g.week == null || g.week > last) return;
        if (!drafted.has(Number(g.homeId)) && !drafted.has(Number(g.awayId))) return;
        (gamesByWeek[g.week] = gamesByWeek[g.week] || []).push(g);
    });

    const weekFinal = {};
    weeks.forEach(w => { weekFinal[w] = isWeekFinal(gamesByWeek[w]) && scored.has(w); });
    const finalWeeks = weeks.filter(w => weekFinal[w]);
    let currentWeek = null;
    for (const w of weeks) {
        if ((gamesByWeek[w] || []).length && !weekFinal[w]) { currentWeek = w; break; }
    }

    const schedule = scheduleForWeeks(ids, weeks);
    finalWeeks.forEach(w => {
        const wt = {};
        ids.forEach(id => { wt[id] = (totals[id] && totals[id][w]) || 0; });
        const res = resolveWeek(schedule[w] || [], wt, winBonus, tieBonus);
        Object.keys(res).forEach(id => { awards[id][w] = res[id]; });
    });

    return { awards, weekFinal, finalWeeks, currentWeek, ids, schedule };
}

// Rebuild a season's weeklyScore with this manager's H2H awards folded in.
// Pure: takes and returns PLAIN objects (the caller assigns the result onto the
// document wholesale, which sidesteps subdocument-mutation quirks).
//
// Idempotent by construction — each entry's score is rebuilt from its base, so
// running this twice, re-running after a rescore, changing the configured bonus,
// or turning H2H off all converge on the right number instead of compounding.
// Returns { weeklyScore, changed }.
function applyAwards(weeklyScore, awardsForUser, lastWeek) {
    const last = lastWeek || H2H_LAST_WEEK;
    let changed = false;
    const next = (weeklyScore || []).map(entry => {
        const e = Object.assign({}, entry);
        const inRange = e.season !== 'postseason' && e.week <= last;
        const award = inRange ? ((awardsForUser || {})[e.week] || null) : null;

        const base = baseWeekScore(e);
        const bonus = award ? (award.bonus || 0) : 0;
        const score = round1(base + bonus);
        const result = award ? award.result : null;
        const opponent = award ? String(award.opponent) : null;

        const wasBonus = e.h2hBonus || 0;
        const wasResult = e.h2hResult || null;
        const wasOpponent = e.h2hOpponentId ? String(e.h2hOpponentId) : null;
        if (wasBonus !== bonus || (e.score || 0) !== score || wasResult !== result || wasOpponent !== opponent) {
            changed = true;
        }

        e.score = score;
        // Absent rather than zeroed when there's no matchup, matching how the
        // Captain fields are stored.
        if (bonus) e.h2hBonus = bonus; else delete e.h2hBonus;
        if (result) e.h2hResult = result; else delete e.h2hResult;
        if (opponent) e.h2hOpponentId = opponent; else delete e.h2hOpponentId;
        return e;
    });
    return { weeklyScore: next, changed };
}

// Classify a game's live state for in-progress matchup display.
//   completed          -> 'final'
//   kickoff passed     -> 'live'
//   kickoff known+future -> 'scheduled'
//   time TBD / unparseable -> 'scheduled'
// `now` is a ms timestamp (injected so it's testable).
function gameStatus(game, now) {
    if (!game) return 'bye';
    if (game.completed) return 'final';
    if (game.startTimeTbd) return 'scheduled';
    const t = game.startDate ? Date.parse(game.startDate) : NaN;
    if (isNaN(t)) return 'scheduled';
    return t <= now ? 'live' : 'scheduled';
}

// A week is "final" (counts toward records) only once every drafted-team game
// that week is completed. `games` is the week's games involving rostered teams.
function isWeekFinal(games) {
    return Array.isArray(games) && games.length > 0 && games.every(g => g.completed);
}

// Projected win probability for a single week's matchup, reusing the same model
// the draft-grade / standings projections use: each rostered team wins its game
// with `winProb` and, if it wins, contributes `pointsIfWin` fantasy points (0 on
// a loss — the projection engine's own assumption). A manager's weekly total is
// therefore a sum of independent scaled Bernoullis. We build each side's exact
// score distribution (DP convolution, points bucketed to whole numbers to bound
// the state space) and cross them to get P(A > B); ties split evenly.
//
// `aEntries` / `bEntries` are arrays of { winProb, pointsIfWin } (teams on a bye
// omitted). Returns { a, b } probabilities in [0,1] summing to 1, or null when
// neither side has a game to project. Deterministic — no RNG — so it's testable.
function scoreDistribution(entries) {
    let dist = new Map([[0, 1]]);
    (entries || []).forEach(e => {
        const p = Math.max(0, Math.min(1, e.winProb || 0));
        const pts = Math.max(0, Math.round(e.pointsIfWin || 0));   // whole-point buckets
        const next = new Map();
        const add = (k, v) => { if (v) next.set(k, (next.get(k) || 0) + v); };
        dist.forEach((prob, sum) => {
            add(sum, prob * (1 - p));       // team loses → +0
            add(sum + pts, prob * p);       // team wins  → +pointsIfWin
        });
        dist = next;
    });
    return dist;
}

function matchupWinProb(aEntries, bEntries) {
    if (!(aEntries || []).length && !(bEntries || []).length) return null;
    const da = scoreDistribution(aEntries), db = scoreDistribution(bEntries);
    let aWin = 0, tie = 0;
    da.forEach((pa, sa) => db.forEach((pb, sb) => {
        if (sa > sb) aWin += pa * pb;
        else if (sa === sb) tie += pa * pb;
    }));
    const a = aWin + tie / 2;
    return { a, b: 1 - a };
}

module.exports = {
    buildRoundRobin, scheduleForWeeks, resolveWeek, seasonH2H,
    gameStatus, isWeekFinal, matchupWinProb,
    H2H_LAST_WEEK, seasonEntry, baseWeekScore, persistedBonus,
    h2hManagerIds, computeH2HAwards, applyAwards
};
