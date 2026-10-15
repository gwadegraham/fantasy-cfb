const mongoose = require('mongoose');

// A basketball draft grade's frozen input — the counterpart of
// models/marketSnapshot.js, which holds football's (SP+, expected wins, CFP
// odds). A draft pins one (Draft.hoopsGradeSnapshot) and the grade route reads
// it instead of the live rows, so the letter a manager got on draft night
// cannot move all season.
//
// What it holds, and why each one can move otherwise:
//   teams  every team's PRESEASON Torvik rank, barthag, AdjOE/AdjDE and
//          projected record. They live on hoopsteams.preseason and a re-import
//          of the Torvik paste rewrites them in place. All ~365 teams, not just
//          the pool: a pool team's win probabilities read its opponents'
//          ratings, and the rank IS the map the quadrants are graded on.
//   games  the regular-season schedule of every pool team. CBBD adds,
//          reschedules and cancels games all season, and a cancelled row is
//          skipped by the projection.
//
// Its own collection rather than a sport field on MarketSnapshot, for the
// reason the data layout settled on (#312): one model per sport's shape.
// Measured on the 2027 dev data: 365 teams and ~3,500 games, ~0.6 MB.
const teamSchema = new mongoose.Schema({
    id: { type: Number, required: true },
    school: { type: String },
    conference: { type: String },
    rank: { type: Number },
    barthag: { type: Number },
    adjOE: { type: Number },
    adjDE: { type: Number },
    projectedRecord: { type: String }
}, { _id: false });

// The fields modules/hoops-draft-projection.js GAME_FIELDS reads.
const gameSchema = new mongoose.Schema({
    id: { type: Number, required: true },
    season: { type: Number },
    seasonType: { type: String },
    week: { type: Number },
    status: { type: String },
    neutralSite: { type: Boolean },
    conferenceGame: { type: Boolean },
    tournament: { type: String },
    gameNotes: { type: String },
    homeTeamId: { type: Number },
    homeConference: { type: String },
    awayTeamId: { type: Number },
    awayConference: { type: String }
}, { _id: false });

const hoopsGradeSnapshotSchema = new mongoose.Schema({
    league: { type: String, required: true },
    season: { type: Number, required: true },
    takenAt: { type: Date, default: Date.now },
    reason: { type: String, enum: ['draft-baseline', 'manual'], required: true },
    note: { type: String },
    // Which rank the quadrants were graded on, said out loud.
    rankSource: { type: String },
    teams: { type: [teamSchema] },
    games: { type: [gameSchema] }
}, { collection: 'hoopsgradesnapshots' });

hoopsGradeSnapshotSchema.index({ league: 1, season: 1, takenAt: -1 });

module.exports = mongoose.model('HoopsGradeSnapshot', hoopsGradeSnapshotSchema);
