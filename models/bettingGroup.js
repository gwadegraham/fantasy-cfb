const mongoose = require('mongoose');

const bettingGroupSchema = new mongoose.Schema({
    name: {
        type: String,
        default: 'Betting Group'
    },
    // Account ids. See the note in models/parlay.js: 'User' is a model the web
    // process no longer registers, so that ref could only ever 500 a populate.
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account'
    }],
    season: {
        type: Number,
        required: true
    },
    active: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

bettingGroupSchema.index({ season: 1, active: 1 });

module.exports = mongoose.model('BettingGroup', bettingGroupSchema);
