const mongoose = require('mongoose');

// A league: its code, its editable display name, and — as of #312 — the sport
// and season it plays.
//
// Codes still come from scoring-defaults LEAGUES; making "create a league" a
// real operation is #313's business. What changed here is that a league now
// carries its own sport and season instead of the whole app sharing one
// process.env.YEAR, which two concurrent sports cannot share.
const leagueSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },

    // Which game this league plays. Defaulted rather than required so the two
    // existing football leagues keep validating without a backfill.
    sport: { type: String, enum: ['football', 'basketball'], default: 'football' },

    // The season this league is currently playing. Normally the same as its
    // sport's season (models/sportSeason.js) — kept per-league so a league can
    // sit out a year, or finish while its sport rolls on, without the app
    // deciding that for it. Unset means "whatever the sport is in".
    season: { type: Number },

    // 'active'   — playing now
    // 'archived' — kept for history, not offered for play
    //
    // Stored but INERT: nothing reads it. The league switcher is still built
    // from the hardcoded scoring-defaults LEAGUES list, and the season cache
    // does not load it either. #313 is where it starts meaning something.
    status: { type: String, enum: ['active', 'archived'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('League', leagueSchema);
