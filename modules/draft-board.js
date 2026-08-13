// Live draft advice: given the projected value of every team and the picks made
// so far, what should this manager do with their next pick?
//
// Pure and I/O-free — the route supplies the projections and the draft doc, the
// client re-runs nothing. All the interesting logic is the scarcity question,
// not the ranking one.
//
// WHY SCARCITY AND NOT "BEST AVAILABLE": in this league every roster spot is
// interchangeable — there are no positions, so a roster's value is just the sum
// of its teams. That makes "who is best?" trivial (the top of the board) and
// pushes the real decision onto "who will still be here next time?". A manager
// picking 2nd in a 6-team snake waits 9 picks between round 1 and round 2, then
// 3 picks between rounds 2 and 3. What they give up by waiting is entirely a
// function of that gap, so that's what this models.

const engine = require('./draft-engine');

// Overall pick numbers belonging to one manager, in order.
function picksFor(draft, userId) {
    if (!draft || !userId) return [];
    return engine.pickOrder(draft)
        .filter(p => String(p.userId) === String(userId))
        .map(p => ({ overall: p.overall, round: p.round }));
}

// This manager's upcoming picks: the one they're waiting on and the one after.
// `gap` is how many OTHER managers pick in between — the number of teams that
// can come off the board while they wait. null `next` means they're done.
function pickSchedule(draft, userId) {
    const current = (draft && draft.currentOverall) || 1;
    const mine = picksFor(draft, userId).filter(p => p.overall >= current);
    const next = mine[0] || null;
    const after = mine[1] || null;
    return {
        next, after,
        onTheClock: !!next && next.overall === current,
        // Picks by others between this manager's next two turns.
        gap: (next && after) ? (after.overall - next.overall - 1) : null
    };
}

// Teams not yet drafted, best first. `projections` is [{ id, school, ... , total }].
function available(projections, draft) {
    const taken = new Set(((draft && draft.picks) || [])
        .map(p => p.team && p.team.id).filter(id => id != null).map(String));
    return (projections || [])
        .filter(t => !taken.has(String(t.id)))
        .sort((a, b) => b.total - a.total);
}

// --- captain -----------------------------------------------------------------
//
// The weekly Captain multiplies ONE rostered team's score, regular season only.
// Captain the same team every week and you bank its entire REGULAR projection
// again — so a roster's captain value is just its best regular projection, and a
// new team is worth extra only if it RAISES that.
//
// The consequence that matters at the table: the multiplier never touches
// postseason points. Two teams level on total value are not level if one earns
// its points in the playoff — Ohio State (34.4 total, 21.9 regular) and Texas
// (34.3 total, 24.0 regular) are a tenth apart on the board and two points apart
// once the captain is priced in.
//
// Simplification, stated on the page: optimal play captains the best EXPECTED
// team each week, which occasionally isn't the anchor (a bye, a soft matchup for
// a lesser team). True captain value is therefore a little higher than this, so
// the figure is a floor, like the scarcity estimate.

// Best regular projection already on the roster. 0 for an empty roster, which is
// what makes a first-round pick's whole regular projection count.
function captainAnchor(roster) {
    return (roster || []).reduce(function (best, r) {
        return (r && typeof r.regular === 'number' && r.regular > best) ? r.regular : best;
    }, 0);
}

// What a candidate adds in captain points: the amount it lifts the anchor,
// scaled by the multiplier (a 2x captain banks the difference once).
function captainGain(team, anchorRegular, multiplier) {
    if (!team || typeof team.regular !== 'number') return 0;
    var lift = team.regular - (anchorRegular || 0);
    if (lift <= 0) return 0;
    return Math.round(lift * ((multiplier || 2) - 1) * 10) / 10;
}

// Value of a team TO THIS ROSTER: board value plus whatever captain upgrade it
// brings. With the captain off, or once the anchor can't be beaten, this is just
// the board value.
function effectiveValue(team, captain) {
    if (!captain || !captain.enabled) return team.total;
    return Math.round((team.total + captainGain(team, captain.anchorRegular, captain.multiplier)) * 10) / 10;
}

// The advice itself.
//
// `gap` other managers pick before this manager's turn comes round again, so as
// a first approximation the top `gap` teams on the board will be gone. That is
// deliberately pessimistic — it assumes every other manager takes the best team
// left, which they demonstrably do not (this league drafts on brand: in 2025
// Indiana went 31st and scored a league-high 58). Treating it as a floor rather
// than a forecast is the honest reading, and it still answers the only question
// that matters at the table: of the teams I want, which survive the wait?
//
// Returns:
//   take        — the best team available now
//   cost        — points given up by passing on `take` and picking at the next
//                 turn instead (its value minus the best expected to survive)
//   atRisk      — teams likely gone before the manager picks again
//   safeToWait  — teams likely still there, so no need to spend this pick on one
function advise(availableTeams, schedule, opts = {}) {
    const list = availableTeams || [];          // market order: by board value
    const captain = opts.captain || null;
    // Two orders, deliberately. The MARKET prices on board value — that's what
    // decides who is gone when the turn comes round. What I should BUY is priced
    // on value to my roster, which includes a captain upgrade the market has no
    // reason to care about. Ranking both the same way would quietly assume the
    // other five managers are drafting for my roster.
    const best = (pool) => pool.reduce((b, t) =>
        (b == null || effectiveValue(t, captain) > effectiveValue(b, captain)) ? t : b, null);

    const take = best(list);
    const captainInfo = captain && captain.enabled ? {
        enabled: true,
        anchorRegular: captain.anchorRegular || 0,
        anchorSchool: captain.anchorSchool || null,
        // The upgrade this specific pick buys.
        gain: take ? captainGain(take, captain.anchorRegular, captain.multiplier) : 0,
        // True when nothing left on the board could beat the anchor — the captain
        // slot is decided and per-week value can be ignored for the rest of the
        // draft, which is worth saying rather than leaving to be worked out.
        settled: !list.some(t => captainGain(t, captain.anchorRegular, captain.multiplier) > 0)
    } : { enabled: false, gain: 0, settled: false };

    if (!take || schedule.gap == null) {
        return { take, cost: null, atRisk: [], safeToWait: [], survivorRank: null, captain: captainInfo,
                 effective: take ? effectiveValue(take, captain) : null };
    }
    const limit = opts.listSize || 6;
    // With `gap` picks in between, the market takes the top `gap` teams, so what
    // survives is everything from there down — and what I'd actually take then is
    // the best of THOSE by my own valuation.
    //
    // When the wait is longer than the board, NOTHING survives. This used to be
    // clamped to the last team, which quietly contradicted itself: it priced the
    // cost of waiting against a team it simultaneously listed as unavailable. An
    // exhausted board is its own answer — waiting costs you the pick, not a
    // couple of points — so it is reported rather than approximated.
    const exhausted = schedule.gap >= list.length;
    const survivors = exhausted ? [] : list.slice(schedule.gap);
    const survivor = best(survivors);
    const cost = survivor
        ? Math.round((effectiveValue(take, captain) - effectiveValue(survivor, captain)) * 10) / 10
        : null;
    return {
        take,
        cost,
        exhausted,
        survivorRank: exhausted ? null : schedule.gap,
        survivor,
        effective: effectiveValue(take, captain),
        captain: captainInfo,
        atRisk: list.slice(0, schedule.gap).slice(0, limit),
        safeToWait: survivors.slice(0, limit)
    };
}

// What a manager has already taken, best first — so the page can show the
// roster building up next to the board.
function rosterFor(draft, userId, projections) {
    const byId = {};
    (projections || []).forEach(t => { byId[String(t.id)] = t; });
    return ((draft && draft.picks) || [])
        .filter(p => String(p.userId) === String(userId))
        .map(p => {
            const proj = p.team && p.team.id != null ? byId[String(p.team.id)] : null;
            return {
                overall: p.overall, round: p.round,
                id: p.team && p.team.id, school: (p.team && p.team.school) || '?',
                total: proj ? proj.total : null,
                // Needed to work out the captain anchor — see captainAnchor().
                regular: proj ? proj.regular : null
            };
        })
        .sort((a, b) => a.overall - b.overall);
}

module.exports = { picksFor, pickSchedule, available, advise, rosterFor, captainAnchor, captainGain, effectiveValue };
