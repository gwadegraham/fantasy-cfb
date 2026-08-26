const mongoose = require('mongoose');

const legSchema = new mongoose.Schema({
    contributor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    gameId: {
        type: Number
    },
    betType: {
        type: String,
        enum: ['spread', 'moneyline', 'over_under', 'custom']
    },
    selection: {
        type: String
    },
    line: {
        type: Number
    },
    odds: {
        type: Number
    },
    result: {
        type: String,
        enum: ['pending', 'win', 'loss', 'push'],
        default: 'pending'
    },
    resolvedAt: {
        type: Date
    }
});

const parlaySchema = new mongoose.Schema({
    group: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BettingGroup',
        required: true
    },
    season: {
        type: Number,
        required: true
    },
    seasonType: {
        type: String,
        required: true,
        default: 'regular'
    },
    week: {
        type: Number,
        required: true
    },
    wager: {
        type: Number
    },
    status: {
        type: String,
        enum: ['pending', 'won', 'lost', 'push'],
        default: 'pending'
    },
    payout: {
        type: Number
    },
    legs: [legSchema],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

parlaySchema.index({ group: 1, season: 1, week: 1 }, { unique: true });
parlaySchema.index({ status: 1 });

module.exports = mongoose.model('Parlay', parlaySchema);
