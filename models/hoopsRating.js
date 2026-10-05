const mongoose = require('mongoose');

// One team's rating for one WEEK of one season — kept as a series.
//
// Deliberately not a field on hoopsTeam, which the preseason Torvik numbers
// live on. Those are one flat record per team per season; these refresh
// weekly, and CBBD serves only a CURRENT value with no history. Overwriting
// in place would leave us unable to say what a team was rated the night a
// game was played — and basketball scoring banks a result at time of play,
// so that question is the whole model (see modules/hoops-quadrants.js).
const hoopsRatingSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    // The hoops calendar week this rating applies FROM. Games in this week
    // are quadranted against it.
    week: { type: Number, required: true },
    teamId: { type: Number, required: true },

    // 1..N over the teams rated that week. The quadrant bands are rank
    // thresholds, so this must be a dense ranking, not a score.
    rank: { type: Number, required: true },

    // Where the number came from, stored rather than inferred: the source
    // changes mid-season and a row's provenance is the only way to explain
    // why a team's rank moved on a week it did not play.
    //
    //   'torvik'        preseason T-Rank, and the early weeks
    //   'cbbd-adjusted' CBBD /ratings/adjusted net-efficiency rank
    //   'blended'       weighted between the two while the live number settles
    source: {
        type: String,
        enum: ['torvik', 'cbbd-adjusted', 'blended'],
        required: true
    },

    // The underlying number, for display and for measuring the blend. Not
    // used by scoring, which reads `rank`.
    adjEM: { type: Number },
    fetchedAt: { type: Date, default: Date.now }
});

// One rating per team per week per season.
hoopsRatingSchema.index({ season: 1, week: 1, teamId: 1 }, { unique: true });
// The read scoring does: every team's rank for one week.
hoopsRatingSchema.index({ season: 1, week: 1 });

module.exports = mongoose.model('HoopsRating', hoopsRatingSchema);
