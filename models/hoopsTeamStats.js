// One basketball team's season stats, and its players', for one season (#494).
//
// From CBBD /stats/team/season and /stats/player/season. Both answer for
// EVERY team in one call (727 teams, 10,030 players for 2026 — D-I plus the
// lower divisions CBBD also tracks), so the nightly import is two calls.
//
// One document per team, players embedded, because the only reader is the
// team page and it wants exactly one team's everything. Kept slim on
// purpose: the full player payload is ~8 MB a night, and dev and prod share
// one free-tier Atlas cluster that moves ~85 KB/s. Only D-I teams (the ones
// with a hoopsteams row) are stored, and only the fields a page shows.
//
// NOT a history. Each import overwrites the season-to-date totals, which is
// what CBBD serves; nothing scores off these.

const mongoose = require('mongoose');

const side = {
    possessions: Number,
    rating: Number,             // points per 100 possessions
    trueShooting: Number,
    fgPct: Number,
    threePct: Number,
    threeRate: Number,          // share of field-goal attempts from three
    ftPct: Number,
    efgPct: Number,             // the four factors
    tovRatio: Number,
    orbPct: Number,
    ftRate: Number,
    points: Number,
    paintPoints: Number,
    fastBreakPoints: Number,
    assists: Number,
    steals: Number,
    blocks: Number,
    rebounds: Number
};

const playerSchema = new mongoose.Schema({
    athleteId: Number,
    name: String,
    position: String,
    games: Number,
    starts: Number,
    minutes: Number,
    points: Number,
    rebounds: Number,
    assists: Number,
    steals: Number,
    blocks: Number,
    threeMade: Number,
    threePct: Number,
    trueShootingPct: Number,
    usage: Number,
    netRating: Number,
    winShares: Number
}, { _id: false });

const hoopsTeamStatsSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    teamId: { type: Number, required: true },
    games: Number,
    wins: Number,
    losses: Number,
    pace: Number,
    team: side,
    opponent: side,
    players: [playerSchema],
    fetchedAt: { type: Date, default: Date.now }
}, { collection: 'hoopsteamstats' });

hoopsTeamStatsSchema.index({ season: 1, teamId: 1 }, { unique: true });

module.exports = mongoose.model('HoopsTeamStats', hoopsTeamStatsSchema);
