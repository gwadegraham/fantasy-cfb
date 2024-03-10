const mongoose = require('mongoose');

const rankSchema = new mongoose.Schema({
    rank: {
        type: Number
    },
    school: {
        type: String
    },
    conference: {
        type: String
    },
    firstPlaceVotes: {
        type: Number
    },
    points: {
        type: Number
    }
});

const pollSchema = new mongoose.Schema({
    poll: {
        type: String
    },
    ranks: {
        type: [rankSchema]
    }
});

const rankingSchema = new mongoose.Schema({
    season: {
        type: Number,
        required: true
    },
    seasonType: {
        type: String,
        required: true
    },
    week: {
        type: Number,
        required: true
    },
    polls: {
        type: [pollSchema]
    }
});

module.exports = mongoose.model('Ranking', rankingSchema);