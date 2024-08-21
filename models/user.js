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
    }
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
        type: String,
    },
    alt_name2: {
        type: String,
        required: true
    },
    alt_name3: {
        type: String,
        required: true
    },
    conference: {
        type: String,
        required: true
    },
    division: {
        type: String,
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
    teams: {
        type: [teamSchema]
    },
    cumulativeScore: {
        type: Number
    },
    weeklyScore: {
        type: [weeklyScoreSchema]
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
    }
});

module.exports = mongoose.model('User', userSchema);