const mongoose = require('mongoose');

// Per-league scoring configuration. `model` selects the engine path
// (claunts = V1, graham = V2); `values` holds the point value for each scoring
// event (see modules/scoring-defaults.js for the fields per model). Stored as
// Mixed so the value set can vary by model without a rigid sub-schema.
const scoringConfigSchema = new mongoose.Schema({
    league: { type: String, required: true, unique: true },
    model: { type: String, enum: ['claunts', 'graham'], required: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Phase 2 structure overrides: how regular-win rules combine
    // ('first' = priority, 'sum' = additive) and which postseason event
    // conditions are switched off (by condition key).
    combineMode: { type: String, enum: ['first', 'sum'] },
    disabled: { type: [String], default: [] },
    // Optional weekly-engagement layer (GitHub #230), per-league opt-in.
    // Head-to-head win bonus + weekly Captain multiplier. Off by default so
    // existing leagues are unaffected until a commissioner enables them.
    engagement: {
        h2hEnabled: { type: Boolean, default: false },
        h2hWinBonus: { type: Number, default: 3 },
        captainEnabled: { type: Boolean, default: false },
        captainMultiplier: { type: Number, default: 2 }
    },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScoringConfig', scoringConfigSchema);
