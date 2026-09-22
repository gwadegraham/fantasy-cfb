const mongoose = require('mongoose');
const {
    pushSubscriptionSchema, pushPrefsSchema, captainReminderSchema
} = require('./schemas/push');
// Season shapes live in models/schemas/season.js so models/franchise.js (#313)
// uses the SAME definition — the migration diffs one against the other, and two
// look-alike definitions would make that diff lie.
const { seasonSchema } = require('./schemas/season');


const userSchema = new mongoose.Schema({
    firstName: {
        type: String,
        required: true
    },
    lastName: {
        type: String,
        required: true
    },
    email: {
        type: String
    },
    seasons: {
        type: [seasonSchema]
    },
    league: {
        type: String
    },
    color: {
        type: String
    },
    isUpdated: {
        type: Boolean,
        default: false
    },
    lastUpdated: {
        type: String
    },
    // Profile picture: a Cloudinary delivery URL (validated server-side). Held
    // at the account level since a person's photo doesn't change per season.
    avatarUrl: {
        type: String
    },
    // Set once the user has seen the "add a photo / name your team" onboarding
    // prompt, so we only show it the first time after the feature launched.
    profilePrompted: {
        type: Boolean,
        default: false
    },
    // The Auth0 `sub` this franchise was bound to when its invite was claimed
    // (modules/invite-bind.js). Nothing resolves login -> franchise through this
    // — that is still user_metadata.metadata.userId — so it is deliberately
    // additive. It exists so a claimed invite can't be spent twice, and so the
    // binding is auditable after the fact. Empty for every member provisioned by
    // hand before the invite flow existed.
    authSub: {
        type: String
    },
    // Web Push subscriptions for game-day alerts (see modules/push-notify.js).
    // Absent for anyone who has never opted in, which is the normal state —
    // subscribing requires the site to be installed to the home screen on iOS.
    pushSubscriptions: {
        type: [pushSubscriptionSchema],
        default: undefined
    },
    // Which alert types this manager wants. Unset means "all four", so a
    // subscriber gets everything until they narrow it.
    captainReminders: {
        type: [captainReminderSchema],
        default: undefined
    },
    // One row per weekly-recap notice delivered. Its own array rather than a
    // shared push log with captainReminders above: they are the same shape, but
    // merging them would have meant migrating rows that are already in
    // production, and a migration that goes wrong re-notifies or silences a
    // Captain lock. Worth generalising when a third one of these turns up.
    recapNotices: {
        type: [captainReminderSchema],
        default: undefined
    },
    pushPrefs: {
        type: pushPrefsSchema,
        default: undefined
    },
});

module.exports = mongoose.model('User', userSchema);