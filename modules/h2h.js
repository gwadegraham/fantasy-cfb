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
function resolveWeek(pairs, totals, winBonus) {
    const out = {};
    (pairs || []).forEach(([a, b]) => {
        const fa = totals[a] || 0, fb = totals[b] || 0;
        let ra, rb, ba, bb;
        if (fa > fb) { ra = 'W'; rb = 'L'; ba = winBonus; bb = 0; }
        else if (fb > fa) { ra = 'L'; rb = 'W'; ba = 0; bb = winBonus; }
        else { ra = rb = 'T'; ba = bb = 0; }   // ties push — no bonus
        out[a] = { result: ra, bonus: ba, opponent: b, for: fa, against: fb };
        out[b] = { result: rb, bonus: bb, opponent: a, for: fb, against: fa };
    });
    return out;
}

// Full-season head-to-head standings. `totalsByIdWeek` is { [id]: { [week]: total } }.
// Returns { [id]: { wins, losses, ties, bonus, pointsFor, pointsAgainst, weeks: [ {week, ...resolveWeek entry} ] } }.
function seasonH2H(ids, weeks, totalsByIdWeek, winBonus) {
    const schedule = scheduleForWeeks(ids, weeks);
    const acc = {};
    ids.forEach(id => { acc[id] = { wins: 0, losses: 0, ties: 0, bonus: 0, pointsFor: 0, pointsAgainst: 0, weeks: [] }; });
    weeks.forEach(w => {
        const totals = {};
        ids.forEach(id => { totals[id] = (totalsByIdWeek[id] && totalsByIdWeek[id][w]) || 0; });
        const res = resolveWeek(schedule[w] || [], totals, winBonus);
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

module.exports = { buildRoundRobin, scheduleForWeeks, resolveWeek, seasonH2H };
