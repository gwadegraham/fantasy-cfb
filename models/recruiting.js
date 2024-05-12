const mongoose = require('mongoose');

const recruitingSchema = new mongoose.Schema({
    year: {
        type: Number,
        required: true
    },
    rank: {
        type: Number,
        required: true
    },
    team: {
        type: String,
        required: true
    },
    points: {
        type: String
    }
});

module.exports = mongoose.model('Recruiting', recruitingSchema, "recruiting");