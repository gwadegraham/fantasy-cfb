const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true
    },
    season: {
        type: Number,
        required: true
    },
    week: {
        type: Number,
        required: true
    },
    seasonType: {
        type: String,
        required: true
    },
    startDate: {
        type: String,
        required: true
    },
    startTimeTbd: {
        type: Boolean,
        required: true
    },
    completed: {
        type: Boolean,
    },
    neutralSite: {
        type: Boolean,
        required: true
    },
    conferenceGame: {
        type: Boolean,
        required: true
    },
    attendance: {
        type: Boolean,
    },
    venueId: {
        type: Number,
        required: true
    },
    venue: {
        type: String,
        required: true
    },
    homeId: {
        type: Number,
        required: true
    },
    homeTeam: {
        type: String,
        required: true
    },
    homeConference: {
        type: String,
        required: true
    },
    homeDivision: {
        type: String,
    },
    homePoints: {
        type: Number,
        required: true
    },
    homeLineScores: {
        type: [Number],
        required: true
    },
    homePostWinProb: {
        type: String,
    },
    homePregameElo: {
        type: Number,
    },
    homePostgameElo: {
        type: Number,
    },
    awayId: {
        type: Number,
        required: true
    },
    awayTeam: {
        type: String,
        required: true
    },
    awayConference: {
        type: String,
        required: true
    },
    awayDivision: {
        type: String,
    },
    awayPoints: {
        type: Number,
        required: true
    },
    awayLineScores: {
        type: [Number],
        required: true
    },
    awayPostWinProb: {
        type: String,
    },
    awayPregameElo: {
        type: Number,
    },
    awayPostgameElo: {
        type: Number,
    },
    excitementIndex: {
        type: String,
    },
    highlights: {
        type: String,
    },
    notes: {
        type: String,
    },
});

module.exports = mongoose.model('Game', gameSchema);