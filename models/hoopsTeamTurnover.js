const mongoose = require('mongoose');

// One team's roster turnover going INTO a basketball season (#541): who it
// got and lost in the transfer portal, and its recruiting class rank.
//
// Keyed on the season the turnover leads into. CBBD files both by the
// calendar year of the spring they happened in — the portal and class ahead
// of 2026–27 (season 2027) are CBBD year 2026 — and `fromYear` keeps that, so
// a page can say "spring 2026 portal".
//
// Its own collection, like hoopsteamstyles and for the same reason: the job
// replaces a season's rows wholesale, and hoopsteams is written by the teams
// ingest and the Torvik import, which this must never race.
//
// SLIM on purpose. CBBD's portal is ~470 KB for ~1,600 transfers; a row here
// is the counts plus a short list of names (the busiest team measured had
// 13 arrivals).
const moveSchema = new mongoose.Schema({
    name: { type: String, required: true },
    position: { type: String },
    stars: { type: Number },
    rating: { type: Number },
    // The other school: where an arrival came FROM, or where a departure
    // went. No school on a departure CBBD lists with no new school yet; no
    // teamId when the school is not Division I (no page to link).
    teamId: { type: Number },
    school: { type: String }
}, { _id: false });

const sideSchema = new mongoose.Schema({
    count: { type: Number, required: true },
    // Four- and five-star transfers, the ones a manager has heard of.
    topStars: { type: Number, required: true },
    // Mean 247 rating over the transfers that carry one, or null.
    avgRating: { type: Number }
}, { _id: false });

const hoopsTeamTurnoverSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    teamId: { type: Number, required: true },
    // CBBD's `year` for both the portal and the class: season - 1.
    fromYear: { type: Number, required: true },
    school: { type: String },

    in: { type: sideSchema, required: true },
    out: { type: sideSchema, required: true },
    // Best first, at most MAX_LISTED each; `count` above is the full number.
    arrivals: { type: [moveSchema], default: [] },
    departures: { type: [moveSchema], default: [] },

    // Null when CBBD does not rank the team's class (it ranks ~150).
    classRank: { type: Number },
    classRating: { type: Number },

    fetchedAt: { type: Date, required: true }
}, { collection: 'hoopsteamturnover' });

hoopsTeamTurnoverSchema.index({ season: 1, teamId: 1 }, { unique: true });

module.exports = mongoose.model('HoopsTeamTurnover', hoopsTeamTurnoverSchema);
