const mongoose = require('mongoose');

// One document per season: the CFP bracket as CFBD publishes it, normalized by
// modules/cfp-bracket.js. Modelled on models/ranking.js — a cached copy of a
// CFBD response that scoring reads instead of re-fetching per game.
//
// The point of storing it is `games`: it turns "which bracket round is this
// game" from a substring guess about CFBD's marketing prose into a lookup on
// the game id. See modules/scoring-detectors.js.

// A team as it appears inside one bracket game. `seed` and `firstRoundBye` are
// copied from the participant record, NOT from the matchup slot: a slot filled
// by a first-round winner carries `seed: null` even though the team is seeded
// (2025 Alabama occupies QF1 with a null slot seed and is the 9 seed).
const bracketTeamSchema = new mongoose.Schema({
    teamId: {
        type: Number,
        required: true
    },
    school: {
        type: String
    },
    seed: {
        type: Number
    },
    firstRoundBye: {
        type: Boolean
    }
}, { _id: false });

const bracketGameSchema = new mongoose.Schema({
    // The CFBD game id — the same id carried by our Game docs, which is what
    // makes this joinable to a game being scored.
    gameId: {
        type: Number,
        required: true
    },
    round: {
        type: String,
        required: true
    },
    bracketSlot: {
        type: String
    },
    roundOrder: {
        type: Number
    },
    bowlName: {
        type: String
    },
    teams: {
        type: [bracketTeamSchema]
    }
}, { _id: false });

// The full field, win or lose. `outcome` / `eliminatedRound` aren't used by
// scoring today — they're the direct answers to "how far did this team get",
// which hall of fame and the weekly recap currently reconstruct from games.
const participantSchema = new mongoose.Schema({
    teamId: {
        type: Number,
        required: true
    },
    school: {
        type: String
    },
    conference: {
        type: String
    },
    seed: {
        type: Number
    },
    // Diverges from `seed` — 2025 Tulane is the 11 seed at committee rank 20.
    // Anything asking "did this team get a bye" must read firstRoundBye.
    committeeRank: {
        type: Number
    },
    firstRoundBye: {
        type: Boolean
    },
    bidType: {
        type: String
    },
    conferenceChampion: {
        type: Boolean
    },
    outcome: {
        type: String
    },
    eliminatedRound: {
        type: String
    }
}, { _id: false });

const cfpBracketSchema = new mongoose.Schema({
    season: {
        type: Number,
        required: true,
        unique: true
    },
    // e.g. "twelve_team_2025". Stored so a format change is visible in the data
    // rather than inferred from the round list.
    format: {
        type: String
    },
    teamCount: {
        type: Number
    },
    status: {
        type: String
    },
    champion: {
        type: bracketTeamSchema
    },
    participants: {
        type: [participantSchema]
    },
    games: {
        type: [bracketGameSchema]
    },
    retrievedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('CfpBracket', cfpBracketSchema);
