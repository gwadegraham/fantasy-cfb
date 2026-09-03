const mongoose = require('mongoose');

const teamSeasonStatSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    team: { type: String, required: true },
    conference: { type: String },
    games: { type: Number, default: 0 },
    stats: { type: Map, of: Number }
}, { timestamps: true });

teamSeasonStatSchema.index({ season: 1, team: 1 }, { unique: true });

module.exports = mongoose.model('TeamSeasonStat', teamSeasonStatSchema);
