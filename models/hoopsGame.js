// A men's college basketball game, from api.collegebasketballdata.com.
//
// Its own collection, not a `sport` field on models/game.js. There are 124
// Game.* and 78 Team.* query sites in this app; a shared collection makes every
// one of them a place a forgotten `sport:` filter silently serves football data
// to a basketball surface. Separate collections make an omission return zero
// rows — loud, and immediately. Written up on #312.
//
// The schemas genuinely diverge, and not only in name:
//
//   - NO `week`. CBBD has no week field and no /calendar endpoint, so weeks are
//     derived from dates (#315). football's game.js requires one.
//   - `homeTeamId`/`awayTeamId`, not football's `homeId`/`awayId`.
//   - `homePeriodPoints` is HALVES, not quarters.
//   - the venue is flat (venueId, venue, city, state) rather than football's
//     nested location subdocument.
//   - extras football has no equivalent for: gameType, tournament, seeds, Elo.

const mongoose = require('mongoose');

const hoopsGameSchema = new mongoose.Schema({
    // CBBD's own id. The upsert key — re-running an ingest updates in place.
    id: { type: Number, required: true, unique: true, index: true },

    // The ESPN id, and ALSO the id CFBD's logo CDN is keyed on, so basketball
    // team logos come free off the existing CDN. A STRING from the API
    // ("401918976"), kept as one rather than coerced — nothing does arithmetic
    // on it and a leading zero would be a silent corruption.
    sourceId: { type: String },

    // ⚠️ THE 2026-27 SEASON IS `season: 2027`.
    //
    // CBBD labels a split season by its ENDING year: seasonLabel "20262027"
    // carries season 2027. Asking for season=2026 in November 2026 returns
    // HTTP 200 with an empty array — a clean, successful, wrong answer. Verified
    // against the live API 29 Sep 2026: season=2026 gave 0 games for the
    // tip-off week, season=2027 gave 73.
    //
    // models/sportSeason.js must therefore hold 2027 for basketball while
    // football holds 2026. They are not the same number and never will be.
    season: { type: Number, required: true, index: true },
    seasonLabel: { type: String },
    seasonType: { type: String, required: true },

    startDate: { type: Date, required: true, index: true },
    startTimeTbd: { type: Boolean, default: false },

    // 'scheduled' | 'final' (and whatever else CBBD adds). NOT derived from the
    // points — see the note on homePoints.
    status: { type: String, index: true },

    neutralSite: { type: Boolean, default: false },
    conferenceGame: { type: Boolean, default: false },
    gameType: { type: String },          // 'STD', tournament codes
    tournament: { type: String },
    gameNotes: { type: String },
    attendance: { type: Number },
    excitement: { type: Number },

    homeTeamId: { type: Number, index: true },
    homeTeam: { type: String },
    homeConferenceId: { type: Number },
    homeConference: { type: String },
    homeSeed: { type: Number },

    // ⚠️ 0 DOES NOT MEAN "NOT PLAYED".
    //
    // CBBD returns homePoints: 0 / awayPoints: 0 on a SCHEDULED game, where
    // football leaves them absent. Anything that reads falsy points as "no
    // result yet" will score an unplayed game as a 0-0 final. Verified on the
    // live API: a scheduled game is {status:'scheduled', homePoints:0,
    // awayPoints:0, homeWinner:null}; a played one is {status:'final',
    // homePoints:117, awayPoints:55, homeWinner:true}.
    //
    // `status` is the discriminator. `homeWinner` is the other reliable one —
    // it is null until the game is decided.
    homePoints: { type: Number },
    homePeriodPoints: { type: [Number] },   // halves
    homeWinner: { type: Boolean },
    homeTeamEloStart: { type: Number },
    homeTeamEloEnd: { type: Number },

    awayTeamId: { type: Number, index: true },
    awayTeam: { type: String },
    awayConferenceId: { type: Number },
    awayConference: { type: String },
    awaySeed: { type: Number },
    awayPoints: { type: Number },
    awayPeriodPoints: { type: [Number] },
    awayWinner: { type: Boolean },
    awayTeamEloStart: { type: Number },
    awayTeamEloEnd: { type: Number },

    venueId: { type: Number },
    venue: { type: String },
    city: { type: String },
    state: { type: String }
}, { collection: 'hoopsgames' });

// The two reads the ingest and every surface will do: a night's slate, and one
// team's season.
hoopsGameSchema.index({ season: 1, startDate: 1 });
hoopsGameSchema.index({ season: 1, homeTeamId: 1 });
hoopsGameSchema.index({ season: 1, awayTeamId: 1 });

module.exports = mongoose.model('HoopsGame', hoopsGameSchema);
