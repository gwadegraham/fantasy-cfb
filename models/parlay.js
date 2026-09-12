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
        enum: ['spread', 'moneyline', 'over_under', 'stat_over_under', 'custom']
    },
    selection: {
        type: String
    },
    line: {
        type: Number
    },
    // spread/moneyline legs: which team was picked. `line` is stored from that
    // team's point of view (a favorite is negative), so the side is the other
    // half of the bet and the resolver can't infer it from the number alone.
    // Older legs predate this field; parlay-resolve falls back to reading the
    // team out of `selection` when it's absent.
    teamSide: {
        type: String,
        enum: ['home', 'away', null]
    },
    // stat_over_under legs only: which stat and which team
    statCategory: {
        type: String
    },
    statTeamSide: {
        type: String,
        enum: ['home', 'away', null]
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
    parlayOdds: {
        type: Number
    },
    boostPct: {
        type: Number
    },
    boostedOdds: {
        type: Number
    },
    // Promos cap the stake they'll boost ("Max $10.00 wager"). Null means the
    // whole wager was boosted; anything above the cap pays at parlayOdds.
    boostCap: {
        type: Number
    },
    totalPayout: {
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
    placedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
