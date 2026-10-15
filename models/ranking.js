const mongoose = require('mongoose');

const rankSchema = new mongoose.Schema({
    rank: {
        type: Number
    },
    school: {
        type: String
    },
    conference: {
        type: String
    },
    firstPlaceVotes: {
        type: Number
    },
    points: {
        type: Number
    }
});

const pollSchema = new mongoose.Schema({
    poll: {
        type: String
    },
    ranks: {
        type: [rankSchema]
    }
});

const rankingSchema = new mongoose.Schema({
    season: {
        type: Number,
        required: true
    },
    seasonType: {
        type: String,
        required: true
    },
    week: {
        type: Number,
        required: true
    },
    polls: {
        type: [pollSchema]
    }
});

// One poll document per week. POST /rankings/retrieveRankings upserts on these
// three fields, and an upsert is only race-safe with a unique index behind it:
// without one, two concurrent upserts can both insert (the Saturday job and the
// live poller collide on the :00 mark), and getRankingsForGame's findOne then
// reads whichever duplicate comes back first. Checked before adding: neither
// prod nor dev held a duplicate (15 Oct 2026), so the build cannot fail on
// existing data.
rankingSchema.index({ season: 1, seasonType: 1, week: 1 }, { unique: true });

module.exports = mongoose.model('Ranking', rankingSchema);