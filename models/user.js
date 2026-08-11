const mongoose = require('mongoose');

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
});

module.exports = mongoose.model('User', userSchema);