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
    // CBBD's own id. The upsert key.
    id: { type: Number, required: true, unique: true },

    // The ESPN id, and the id CFBD's logo CDN is keyed on — which is why
    // basketball logos cost nothing. Verified: Alabama is sourceId 333 and
    // cdn.collegefootballdata.com/logos/500/333.png returns 200, the same id
    // football's Alabama row already stores.
    //
    // A STRING, as the API sends it. Nothing does arithmetic on it and a
    // leading zero would be a silent corruption.
    sourceId: { type: String },

    school: { type: String, required: true, index: true },
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

    // Synthesised from sourceId in the same 16-entry shape football stores
    // (light and dark at 8 sizes), so public/logo.js pickLogo works unchanged
    // rather than needing a basketball branch.
    logos: { type: [String] },

    conferenceId: { type: Number },
    conference: { type: String, index: true },

    // Flat, as CBBD sends it. models/team.js nests a `location` subdocument
    // with lat/long, capacity, dome and grass — none of which CBBD provides,
    // and all of which that schema requires.
    currentVenueId: { type: Number },
    currentVenue: { type: String },
    currentCity: { type: String },
    currentState: { type: String }
}, { collection: 'hoopsteams' });

module.exports = mongoose.model('HoopsTeam', hoopsTeamSchema);
