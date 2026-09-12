const mongoose = require('mongoose');

// The season sub-schemas, shared by models/user.js and models/franchise.js.
//
// Extracted for #313, which splits User into Account + Franchise. During the
// transition BOTH models carry a `seasons` array, and the migration verifies
// itself by diffing one against the other — so the two shapes have to be the
// same object, not two definitions that look alike. A field added to one and
// not the other would make the diff lie.
//
// Nothing here changed in the extraction; it is the same schema User has always
// used, moved.

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

module.exports = { locationSchema, weeklyTeamScoreSchema, weeklyScoreSchema, teamSchema, seasonSchema };
