const mongoose = require('mongoose');
const {
    DEFAULT_LEAD_MINUTES: CAPTAIN_DEFAULT_LEAD_MINUTES,
    LEAD_MINUTES: CAPTAIN_LEAD_MINUTES
} = require('../../modules/captain-reminder');

// Push notification shapes, shared by models/user.js, models/account.js and
// models/franchise.js.
//
// Extracted for #313 for the same reason as schemas/season.js: during the
// transition the migration verifies itself by diffing the old model against the
// new ones, and two look-alike definitions would make that diff lie.
//
// Nothing here changed in the extraction.

// A browser push subscription (Web Push / VAPID). One per device+browser: a
// manager on a phone and a laptop holds two. `endpoint` is the push service URL
// and is the natural unique key, so re-subscribing the same device updates in
// place rather than accumulating duplicates.
//
// Stored on the user rather than in a collection of its own because it is small,
// always read with the user, and pruned with them — a dead endpoint (410 Gone
// from the push service) is deleted by modules/push-notify.js on the next send.
const pushSubscriptionSchema = new mongoose.Schema({
    endpoint: {
        type: String,
        required: true
    },
    // p256dh + auth are the client's encryption keys. Web Push payloads are
    // encrypted end-to-end, so without these a send is impossible.
    keys: {
        p256dh: { type: String, required: true },
        auth: { type: String, required: true }
    },
    // Free-text UA string, for telling "my phone" from "my laptop" when
    // debugging why one device is silent.
    userAgent: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

// Which alert types a manager wants. Its own schema (rather than an inline
// nested object) purely so `_id: false` applies — without it Mongoose mints a
// subdocument id and it surfaces in the /users/me/push response body.
const pushPrefsSchema = new mongoose.Schema({
    score: { type: Boolean, default: true },
    leadChange: { type: Boolean, default: true },
    closeGame: { type: Boolean, default: true },
    final: { type: Boolean, default: true },
    // The only alert that is not about a game in progress: a nudge before the
    // manager's weekly Captain pick locks at their first kickoff.
    captainLock: { type: Boolean, default: true },
    // How far ahead of that lock, in minutes — the manager picks it. Validated
    // against the allowlist in modules/captain-reminder.js rather than left
    // free: see LEAD_CHOICES for why an arbitrary number is worse than no
    // choice at all. The enum is belt-and-braces behind the route's sanitizer,
    // so a write from anywhere else still can't store a lead that never fires.
    captainLockLeadMinutes: { type: Number, default: CAPTAIN_DEFAULT_LEAD_MINUTES, enum: CAPTAIN_LEAD_MINUTES },
    // "Your weekly recap is ready" — a pointer to the My Team recap, once a week.
    recapReady: { type: Boolean, default: true }
}, { _id: false });

// One row per Captain reminder actually delivered, so the job never sends the
// same week twice. Kept on the user rather than in a collection of its own for
// the same reasons as pushSubscriptions: it is small (one row per played week),
// always read with the user, and pruned with them.
//
// NOT derived from the audit log. That trail records what a manager did; this
// records what we did TO them, and conflating the two means a manager who never
// touches the app has no row to check against.
const captainReminderSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    week: { type: Number, required: true },
    sentAt: { type: Date, default: Date.now }
}, { _id: false });

module.exports = { pushSubscriptionSchema, pushPrefsSchema, captainReminderSchema };
