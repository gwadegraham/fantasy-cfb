const mongoose = require('mongoose');

// One team's official NCAA NET rank for one WEEK of one season (#533).
//
// The sibling of models/hoopsRating.js, keyed and filed the same way — a row
// applies FROM its week, and a snapshot taken in week N is filed under week
// N + 1 (modules/hoops-net-job.js) — but its own collection, deliberately:
//
//   - HoopsRating's unique key is (season, week, teamId). A NET row for the
//     same team and week would collide with CBBD's, so sharing it means
//     widening that key to take `source`, and then every reader and the
//     ratings job's week-replace (a deleteMany over the week) has to filter
//     on source too. One missed filter and a CBBD run deletes the NET week,
//     or the coverage count adds the two sources together and passes a
//     half-written week. A separate collection makes that mistake impossible.
//   - the NET carries what the committee's team sheet shows — record and the
//     Quad 1-4 records — which the efficiency rows have no use for.
//
// ncaa.com shows only the CURRENT ranking and keeps no history, so like the
// CBBD rows a missed week can never be rebuilt.
const record = { w: { type: Number }, l: { type: Number } };

const hoopsNetRankSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    // The hoops calendar week this ranking applies FROM.
    week: { type: Number, required: true },
    teamId: { type: Number, required: true },

    // NCAA's own rank, as published — not recomputed. The NET has no ties, and
    // the page must show the number managers see on ncaa.com.
    rank: { type: Number, required: true },

    // As NCAA prints them, for display. Scoring reads `rank` only.
    school: { type: String },        // NCAA's spelling, e.g. "Mississippi Val."
    record: record,
    quad1: record,
    quad2: record,
    quad3: record,
    quad4: record,

    // The page's "Through Games <date>" stamp, as an Eastern calendar day at
    // UTC midnight (the hoops-calendar convention).
    throughGames: { type: Date },
    fetchedAt: { type: Date, default: Date.now }
});

// One rank per team per week per season.
hoopsNetRankSchema.index({ season: 1, week: 1, teamId: 1 }, { unique: true });
// The read scoring does: every team's rank for one week.
hoopsNetRankSchema.index({ season: 1, week: 1 });

module.exports = mongoose.model('HoopsNetRank', hoopsNetRankSchema);
