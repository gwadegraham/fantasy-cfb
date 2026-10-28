// One basketball game's box score (#503). Written by the nightly batch in
// modules/hoops-box-score.js — football's pattern — and only read by the
// game page. Slim on purpose: the fields the page shows (~5 KB a game,
// ~25 MB for a full season on the shared free-tier cluster).

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
    ftMade: Number, ftAtt: Number,
    // The Advanced view's lines (#624), as CBBD sends them per game.
    ejected: Boolean,
    offRebounds: Number, defRebounds: Number,
    twoMade: Number, twoAtt: Number,
    efgPct: Number, tsPct: Number, usage: Number,
    offRating: Number, defRating: Number, netRating: Number,
    gameScore: Number
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
    offRebounds: Number, defRebounds: Number, twoMade: Number, twoAtt: Number,
    fouls: Number, technicals: Number, tsPct: Number, rating: Number, gameScore: Number,
    paintPoints: Number, fastBreakPoints: Number, pointsOffTurnovers: Number, largestLead: Number,
    players: [playerSchema]
};

const hoopsBoxScoreSchema = new mongoose.Schema({
    gameId: { type: Number, required: true, unique: true },
    season: Number,
    pace: Number,
    home: side,
    away: side,
    fetchedAt: { type: Date, default: Date.now }
}, { collection: 'hoopsboxscores' });

module.exports = mongoose.model('HoopsBoxScore', hoopsBoxScoreSchema);
