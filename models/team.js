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
        type: String,
        required: true
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
        required: true
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
        required: true
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



module.exports = mongoose.model('Team', teamSchema);