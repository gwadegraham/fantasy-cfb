const mongoose = require('mongoose');

// A point-in-time copy of the team inputs the projection engine reads.
//
// Two problems this solves, both of which come from those inputs living on the
// Team docs and being overwritten in place:
//
//   1. The CFP futures board is pasted by hand and has no history. Re-pasting
//      replaced August's prices with today's and nothing recorded what the
//      market used to say.
//   2. A draft grade is meant to be a frozen judgment about a roster as drafted,
//      but it reads spRating and the CFP odds LIVE. SP+ is refreshed weekly by
//      the enrichment job, so grades have been drifting all season — Oregon was
//      SP+ 29.2 (rank 2) in week 1 and 23.9 (rank 7) by week 3. A draft pins a
//      snapshot (Draft.gradeSnapshot) and the grade route reads that instead.
//
// One document per capture; `teams` carries every field draft-projection.js
// looks up through seasonVal(), so a snapshot is a complete substitute for the
// live Team docs as far as the projection is concerned.
const snapshotTeamSchema = new mongoose.Schema({
    id: { type: Number, required: true },
    school: { type: String },
    alternateNames: { type: [String] },
    conference: { type: String },
    spRating: { type: Number },
    spRank: { type: Number },
    expectedWins: { type: Number },
    cfpMakeOdds: { type: Number },
    cfpChampOdds: { type: Number }
}, { _id: false });

const marketSnapshotSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    takenAt: { type: Date, default: Date.now },
    // Why this snapshot exists. 'cfp-odds-paste' is written automatically on
    // every committed board; 'draft-baseline' is the one a draft grade pins;
    // 'manual' is an operator capture.
    reason: { type: String, enum: ['cfp-odds-paste', 'draft-baseline', 'manual'], required: true },
    // For a paste: which market was committed ('make' | 'champ').
    market: { type: String },
    note: { type: String },
    // Which SP+ week the ratings came from, when the snapshot was reconstructed
    // from spHistory rather than copied from the live values.
    spWeek: { type: Number },
    matchedCount: { type: Number },
    unmatchedCount: { type: Number },
    unmatched: { type: [String] },
    teams: { type: [snapshotTeamSchema] }
});

// "Every snapshot for a season, newest first" is the only listing this needs.
marketSnapshotSchema.index({ season: 1, takenAt: -1 });

module.exports = mongoose.model('MarketSnapshot', marketSnapshotSchema);
