// A D-I men's basketball team, from api.collegebasketballdata.com.
//
// Its own collection rather than a sport field on models/team.js, for the
// reason #312 settled — and here the schemas could not share one anyway:
// models/team.js marks six fields `required: true` that CBB does not fill the
// same way, so a shared model would either reject basketball rows or have to
// drop guarantees football relies on.
//
// Measured against the live /teams?season=2027 payload (365 teams):
//
//   school          365/365 present, and UNIQUE — safe as a human-facing key
//   mascot          365/365 present (the issue expected nullable; it is not)
//   abbreviation    365/365
//   primaryColor    364/365
//   secondaryColor  331/365  <- a third have none, so it cannot be required
//   currentVenue    363/365
//   sourceId        365/365

const mongoose = require('mongoose');

const hoopsTeamSchema = new mongoose.Schema({
    // CBBD's own id. NOT unique on its own — see `season`.
    id: { type: Number, required: true },

    // ⚠️ A TEAM ROW IS PER SEASON, and this is why.
    //
    // /teams answers for ANY season — season=2026 returns 365 teams, not an
    // empty list — and 27 of them carry a DIFFERENT conference than in 2027
    // (Oregon State WCC -> Pac-12, Colorado State Mountain West -> Pac-12,
    // Denver Summit -> WCC, and so on). Keyed on id alone, ingesting the wrong
    // season silently rewrote the live rows' conferences and answered
    // "365 created".
    //
    // That is not a cosmetic field: the Torvik draft-pool import matches on
    // (school, conference) precisely because bare names are ambiguous, so a
    // poisoned conference corrupts the key the pool is built from.
    season: { type: Number, required: true },

    // The ESPN id, and the id CFBD's logo CDN is keyed on — which is why
    // basketball logos cost nothing. Verified: Alabama is sourceId 333 and
    // cdn.collegefootballdata.com/logos/500/333.png returns 200, the same id
    // football's Alabama row already stores.
    //
    // A STRING, as the API sends it. Nothing does arithmetic on it and a
    // leading zero would be a silent corruption.
    sourceId: { type: String },

    school: { type: String, required: true },
    mascot: { type: String },
    abbreviation: { type: String },
    displayName: { type: String },
    shortDisplayName: { type: String },

    // Named `color` / `alt_color` to match models/team.js, because every
    // renderer in public/ already reads those two names. CBBD calls them
    // primaryColor / secondaryColor and sends them WITHOUT a '#'; the ingest
    // adds it, so a stored value is interchangeable with football's.
    color: { type: String },
    alt_color: { type: String },

    // In football's 16-entry shape (light and dark at 8 sizes) so public/logo.js
    // pickLogo works unchanged — but ONLY for teams whose logo actually exists.
    //
    // ⚠️ THE LOGOS ARE NOT FREE FOR EVERY TEAM. The CFBD CDN only hosts schools
    // CFBD knows about, which means football schools. Measured across all 365:
    // 101 have NO logo there — every basketball-only program, including
    // Gonzaga, Marquette, Creighton, Seton Hall, Saint Mary's and Siena.
    //
    // Synthesising the URL anyway gave those teams 16 links that all 403, and
    // every render site emits a bare <img> with no onerror, so the row showed a
    // broken-image icon instead of falling back. The ingest verifies existence
    // and stores an EMPTY array on a miss, which pickLogo already answers '' for.
    logos: { type: [String] },

    conferenceId: { type: Number },
    conference: { type: String },

    // Flat, as CBBD sends it. models/team.js nests a `location` subdocument
    // with lat/long, capacity, dome and grass — none of which CBBD provides,
    // and all of which that schema requires.
    currentVenueId: { type: Number },
    currentVenue: { type: String },
    currentCity: { type: String },
    currentState: { type: String },

    // Bart Torvik's preseason T-Rank for THIS season (#320).
    //
    // Here rather than in its own collection because it is one flat record per
    // team per season, which is exactly this row's key, and the draft pool
    // wants it alongside the name and logo it is already reading.
    //
    // NOT where the in-season ratings will live. Those refresh weekly and have
    // to be kept as a series, because CBBD serves only a current value and no
    // history (#318) — overwriting this field every week would leave us unable
    // to say what a team was rated when it was drafted.
    preseason: {
        // 1..365, Torvik's own ordering. The draft pool is the top N of this.
        rank: { type: Number },
        adjOE: { type: Number },
        adjDE: { type: Number },
        // Torvik's headline number: probability of beating an average D-I team.
        barthag: { type: Number },
        projectedRecord: { type: String },
        // Which paste this came from, so a stale import is visible rather than
        // inferred from the numbers looking wrong.
        source: { type: String },
        importedAt: { type: String }
    }
}, { collection: 'hoopsteams' });

// One row per team per season, enforced rather than assumed.
hoopsTeamSchema.index({ season: 1, id: 1 }, { unique: true });
// Unique because a duplicated (school, conference) should fail the ingest
// rather than let findOne pick one of two arbitrarily. Originally added as the
// Torvik pool import's key; that import matches on `school` alone, which is
// unique by itself — see the note at the top of modules/torvik-pool.js.
hoopsTeamSchema.index({ season: 1, school: 1, conference: 1 }, { unique: true });
hoopsTeamSchema.index({ season: 1, conference: 1 });

module.exports = mongoose.model('HoopsTeam', hoopsTeamSchema);
