// One basketball game's shot chart. Written once the game is final by
// modules/hoops-shots.js (from CBBD /plays/game), only read by the game page.
//
// Slim on purpose: located field-goal attempts only, already folded onto one
// half court, in feet — ~120 shots, ~12 KB a game. Free throws carry no
// location and are not stored.

const mongoose = require('mongoose');

const shotSchema = new mongoose.Schema({
    teamId: Number,
    athleteId: Number,
    shooter: String,
    made: Boolean,
    // CBBD's own zone: 'rim' | 'jumper' | 'three_pointer'.
    range: String,
    assisted: Boolean,
    period: Number,
    clock: String,
    // Feet on a half court seen from above with the basket at the top:
    // x across the floor (0-50), y out from the baseline (0-47, rim at 5.25).
    x: Number,
    y: Number
}, { _id: false });

const hoopsShotsSchema = new mongoose.Schema({
    gameId: { type: Number, required: true, unique: true },
    season: Number,
    // Every field-goal attempt in the plays, located or not — the page says
    // "102 of 110 charted" rather than passing a partial chart off as whole.
    attempts: { home: Number, away: Number },
    shots: [shotSchema],
    // False until the plays match a stored box score's attempts. An
    // incomplete game is fetched again, up to MAX_FETCHES real answers.
    complete: { type: Boolean, default: false },
    fetches: { type: Number, default: 0 },
    // "Not posted yet" answers, capped apart (MAX_EMPTIES).
    empties: { type: Number, default: 0 },
    fetchedAt: { type: Date, default: Date.now }
}, { collection: 'hoopsshots' });

module.exports = mongoose.model('HoopsShots', hoopsShotsSchema);
