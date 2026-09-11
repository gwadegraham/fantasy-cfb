const mongoose = require('mongoose');

// Which season a SPORT is currently in.
//
// This is deliberately not a property of a league. "Fetch the 2026 team stats"
// is a fact about football, not about Graham League — and both football leagues
// run the same CFBD season, so asking "which league's season?" for an ingest job
// has no single answer. With basketball arriving (epic #310), football 2026 and
// basketball 2026-27 are live at the same time, so a single global cannot answer
// it either. One row per sport can.
//
// A League points at a (sport, season) pair; the ingest jobs and every CFBD/CBBD
// route read the pair straight from here.
const sportSeasonSchema = new mongoose.Schema({
    sport: { type: String, required: true, unique: true },

    // The season CFBD/CBBD calls it. Football 2026 = the 2026-27 academic year;
    // basketball uses the ENDING year, so the 2026-27 season is 2027 to CBBD.
    season: { type: Number, required: true },

    // 'preseason'  — schedule ingested, nothing played, no scoring
    // 'in-season'  — games being played and scored
    // 'complete'   — season over, kept for history
    status: {
        type: String,
        enum: ['preseason', 'in-season', 'complete'],
        default: 'in-season'
    }
}, { timestamps: true });

module.exports = mongoose.model('SportSeason', sportSeasonSchema);
