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
        type: Number,
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
    // CFBD pregame win probability for the home team (0–1), fetched weekly from
    // /metrics/wp/pregame. The projection engine reads this directly instead of
    // computing win prob from SP+ margins. Away prob = 1 − pregameWinProb.
    pregameWinProb: {
        type: Number
    },
    // Live in-game win probability for the home team (0–1), updated every
    // poller tick from the CFBD /scoreboard endpoint. Cleared when completed.
    liveHomeWinProb: {
        type: Number
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
    // Down-and-distance ("3rd & 7 at LSU 32") and the description of the most
    // recent play, both straight from /scoreboard — no extra CFBD call, they
    // ride along in the same response the poller already pays for.
    //
    // CLEARED when the game completes, the same as liveHomeWinProb. CFBD leaves
    // lastPlay set to "End of 4th quarter." on a finished game, which is noise
    // on a final card; nulling both means "these are populated" is a clean
    // signal that a game is genuinely in progress.
    situation: {
        type: String
    },
    lastPlay: {
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
    // Per-player box scores from CFBD /games/players, keyed by side ('home'/'away').
    // Each side holds arrays of top performers per stat category.
    playerStats: {
        type: Map,
        of: new mongoose.Schema({
            passing: [new mongoose.Schema({
                name: String, c: Number, att: Number, yds: Number,
                td: Number, int: Number, qbr: Number
            }, { _id: false })],
            rushing: [new mongoose.Schema({
                name: String, car: Number, yds: Number,
                td: Number, lng: Number
            }, { _id: false })],
            receiving: [new mongoose.Schema({
                name: String, rec: Number, yds: Number,
                td: Number, lng: Number
            }, { _id: false })],
            defensive: [new mongoose.Schema({
                name: String, tot: Number, solo: Number,
                tfl: Number, sacks: Number, int: Number
            }, { _id: false })],
            kicking: [new mongoose.Schema({
                name: String, fgm: Number, fga: Number,
                pct: Number, lng: Number, xpm: Number, xpa: Number, pts: Number
            }, { _id: false })],
            punting: [new mongoose.Schema({
                name: String, no: Number, yds: Number,
                avg: Number, lng: Number, tb: Number, in20: Number
            }, { _id: false })],
        }, { _id: false })
    },
    weather: {
        temp:      Number,
        wind:      Number,
        condition: String,
        emoji:     String
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