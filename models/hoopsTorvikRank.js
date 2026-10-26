const mongoose = require('mongoose');

// Torvik's T-Rank as it stood going into one WEEK of one season — a series,
// like HoopsRating and HoopsNetRank, and for the same reason: barttorvik.com
// serves only its CURRENT ranking, and scoring banks a result at time of
// play, so "what was this team ranked the night it played" must be kept.
//
// Deliberately NOT the preseason fields on hoopsTeam. Those are what the
// draft was ranked on and what draft grades read; overwriting them in season
// would re-rank a finished draft. These rows are the Torvik side of the
// quadrant blend from week 1 on (modules/hoops-ranks.js), written by
// modules/hoops-torvik-job.js.
const hoopsTorvikRankSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    // The hoops calendar week this ranking applies FROM. Frozen at that
    // week's first tip-off: every game in the week is graded on the same
    // snapshot.
    week: { type: Number, required: true },
    teamId: { type: Number, required: true },

    // Torvik's own rank, 1..N over every D-I team.
    rank: { type: Number, required: true },

    // For display and for measuring the blend. Scoring reads `rank`.
    barthag: { type: Number },
    adjOE: { type: Number },
    adjDE: { type: Number },
    fetchedAt: { type: Date, default: Date.now }
});

hoopsTorvikRankSchema.index({ season: 1, week: 1, teamId: 1 }, { unique: true });
hoopsTorvikRankSchema.index({ season: 1, week: 1 });

module.exports = mongoose.model('HoopsTorvikRank', hoopsTorvikRankSchema);
