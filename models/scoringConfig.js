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
    // DEPRECATED / legacy: a single league-wide engagement blob. Superseded by
    // engagementBySeason (below) so a league can run the game modes in one
    // season without altering another. Kept for rollback + reference; the
    // resolver no longer reads it.
    engagement: {
        h2hEnabled: { type: Boolean, default: false },
        h2hWinBonus: { type: Number, default: 3 },
        captainEnabled: { type: Boolean, default: false },
        captainMultiplier: { type: Number, default: 2 }
    },
    // Per-season engagement settings, keyed by season (string year), e.g.
    // { "2026": { h2hEnabled, h2hWinBonus, captainEnabled, captainMultiplier } }.
    // A season with no entry is fully OFF — enabling a mode for one season never
    // affects another, and a rescore of a season without an entry adds no
    // captain/H2H bonus. Stored as Mixed so seasons can be added freely.
    engagementBySeason: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScoringConfig', scoringConfigSchema);
