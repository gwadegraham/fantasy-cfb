// Per-contributor parlay stats for the betting page's "Bettors" panel.
//
// A parlay is one slip PER GROUP per week, but each leg carries a `contributor`
// and its own win/loss/push — so the group's record says nothing about who is
// actually picking well. This is that breakdown.
//
// DB-free: routes/betting.js hands it the season's parlays and the member list.
//
// Pushes are excluded from the hit-rate denominator, the way a sportsbook
// treats them — a push is no action, and counting it as a half-loss would
// punish someone for a number landing exactly on the line.

// A leg that has been settled one way or the other.
function isSettled(leg) {
    return leg && (leg.result === 'win' || leg.result === 'loss' || leg.result === 'push');
}

// THE fun stat. A leg that was the ONLY loss on its slip: four people picked,
// three were right, and this is the one that cost everyone the payout.
//
// Deliberately not "was on a losing slip" — on a slip that lost 3-1 the other
// three did their jobs, and blaming them for it would make the number mean
// nothing. A slip that lost by two or more has no solo killer, by design.
function soloKillerIds(parlay) {
    const settled = (parlay.legs || []).filter(isSettled);
    const losses = settled.filter(l => l.result === 'loss');
    if (losses.length !== 1) return [];
    // Everything else on the slip has to have actually come in — a slip with an
    // unsettled leg isn't finished, so nobody has killed anything yet.
    const rest = settled.filter(l => l.result !== 'loss');
    if (rest.length !== (parlay.legs || []).length - 1) return [];
    return [String(losses[0].contributor)];
}

// Longest shot that landed. American odds: +150 pays better than -110, and
// among favourites -110 is longer than -300, so "riskiest" is simply the
// highest number on the line.
function riskierOdds(a, b) {
    if (a == null) return b;
    if (b == null) return a;
    return Number(b) > Number(a) ? b : a;
}

// W/L run ending at the most recent settled leg, as { type, count }. Pushes are
// skipped rather than breaking a run, for the same reason they're out of the
// hit rate: nothing happened.
function streakOf(results) {
    const settled = results.filter(r => r === 'win' || r === 'loss');
    if (!settled.length) return null;
    const type = settled[settled.length - 1];
    let count = 0;
    for (let i = settled.length - 1; i >= 0 && settled[i] === type; i--) count++;
    return { type, count };
}

// Per-contributor rows for a season.
//
// `parlays` are the group's slips for that season; `members` is [{ id, name }]
// so someone who has not picked yet still appears with an empty row rather than
// vanishing — a missing manager reads as a bug, and the group is small enough
// that everyone belongs on the board.
//
// Rows come back sorted: best hit rate first, more settled legs breaking a tie
// (3-0 beats 1-0), then name. Anyone with nothing settled sorts to the bottom
// regardless, since a 0% and a no-legs row are not the same thing.
//
// The name tiebreak only does anything when `members` carried names. The HTTP
// caller doesn't send them — the browser already holds them for the leg rows,
// so looking them up again server-side would be a second query for data that is
// already on the page — and two managers on identical records would otherwise
// order by whatever the group's member list says. public/betting.js re-sorts
// with the real names for exactly that case; this ordering is what a caller
// that does supply names gets.
function contributorStats(parlays, members) {
    const rows = new Map();
    const row = (id, name) => {
        const key = String(id);
        if (!rows.has(key)) {
            rows.set(key, {
                contributor: key, name: name || 'Member',
                legs: 0, wins: 0, losses: 0, pushes: 0, pending: 0,
                soloKills: 0, bestOdds: null, results: []
            });
        }
        return rows.get(key);
    };

    (members || []).forEach(m => row(m.id, m.name));

    // Oldest first, so `results` reads left-to-right in time and the streak is
    // taken from the right end.
    const ordered = (parlays || []).slice().sort((a, b) => (a.week || 0) - (b.week || 0));

    ordered.forEach(parlay => {
        const killers = soloKillerIds(parlay);
        (parlay.legs || []).forEach(leg => {
            if (!leg || leg.contributor == null) return;
            const r = row(leg.contributor);
            r.legs++;
            if (leg.result === 'win') {
                r.wins++;
                r.results.push('win');
                r.bestOdds = riskierOdds(r.bestOdds, leg.odds);
            } else if (leg.result === 'loss') {
                r.losses++;
                r.results.push('loss');
            } else if (leg.result === 'push') {
                r.pushes++;
                r.results.push('push');
            } else {
                r.pending++;
            }
        });
        killers.forEach(id => { if (rows.has(id)) rows.get(id).soloKills++; });
    });

    const out = [...rows.values()].map(r => {
        const decided = r.wins + r.losses;
        return Object.assign(r, {
            decided,
            // null, not 0 — "hasn't had a leg settle" is not "never wins".
            hitRate: decided ? Math.round((r.wins / decided) * 1000) / 10 : null,
            streak: streakOf(r.results)
        });
    });

    out.sort((a, b) => {
        if ((a.hitRate == null) !== (b.hitRate == null)) return a.hitRate == null ? 1 : -1;
        if (a.hitRate !== b.hitRate) return b.hitRate - a.hitRate;
        if (a.decided !== b.decided) return b.decided - a.decided;
        return String(a.name).localeCompare(String(b.name));
    });
    return out;
}

// Group-wide superlatives, awarded from the rows above. Each is null when
// nothing earns it — an award nobody deserves is worse than no award, and a
// "coldest" badge on a 1-1 record in September is just noise.
//
// `minDecided` keeps a single lucky leg from taking a title off someone with a
// real sample.
function superlatives(rows, minDecided) {
    const min = minDecided == null ? 2 : minDecided;
    const eligible = (rows || []).filter(r => r.decided >= min);

    const best = eligible.length
        ? eligible.reduce((a, b) => (b.hitRate > a.hitRate
            || (b.hitRate === a.hitRate && b.decided > a.decided)) ? b : a)
        : null;
    const worst = eligible.length
        ? eligible.reduce((a, b) => (b.hitRate < a.hitRate
            || (b.hitRate === a.hitRate && b.decided > a.decided)) ? b : a)
        : null;

    const killed = (rows || []).filter(r => r.soloKills > 0);
    const killer = killed.length
        ? killed.reduce((a, b) => b.soloKills > a.soloKills ? b : a)
        : null;

    const withOdds = (rows || []).filter(r => r.bestOdds != null);
    const longest = withOdds.length
        ? withOdds.reduce((a, b) => Number(b.bestOdds) > Number(a.bestOdds) ? b : a)
        : null;

    return {
        // Only a genuinely clean record earns this; "best of a bad bunch" does not.
        perfect: best && best.losses === 0 && best.wins > 0 ? best : null,
        hottest: best && best.hitRate > 50 ? best : null,
        coldest: worst && best !== worst && worst.hitRate < 50 ? worst : null,
        killer,
        longest
    };
}

module.exports = { contributorStats, superlatives, soloKillerIds, streakOf, riskierOdds, isSettled };
