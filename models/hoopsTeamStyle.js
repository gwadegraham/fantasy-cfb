const mongoose = require('mongoose');

// One team's style tags for one basketball season (#542), and the few
// leaderboard numbers they were worked out from.
//
// Keyed on the season the tags are SHOWN for, not the leaderboard they came
// from: before a season has enough games, its tags are last season's, and the
// reader should not have to know that to find them. `fromSeason` says which
// leaderboard it was, so a page can say "from 2025–26".
//
// Its own collection rather than a field on hoopsTeam: the job replaces a
// season's rows wholesale every day, and hoopsteams is written by the teams
// ingest and the Torvik import, which this must never race.
//
// SLIM on purpose. The CBBD leaderboard is ~800 KB for 365 teams; a row here
// is ~200 bytes of numbers plus the tags.
const tagSchema = new mongoose.Schema({
    key: { type: String, required: true },
    label: { type: String, required: true },
    // The tooltip: "Top 4% in pace: 71.2 possessions a game".
    detail: { type: String },
    // Fraction of the field at or ahead of the team; what the tags were
    // ranked by (modules/hoops-style-tags.js).
    share: { type: Number }
}, { _id: false });

const hoopsTeamStyleSchema = new mongoose.Schema({
    season: { type: Number, required: true },
    teamId: { type: Number, required: true },
    // CBBD's season label for the leaderboard read — season or season - 1.
    fromSeason: { type: Number, required: true },
    school: { type: String },

    games: { type: Number },
    wins: { type: Number },
    losses: { type: Number },
    pace: { type: Number },
    threeRate: { type: Number },
    rimRate: { type: Number },
    midRate: { type: Number },
    threePct: { type: Number },
    orbPct: { type: Number },
    ftRate: { type: Number },
    forcedTo: { type: Number },
    offRank: { type: Number },
    defRank: { type: Number },

    tags: { type: [tagSchema], default: [] },
    fetchedAt: { type: Date, required: true }
}, { collection: 'hoopsteamstyles' });

hoopsTeamStyleSchema.index({ season: 1, teamId: 1 }, { unique: true });

module.exports = mongoose.model('HoopsTeamStyle', hoopsTeamStyleSchema);
