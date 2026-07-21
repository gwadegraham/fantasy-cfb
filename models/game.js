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
        type: Number
    },
    venue: {
        type: String
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
        type: String
    },
    homeDivision: {
        type: String,
    },
    homePoints: {
        type: Number
    },
    homeLineScores: {
        type: [Number]
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
        type: String
    },
    awayDivision: {
        type: String,
    },
    awayPoints: {
        type: Number
    },
    awayLineScores: {
        type: [Number]
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
    // Broadcast info from CFBD /games/media (e.g. outlet "ABC", mediaType "tv").
    mediaType: {
        type: String
    },
    outlet: {
        type: String
    },
    lastUpdated: {
        type: String
    },
});

module.exports = mongoose.model('Game', gameSchema);