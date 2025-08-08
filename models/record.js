const mongoose = require('mongoose');

const winSchema = new mongoose.Schema({
    games: {
        type: Number
    },
    wins: {
        type: Number
    },
    losses: {
        type: Number
    },
    ties: {
        type: Number
    }
});

const recordSchema = new mongoose.Schema({
    year: {
        type: Number
    },
    teamId: {
        type: Number
    },
    team: {
        type: String
    },
    classification: {
        type: String
    },
    conference: {
        type: String
    },
    division: {
        type: String
    },
    expectedWins: {
        type: Number
    },
    total: {
        type: winSchema
    },
    conferenceGames: {
        type: winSchema
    },
    homeGames: {
        type: winSchema
    },
    awayGames: {
        type: winSchema
    },
    neutralSiteGames: {
        type: winSchema
    },
    regularSeason: {
        type: winSchema
    },
    postseason: {
        type: winSchema
    }
});

module.exports = mongoose.model('Record', recordSchema);