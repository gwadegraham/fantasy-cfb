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

// The widest week range H2H could ever cover. A bound for the game queries, not
// the schedule itself — the actual range is derived per season by h2hWeekRange()
// below. The postseason is a separate seasonType, so nothing past this is in
// play here.
const H2H_MAX_WEEK = 16;

// A week is only an H2H week if it carries a real slate.
//
// H2H matchups run the fantasy regular season. Conference championship week and
// Army/Navy involve a handful of rostered teams, so a matchup decided there
// comes down to two or three games — which is why this range used to stop at a
// hardcoded week 14.
//
// That hardcode was correct for 2025 (regular season through wk 14, titles wk
// 15) and silently WRONG for 2026, whose calendar shifted a week: the last full
// slate is wk 13 (Nov 29), conference championships land in wk 14, and
// Army/Navy in wk 15. Cap-at-14 would have made championship week a scoring
// matchup. So the range is derived from the slate instead of assumed, and a
// future calendar shift can't move it again.
//
// `gamesByWeek` is { [week]: Game[] } for THIS league's rostered teams — the
// same set the caller already has, so this costs no extra query. A week counts
// when it holds at least `minShare` of the median week's slate: a normal week
// puts most of the league's teams on the field, championship week a couple.
// Returns the contiguous run from the first played week, because the thin weeks
// mark the end of the regular season rather than a gap inside it.
function h2hWeekRange(gamesByWeek, opts) {
    const o = opts || {};
    const maxWeek = o.maxWeek || H2H_MAX_WEEK;
    const minShare = o.minShare == null ? 0.4 : o.minShare;

    const counts = [];
    for (let w = 1; w <= maxWeek; w++) counts.push({ week: w, n: ((gamesByWeek || {})[w] || []).length });
    const played = counts.filter(c => c.n > 0);
    if (played.length < 2) return played.map(c => c.week);

    const sorted = played.map(c => c.n).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const threshold = Math.max(1, median * minShare);

    const out = [];
    for (const c of counts) {
        if (c.n === 0) {
            // A gap before any real slate (nothing scheduled yet) isn't the end
            // of the season; a gap after one is.
            if (!out.length) continue;
            break;
        }
        if (c.n < threshold) break;
        out.push(c.week);
    }
    return out;
}

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

// The FROZEN manager list stored for a league+season, or null if none yet.
// Reads a ScoringConfig doc (or lean object); kept here so the scoring-time pass
// and the standings read model can't disagree about where the pin lives.
function pinnedH2HIds(cfgDoc, season) {
    const bySeason = cfgDoc && cfgDoc.h2hScheduleBySeason;
    const entry = bySeason && (bySeason[String(season)] || bySeason[Number(season)]);
    const ids = entry && entry.ids;
    return (Array.isArray(ids) && ids.length) ? ids.map(String) : null;
}

// The EFFECTIVE manager list for a season's H2H — pinned if one has been stored,
// otherwise derived from who currently has a scored week.
//
// The pairing schedule is POSITIONAL (circle-method round robin), so this list's
// contents and order decide who plays whom in every week. Deriving it fresh on
// every pass was a latent history-rewriter: add or remove a manager mid-season
// and the round robin restructures (6 managers = 5 rounds, 7 = 7 rounds with a
// bye, and round 0's pairings differ entirely), so every already-settled week is
// re-decided under new pairings — and applyAwards, which rebuilds each week's
// bonus from base, duly moves the banked points to whoever now "won".
//
// So the caller pins the list the first time a week settles. Before that nothing
// is banked to protect, so the derived list is used and preseason roster churn
// costs nothing. After it, membership changes cannot touch decided weeks — a
// manager who joins later simply has no H2H schedule for that season.
function h2hRoster(users, season, pinned) {
    if (Array.isArray(pinned) && pinned.length) return pinned.map(String);
    return h2hManagerIds(users, season);
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
//   weeks       the derived H2H week range for this season
//   weekFinal   { [week]: bool }
//   finalWeeks  settled weeks, ascending
//   currentWeek the first week with games that hasn't settled (or null)
function computeH2HAwards({ users, games, season, winBonus, tieBonus, maxWeek, pinnedIds }) {
    const bound = maxWeek || H2H_MAX_WEEK;
    const ids = h2hRoster(users, season, pinnedIds);

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
            if (e.season === 'postseason' || e.week > bound) return;
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
        if (g.week == null || g.week > bound) return;
        if (!drafted.has(Number(g.homeId)) && !drafted.has(Number(g.awayId))) return;
        (gamesByWeek[g.week] = gamesByWeek[g.week] || []).push(g);
    });

    // Derived, not assumed — see h2hWeekRange.
    const weeks = h2hWeekRange(gamesByWeek, { maxWeek: bound });

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

    return { awards, weeks, weekFinal, finalWeeks, currentWeek, ids, schedule };
}

// Rebuild a season's weeklyScore with this manager's H2H awards folded in.
// Pure: takes and returns PLAIN objects (the caller assigns the result onto the
// document wholesale, which sidesteps subdocument-mutation quirks).
//
// Idempotent by construction — each entry's score is rebuilt from its base, so
// running this twice, re-running after a rescore, changing the configured bonus,
// or turning H2H off all converge on the right number instead of compounding.
// Returns { weeklyScore, changed }.
function applyAwards(weeklyScore, awardsForUser, maxWeek) {
    // `awardsForUser` is authoritative about which weeks earned a bonus, so the
    // bound only has to exclude the postseason — a regular week with no award
    // (including one outside the derived H2H range) gets any stale bonus
    // stripped, which is what makes turning the mode off self-correcting.
    const bound = maxWeek || H2H_MAX_WEEK;
    let changed = false;
    const next = (weeklyScore || []).map(entry => {
        const e = Object.assign({}, entry);
        const inRange = e.season !== 'postseason' && e.week <= bound;
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
    H2H_MAX_WEEK, h2hWeekRange, seasonEntry, baseWeekScore, persistedBonus,
    h2hManagerIds, h2hRoster, pinnedH2HIds, computeH2HAwards, applyAwards
};
