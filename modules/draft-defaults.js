// What a NEW draft starts at, per sport (#320).
//
// Football has one answer and has never needed another: every FBS team is
// draftable, so there is no cap, and the round count is whatever the league
// agreed. Basketball needs both to be set, and needs them set to numbers
// somebody can defend.
//
// ---- the basketball numbers, and where they came from ----
//
// 10 rounds, 120-team pool, measured against the real 2027 schedule (5,286
// games, every opponent and venue known) with Torvik's barthag through a
// log5 win-probability model:
//
//   round  1 (ranks  1- 8): 68.5 expected points
//   round  4 (ranks 25-32): 51.2
//   round  8 (ranks 57-64): 30.1
//   round 10 (ranks 73-80): 25.6
//   round 12 (ranks 89-96): 17.1
//
// THERE IS NO DEAD ROUND. A tenth-round pick is still worth a third of a
// first-rounder, which is what makes 10 a real choice rather than a
// formality — and 12 would work too if the league ever wants deeper
// rosters. That measurement is the reason the cap is 120 rather than the
// ~80 a "only draft teams that score" instinct suggests.
//
// The cap matters at 8 managers: 80 of 120 go, leaving 41 on the board at
// the last pick. At 6 it is 60 of 120. Neither empties the pool, which is
// the failure #320 was written to avoid — 10 managers x 12 rounds is
// exactly 120 and forces the final round.
//
// The ladder was scaled for 12-team rosters and does NOT need rescaling for
// 10: for the weakest snake roster at 6 managers a championship is 27.1% of
// a whole regular season at 10 rounds against 24.6% at 12. (An earlier note
// here said "~22%", which came from a different roster — the last-slot one,
// whose 10-round figure is 25.5%. The real gap is ~2.5 points, not ~5. The
// conclusion is unchanged and, if anything, stronger.)
//
// No `snake` here. Every draft this app has ever run is a snake, the route
// reads it straight off the request, and a default nothing consults is a
// setting that looks configurable and is not.
//
// 365 D1 teams is the uncapped universe. Drafting from it would be picking
// between teams that cannot score: rank 120 expects 9.9 points a season
// against rank 1's 74.8.
const BY_SPORT = {
    football: {
        totalRounds: 10,
        // Uncapped: the FBS universe is already the right size.
        poolSize: null
    },
    basketball: {
        totalRounds: 10,
        poolSize: 120
    }
};

const DEFAULT_SPORT = 'football';

function draftDefaultsFor(sport) {
    return Object.assign({}, BY_SPORT[sport] || BY_SPORT[DEFAULT_SPORT]);
}

// Frozen, not just copied on the way out. server.js serialises this very
// object onto every admin page, so a stray write would change what every
// admin's form pre-fills until the dyno restarts.
Object.freeze(BY_SPORT);
Object.keys(BY_SPORT).forEach(k => Object.freeze(BY_SPORT[k]));

// What the rules page tells a league about its draft. An EXISTING draft is
// the answer as it stands, null pool included: null on a Draft means
// uncapped (the admin form saves a cleared cap as null on purpose), so
// backfilling the sport's 120 would print a cap the draft does not have.
// The defaults are only for a league with no draft yet.
function draftRulesFor(sport, draft) {
    const base = Object.assign({ sport }, draftDefaultsFor(sport));
    if (!draft) return base;
    return Object.assign(base, {
        poolSize: draft.poolSize != null ? draft.poolSize : null,
        totalRounds: draft.totalRounds != null ? draft.totalRounds : base.totalRounds
    });
}

module.exports = { draftDefaultsFor, draftRulesFor, BY_SPORT };
