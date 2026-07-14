const mongoose = require('mongoose');

// A single pick in a draft. team is stored as the full team object (Mixed) so
// that when the draft completes we can write it straight onto each user's
// season.teams, matching how the existing manual draft persists teams.
const draftPickSchema = new mongoose.Schema({
    round: { type: Number, required: true },
    overall: { type: Number, required: true },   // 1-based overall pick number
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    team: { type: mongoose.Schema.Types.Mixed, required: true },
    pickedAt: { type: Date },
    pickedByCommissioner: { type: Boolean, default: false }
}, { _id: false });

const draftSchema = new mongoose.Schema({
    league: { type: String, required: true },
    season: { type: Number, required: true },

    // pending: configured but no time set | scheduled: has a start time
    // active: draft is live | complete: all picks made & persisted to users
    status: {
        type: String,
        enum: ['pending', 'scheduled', 'active', 'complete'],
        default: 'pending'
    },

    // --- commissioner-configured settings ---
    scheduledAt: { type: Date },
    autoOpen: { type: Boolean, default: false },
    snake: { type: Boolean, default: true },
    totalRounds: { type: Number, default: 10 },
    orderMethod: {
        type: String,
        enum: ['standings', 'random', 'manual'],
        default: 'standings'
    },
    // participant user ids, in pick order (slot 1 first)
    draftOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // --- live draft state ---
    picks: { type: [draftPickSchema], default: [] },
    currentOverall: { type: Number, default: 1 },  // next overall pick to be made

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// One draft per league per season.
draftSchema.index({ league: 1, season: 1 }, { unique: true });

module.exports = mongoose.model('Draft', draftSchema);
