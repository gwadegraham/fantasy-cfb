const mongoose = require('mongoose');
// The SAME season shapes models/user.js uses. Shared deliberately: the
// migration verifies itself by diffing a Franchise's seasons against the User's
// it came from, and two look-alike definitions would make that diff lie.
const { seasonSchema } = require('./schemas/season');

// One ACCOUNT's entry in ONE league. The other half of the User split (#313).
//
// This is what "being in a league" actually is: a roster, a set of weekly
// scores, a franchise name, a draft position. Splitting it off the person is
// what lets one login hold a football team and a basketball team — and it is
// what turns league membership from a hand-maintained Auth0 claim into a
// database query.
//
// ---- this replaces the gg/cl vocabulary ----
//
// Membership is `Franchise.find({ accountId })`. Today it is
// `user_metadata.metadata.league`, a flag whose values ('gg'/'cl') differ from
// the ones Mongo stores ('graham-league'/'claunts-league') — and
// modules/league-access.js warns that writing the wrong one "silently resolves
// the member into the other league rather than failing". That whole class of
// bug disappears with the flag.
//
// ---- zero franchises is a normal state ----
//
// A person may play football only, basketball only, or both, and the basketball
// league may include people who never played football (epic #310). So
// `find({ accountId })` returning nothing is an ordinary answer, not an error,
// and the migration must not invent a franchise for anyone.
const franchiseSchema = new mongoose.Schema({
    // The person. Indexed because "what leagues am I in?" is the query this
    // whole split exists to make possible.
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
        required: true
    },

    // Mongo's league code ('graham-league' / 'claunts-league') — never the
    // Auth0 flag. See models/league.js; #312 gave a League its own sport and
    // season, and a Franchise inherits both from its League rather than
    // restating them.
    league: { type: String, required: true },

    // Roster, scores, franchise name, draft position and captains, per season.
    seasons: { type: [seasonSchema] },

    // Scoring bookkeeping, per franchise rather than per person: it tracks when
    // THIS league's scores were last written.
    isUpdated: { type: Boolean, default: false },
    lastUpdated: { type: String },

    // Provenance: set only by modules/account-migration.js. Rollback scopes its
    // delete to documents carrying it, so anything created directly — a
    // basketball-only manager with no User behind them (#310) — survives. Those
    // cannot be reconstructed from the users collection, so an unscoped delete
    // would lose them permanently.
    migratedFrom: { type: mongoose.Schema.Types.ObjectId }
}, { timestamps: true });

// The membership query.
franchiseSchema.index({ accountId: 1 });
// One franchise per account per league. The migration relies on this to be
// idempotent — a second run upserts rather than duplicating a roster.
franchiseSchema.index({ accountId: 1, league: 1 }, { unique: true });
// Roster and standings reads are league-scoped.
franchiseSchema.index({ league: 1, 'seasons.season': 1 });

module.exports = mongoose.model('Franchise', franchiseSchema);
