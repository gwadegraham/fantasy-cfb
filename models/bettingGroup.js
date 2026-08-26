const mongoose = require('mongoose');

const bettingGroupSchema = new mongoose.Schema({
    name: {
        type: String,
        default: 'Betting Group'
    },
    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
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
