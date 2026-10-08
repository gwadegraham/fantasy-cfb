// One basketball player's jersey for one season, from CBBD /teams/roster.
//
// Imported ONCE A SEASON (modules/hoops-roster.js), alongside the schedule
// ingest — numbers do not change once the season starts, and /teams/roster is
// billable. Read only by the game and team pages, joined on athleteId: the
// roster's player `id` IS the athleteId the box score and season stats carry
// (measured 8 Oct 2026: 19/19 box-score players, 4,991/5,019 stat lines).
//
// Keyed by (season, athleteId), not athleteId alone: the same id follows a
// player through a transfer — 10 of those 19 were on a different team the
// season before — and a new team usually means a new number.

const mongoose = require('mongoose');

const hoopsRosterSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    athleteId: { type: Number, required: true },
    teamId: Number,
    name: String,
    // A STRING, never a number: "00" and "0" are different jerseys, and both
    // are on CBBD's 2026 rosters.
    jersey: String,
    fetchedAt: { type: Date, default: Date.now }
}, { collection: 'hoopsrosters' });

hoopsRosterSchema.index({ season: 1, athleteId: 1 }, { unique: true });

module.exports = mongoose.model('HoopsRoster', hoopsRosterSchema);
