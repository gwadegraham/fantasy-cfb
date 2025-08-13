const mongoose = require('mongoose');

const line = new mongoose.Schema({
    provider: {
        type: String
    },
    spread:{
        type: Number
    },
    formattedSpread: {
        type: String
    },
    spreadOpen: {
        type: Number
    },
    overUnder: {
        type: Number
    },
    overUnderOpen: {
       type: Number
    },
    homeMoneyline: {
        type: Number
    },
    awayMoneyline: {
        type: Number
    }
});

const bettingLine = new mongoose.Schema({
    id: {
        type: Number
    },
    season: {
        type: Number
    },
    seasonType: {
        type: String
    },
    week: {
        type: Number
    },
    startDate: {
        type: String
    },
    homeTeam: {
        type: String
    },
    homeConference: {
        type: String
    },
    homeClassification: {
        type: String
    },
    homeScore: {
        type: Number
    },
    awayTeam: {
        type: String
    },
    awayConference: {
        type: String
    },
    awayClassification: {
        type: String
    },
    awayScore: {
        type: Number
    },
    lines: {
        type: [line]
    }
});

module.exports = mongoose.model('BettingLine', bettingLine);