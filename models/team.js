const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema({
    venue_id: {
        type: Number
    },
    id: {
        type: Number
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
        type: String
    },
    country_code: {
        type: String
    },
    timezone: {
        type: String,
    },
    latitude: {
        type: Number
    },
    longitude: {
        type: Number
    },
    elevation: {
        type: String,
    },
    capacity: {
        type: Number
    },
    year_constructed: {
        type: Number,
    },
    grass: {
        type: Boolean
    },
    dome: {
        type: Boolean
    },
});

const weeklyScoreSchema = new mongoose.Schema({
    week: {
        type: Number,
        required: true
    },
    seasonType: {
        type: String,
        required: true
    },
    scoreV1: {
        type: Number,
        required: true
    },
    scoreV2: {
        type: Number,
        required: true
    }
});

const seasonSchema = new mongoose.Schema({
    season: {
        type: Number
    },
    conference: {
        type: String
    },
    cumulativeScoreV1: {
        type: Number
    },
    cumulativeScoreV2: {
        type: Number
    },
    weeklyScore: {
        type: [weeklyScoreSchema]
    },
    expectedWins: {
        type: Number
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
    },
    weeklyScore: {
        type: [weeklyScoreSchema]
    },
    cumulativeScoreV1: {
        type: Number
    },
    cumulativeScoreV2: {
        type: Number
    },
    seasons: {
        type: [seasonSchema]
    }
});



module.exports = mongoose.model('Team', teamSchema);