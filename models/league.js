const mongoose = require('mongoose');

// A league is otherwise identified only by its code (graham-league /
// claunts-league) with a hardcoded display name; this makes the name editable
// by a commissioner. Codes still come from scoring-defaults LEAGUES — this doc
// just overrides the display name.
const leagueSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('League', leagueSchema);
