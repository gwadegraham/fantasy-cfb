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
    const list = availableTeams || [];
    const take = list[0] || null;
    if (!take || schedule.gap == null) {
        return { take, cost: null, atRisk: [], safeToWait: [], survivorRank: null };
    }
    const limit = opts.listSize || 6;
    // With `gap` picks in between, list[gap] is the best team expected to still
    // be here. If the board is shorter than the gap, nothing is guaranteed.
    const survivorRank = Math.min(schedule.gap, list.length - 1);
    const survivor = list[survivorRank] || null;
    const cost = survivor ? Math.round((take.total - survivor.total) * 10) / 10 : null;
    return {
        take,
        cost,
        survivorRank,
        atRisk: list.slice(0, schedule.gap).slice(0, limit),
        safeToWait: list.slice(schedule.gap, schedule.gap + limit)
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
                total: proj ? proj.total : null
            };
        })
        .sort((a, b) => a.overall - b.overall);
}

module.exports = { picksFor, pickSchedule, available, advise, rosterFor };
