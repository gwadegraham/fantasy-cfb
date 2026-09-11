const mongoose = require('mongoose');

// A PERSON. One human, one login, however many leagues they play in.
//
// Half of the User split (#313). The other half is models/franchise.js, which
// is that person's entry in ONE league. Today they are the same document, which
// is exactly why one login can only ever be in one league — and why a football
// manager could not also hold a basketball team.
//
// ---- the _id is load-bearing, do not generate a new one ----
//
// An Auth0 login resolves through `user_metadata.metadata.userId`, and that
// value IS a Mongo `_id` from the users collection (see modules/identity-guard.js).
// So the migration copies each User's `_id` onto its Account verbatim. Mint a
// fresh one and every existing login stops resolving — silently, because the
// lookup simply finds nothing and the app reports "no profile in session".
//
// A Franchise, by contrast, is new and gets a new `_id`; nothing external
// points at one.
//
// ---- what lives here vs on a Franchise ----
//
// Here: things true of the PERSON regardless of which league you ask about —
// their name, their login, their avatar, the colour they show up as.
// There: everything scoped to one league-season — roster, scores, franchise
// name, draft position, captains — plus the scoring bookkeeping that tracks it.
const accountSchema = new mongoose.Schema({
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String },

    // The Auth0 subject (e.g. 'google-oauth2|1061985…'). Backfilled by
    // modules/auth-sub-backfill.js for accounts provisioned before the invite
    // flow existed. Identity is still keyed on _id via metadata.userId; this is
    // corroboration, not the key — see modules/identity-guard.js.
    authSub: { type: String },

    avatarUrl: { type: String },
    profilePrompted: { type: Boolean },

    // Chart/avatar colour. On the person, not the franchise: someone playing
    // two sports should be the same colour on both charts.
    color: { type: String },

    // Provenance: set only by modules/account-migration.js. Rollback scopes its
    // delete to documents carrying it, so anything created directly — a
    // basketball-only manager with no User behind them (#310) — survives. Those
    // cannot be reconstructed from the users collection, so an unscoped delete
    // would lose them permanently.
    migratedFrom: { type: mongoose.Schema.Types.ObjectId }
}, { timestamps: true });

// Identity lookups go through this both ways.
accountSchema.index({ authSub: 1 });

module.exports = mongoose.model('Account', accountSchema);
