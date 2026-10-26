const mongoose = require('mongoose');

// One team's place in one basketball AP Top 25 poll.
//
// DISPLAY ONLY. This is the number shown beside a team's name — the one
// managers know from TV — and nothing that scores or projects reads it.
// Quadrants are graded on modules/hoops-ranks.js (T-Rank, then the NET):
// the AP ranks 25 of 364 teams, so it cannot grade a quadrant.
//
// Its own collection rather than rows in models/ranking.js: that is
// football's poll store, keyed by school NAME, and basketball and football
// team ids collide (130 of 365), so the two must never share a reader.
//
// Keyed by CBBD's poll week, not the hoops calendar week: readers pick the
// poll by DATE (the latest released on or before a game), which is what
// "the rank a team held that night" means.
const hoopsApRankSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    seasonType: { type: String, required: true },
    week: { type: Number, required: true },
    pollDate: { type: Date, required: true },
    teamId: { type: Number, required: true },
    school: { type: String },
    rank: { type: Number, required: true },
    points: { type: Number },
    firstPlaceVotes: { type: Number },
    fetchedAt: { type: Date, default: Date.now }
});

hoopsApRankSchema.index({ season: 1, seasonType: 1, week: 1, teamId: 1 }, { unique: true });
// The read every page makes: a season's polls, by date.
hoopsApRankSchema.index({ season: 1, pollDate: 1 });

module.exports = mongoose.model('HoopsApRank', hoopsApRankSchema);
