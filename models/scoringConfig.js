const mongoose = require('mongoose');

// Per-league scoring configuration. `model` selects the engine path
// (claunts = V1, graham = V2); `values` holds the point value for each scoring
// event (see modules/scoring-defaults.js for the fields per model). Stored as
// Mixed so the value set can vary by model without a rigid sub-schema.
const scoringConfigSchema = new mongoose.Schema({
    league: { type: String, required: true, unique: true },
    model: { type: String, enum: ['claunts', 'graham'], required: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScoringConfig', scoringConfigSchema);
