const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    id: {
        type: Number,
        required: true
    },
    season: {
        type: Number,
        required: true
    },
    week: {
        type: Number,
        required: true
    },
    seasonType: {
        type: String,
        required: true
    },
    startDate: {
        type: String,
        required: true
    },
    startTimeTbd: {
        type: Boolean,
        required: true
    },
    completed: {
        type: Boolean,
    },
    neutralSite: {
        type: Boolean,
        required: true
    },
    conferenceGame: {
        type: Boolean,
        required: true
    },
    attendance: {
        type: Boolean,
    },
    venueId: {
        type: Number
    },
    venue: {
        type: String
    },
    homeId: {
        type: Number,
        required: true
    },
    homeTeam: {
        type: String,
        required: true
    },
    homeConference: {
        type: String
    },
    homeDivision: {
        type: String,
    },
    homePoints: {
        type: Number
    },
    homeLineScores: {
        type: [Number]
    },
    homePostWinProb: {
        type: String,
    },
    homePregameElo: {
        type: Number,
    },
    homePostgameElo: {
        type: Number,
    },
    awayId: {
        type: Number,
        required: true
    },
    awayTeam: {
        type: String,
        required: true
    },
    awayConference: {
        type: String
    },
    awayDivision: {
        type: String,
    },
    awayPoints: {
        type: Number
    },
    awayLineScores: {
        type: [Number]
    },
    awayPostWinProb: {
        type: String,
    },
    awayPregameElo: {
        type: Number,
    },
    awayPostgameElo: {
        type: Number,
    },
    excitementIndex: {
        type: String,
    },
    highlights: {
        type: String,
    },
    notes: {
        type: String,
    },
    // Live game state from the CFBD /scoreboard endpoint, updated every poller
    // tick while the game is in progress. Frozen once `completed` flips true.
    period: {
        type: Number
    },
    clock: {
        type: String
    },
    possession: {
        type: String
    },
    status: {
        type: String
    },
    // Broadcast info from CFBD /games/media (e.g. outlet "ABC", mediaType "tv").
    mediaType: {
        type: String
    },
    outlet: {
        type: String
    },
    // Post-game team box scores from CFBD /games/teams, keyed by side ('home'/'away').
    // Each value holds the stat categories for that team (e.g. passingYards, rushingYards).
    teamStats: {
        type: Map,
        of: new mongoose.Schema({
            totalYards:         Number,
            netPassingYards:    Number,
            rushingYards:       Number,
            passingTDs:         Number,
            rushingTDs:         Number,
            turnovers:          Number,
            fumblesLost:        Number,
            interceptions:      Number,
            sacks:              Number,
            tacklesForLoss:     Number,
            penalties:          Number,
            thirdDownPct:       Number,
            fourthDownPct:      Number,
            totalPenaltiesYards:Number,
            possessionSeconds:  Number,
            pointsAllowed:      Number,
        }, { _id: false })
    },
    lastUpdated: {
        type: String
    },
});

// CFBD's game id is the identity of a game everywhere in the app, and the ingest
// routes upsert on it. UNIQUE because a duplicate is not a cosmetic problem: the
// per-team week lookup (`GET /games/seasonType/:st/week/:w/team/:id`) returns
// every match, and modules/scoring.js adds a team's points once per returned
// game — so a second doc with the same id DOUBLES that team's score for the week.
// The index is the backstop; routes/games.js upserting is the fix.
gameSchema.index({ id: 1 }, { unique: true });

// Indexes for the standings / H2H / highlights lookups, which all filter by
// season + seasonType (+ week), and by home/away team id via $or. Without these
// every season lookup scans the whole Game collection. Non-unique, additive.
gameSchema.index({ season: 1, seasonType: 1, week: 1 });
gameSchema.index({ season: 1, seasonType: 1, homeId: 1 });
gameSchema.index({ season: 1, seasonType: 1, awayId: 1 });

module.exports = mongoose.model('Game', gameSchema);