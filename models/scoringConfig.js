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
    // Opt-in list for default-off rules (the finer Fixed-shape win categories).
    // A condition here is ON; absence keeps a default-off rule OFF — so adding a
    // new default-off rule never changes an existing league's scoring.
    enabled: { type: [String], default: [] },
    // Which conferences the non-P5 upset bonus treats as "power". Absent = the
    // engine default (ACC / Big 12 / Big Ten / SEC), so a league that never sets
    // it scores exactly as before. Graham's league adds 'FBS Independents':
    // Notre Dame sits there, so under the bare four it drew the +2 underdog
    // bonus on all ~10 of its power-conference wins a year — a top-5 program
    // collecting a rule written for Group-of-5 upsets. Only the Graham model has
    // an upset rule at all, so this is inert for Claunts.
    powerConferences: { type: [String], default: undefined },
    // Optional weekly-engagement layer (GitHub #230), per-league opt-in.
    // DEPRECATED / legacy: a single league-wide engagement blob. Superseded by
    // engagementBySeason (below) so a league can run the game modes in one
    // season without altering another. Kept for rollback + reference; the
    // resolver no longer reads it.
    engagement: {
        h2hEnabled: { type: Boolean, default: false },
        h2hWinBonus: { type: Number, default: 3 },
        h2hTieBonus: { type: Number, default: 0 },
        captainEnabled: { type: Boolean, default: false },
        captainMultiplier: { type: Number, default: 2 }
    },
    // Per-season engagement settings, keyed by season (string year), e.g.
    // { "2026": { h2hEnabled, h2hWinBonus, captainEnabled, captainMultiplier } }.
    // A season with no entry is fully OFF — enabling a mode for one season never
    // affects another, and a rescore of a season without an entry adds no
    // captain/H2H bonus. Stored as Mixed so seasons can be added freely.
    engagementBySeason: { type: mongoose.Schema.Types.Mixed, default: {} },
    // The FROZEN H2H manager list per season, e.g.
    // { "2026": { ids: ["65a…", "65b…"], pinnedAt: Date } }.
    //
    // H2H pairings come from a positional round robin, so this list's contents
    // and order decide who plays whom in every week. Derived fresh each pass, a
    // membership change mid-season restructured the round robin and re-decided
    // every already-settled week — moving banked bonuses between managers. The
    // list is pinned the first time a week settles and read verbatim after that.
    // See modules/h2h.js h2hRoster.
    h2hScheduleBySeason: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Frozen scoring config per completed season, keyed by year string, e.g.
    // { "2025": { model, values, combineMode, disabled, enabled, powerConferences } }.
    // Snapshotted at end-of-season so the "Why these points?" breakdown can
    // recalculate past games with the rules that were in effect when they were
    // scored. Seasons without an entry fall back to the live config.
    configBySeason: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ScoringConfig', scoringConfigSchema);
