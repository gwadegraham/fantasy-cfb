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
// 365 D1 teams is the uncapped universe. Drafting from it would be picking
// between teams that cannot score: rank 120 expects 9.9 points a season
// against rank 1's 74.8.
const BY_SPORT = {
    football: {
        snake: true,
        totalRounds: 10,
        // Uncapped: the FBS universe is already the right size.
        poolSize: null
    },
    basketball: {
        snake: true,
        totalRounds: 10,
        poolSize: 120
    }
};

const DEFAULT_SPORT = 'football';

function draftDefaultsFor(sport) {
    return Object.assign({}, BY_SPORT[sport] || BY_SPORT[DEFAULT_SPORT]);
}

module.exports = { draftDefaultsFor, BY_SPORT };
