const mongoose = require('mongoose');
const {
    DEFAULT_LEAD_MINUTES: CAPTAIN_DEFAULT_LEAD_MINUTES,
    LEAD_MINUTES: CAPTAIN_LEAD_MINUTES
} = require('../modules/captain-reminder');

const locationSchema = new mongoose.Schema({
    venue_id: {
        type: Number,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    city: {
        type: String,
        required: true
    },
    state: {
        type: String,
        required: true
    },
    zip: {
        type: String,
        required: true
    },
    country_code: {
        type: String
    },
    timezone: {
        type: String,
    },
    latitude: {
        type: Number,
        required: true
    },
    longitude: {
        type: Number,
        required: true
    },
    elevation: {
        type: String,
    },
    capacity: {
        type: Number,
        required: true
    },
    year_constructed: {
        type: Number,
    },
    grass: {
        type: Boolean,
        required: true
    },
    dome: {
        type: Boolean,
        required: true
    },
});

const weeklyTeamScoreSchema = new mongoose.Schema({
    team: {
        type: String
    },
    teamId: {
        type: Number
    },
    gameId: {
        type: Number
    },
    score: {
        type: Number
    }
});

const weeklyScoreSchema = new mongoose.Schema({
    week: {
        type: Number,
        required: true
    },
    score: {
        type: Number,
        required: true
    },
    scoreByTeam: {
        type: [weeklyTeamScoreSchema]
    },
    season: {
        type: String
    },
    // Weekly-engagement (#230): which team was captained this week and the
    // extra points it contributed (already included in `score`). Absent when
    // the league hasn't opted into Captain.
    captainTeamId: { type: Number },
    captainBonus: { type: Number },
    // Head-to-head result for this week, written by the H2H bonus pass once the
    // week settles. Like captainBonus, `h2hBonus` is ALREADY INCLUDED in `score`
    // — that is what carries it into cumulativeScore and every surface that
    // ranks by it. The pre-bonus total is score - h2hBonus (see
    // modules/h2h.js baseWeekScore), which is what matchups resolve from.
    // Absent when the league hasn't opted into H2H or the week hasn't settled.
    h2hBonus: { type: Number },
    h2hResult: { type: String, enum: ['W', 'L', 'T'] },
    h2hOpponentId: { type: String }
});

const teamSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true
    },
    school: {
        type: String,
        required: true
    },
    mascot: {
        type: String,
        required: true
    },
    abbreviation: {
        type: String,
        required: true
    },
    alt_name1: {
        type: String
    },
    alt_name2: {
        type: String
    },
    alt_name3: {
        type: String
    },
    alternateNames: {
        type: [String]
    },
    conference: {
        type: String,
        required: true
    },
    division: {
        type: String
    },
    color: {
        type: String,
        required: true
    },
    alt_color: {
        type: String,
    },
    logos: {
        type: [String],
        required: true
    },
    twitter: {
        type: String
    },
    location: {
        type: locationSchema,
        required: true
    }
});

const seasonSchema = new mongoose.Schema({
    season: {
        type: Number
    },
    // The manager's custom franchise name for this season (e.g. "Garrett's
    // Gridiron Gang"). Season-scoped so it can change year to year.
    franchiseName: {
        type: String
    },
    draftPosition: {
        type: Number
    },
    teams: {
        type: [teamSchema]
    },
    cumulativeScore: {
        type: Number
    },
    weeklyScore: {
        type: [weeklyScoreSchema]
    },
    // Optional weekly-engagement layer (#230): the manager's Captain pick per
    // week (teamId doubled in scoring for opted-in leagues). Empty otherwise.
    captains: {
        type: [{ week: Number, teamId: Number }],
        default: undefined
    }
});

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