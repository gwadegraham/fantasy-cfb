const mongoose = require('mongoose');

const playerSeasonLeaderSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    team: { type: String, required: true },
    leaders: {
        passing: [{ type: mongoose.Schema.Types.Mixed }],
        rushing: [{ type: mongoose.Schema.Types.Mixed }],
        receiving: [{ type: mongoose.Schema.Types.Mixed }],
        tackles: [{ type: mongoose.Schema.Types.Mixed }],
        sacks: [{ type: mongoose.Schema.Types.Mixed }],
        interceptions: [{ type: mongoose.Schema.Types.Mixed }],
        kicking: [{ type: mongoose.Schema.Types.Mixed }]
    }
}, { timestamps: true });

playerSeasonLeaderSchema.index({ season: 1, team: 1 }, { unique: true });

module.exports = mongoose.model('PlayerSeasonLeader', playerSeasonLeaderSchema);
