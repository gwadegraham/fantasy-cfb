// One basketball game's box score (#503), fetched from CBBD the first time
// someone opens the game page and kept once the game is final.
//
// Persist-on-final is the whole cost model: a final box score never changes,
// so each game costs its 3 CBBD calls exactly once, and only games somebody
// actually looks at are ever stored. Dev and prod share one free-tier Atlas
// cluster, so storing every game's box (5,000+ a season) up front would be
// the expensive choice for no reader.
//
// Slim on purpose: the fields the page shows.

const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    athleteId: Number,
    name: String,
    position: String,
    starter: Boolean,
    minutes: Number,
    points: Number,
    rebounds: Number,
    assists: Number,
    steals: Number,
    blocks: Number,
    turnovers: Number,
    fouls: Number,
    fgMade: Number, fgAtt: Number,
    threeMade: Number, threeAtt: Number,
    ftMade: Number, ftAtt: Number
}, { _id: false });

const side = {
    teamId: Number,
    byPeriod: [Number],
    points: Number,
    // The four factors, as CBBD's per-GAME endpoint sends them: all four
    // are percents here (turnoverRatio 15.2), unlike the season endpoint.
    efgPct: Number, tovPct: Number, orbPct: Number, ftRate: Number,
    fgMade: Number, fgAtt: Number,
    threeMade: Number, threeAtt: Number,
    ftMade: Number, ftAtt: Number,
    rebounds: Number, assists: Number, steals: Number, blocks: Number, turnovers: Number,
    paintPoints: Number, fastBreakPoints: Number, pointsOffTurnovers: Number, largestLead: Number,
    players: [playerSchema]
};

const hoopsBoxScoreSchema = new mongoose.Schema({
    gameId: { type: Number, required: true, unique: true },
    season: Number,
    pace: Number,
    home: side,
    away: side,
    // CBBD had no box for this game and it is old enough that it never will
    // (see MISSING_AFTER_MS in modules/hoops-box-score.js). Stored so a game
    // CBBD never boxes does not cost 3 calls on every view, forever.
    missing: { type: Boolean, default: false },
    fetchedAt: { type: Date, default: Date.now }
}, { collection: 'hoopsboxscores' });

module.exports = mongoose.model('HoopsBoxScore', hoopsBoxScoreSchema);
