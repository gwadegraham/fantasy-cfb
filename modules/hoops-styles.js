// Reading basketball style tags (#542) for a page. The job that writes them is
// modules/hoops-styles-job.js; the tags themselves come from
// modules/hoops-style-tags.js.
//
// No CBBD calls: one slim Mongo read.

const HoopsTeamStyle = require('../models/hoopsTeamStyle');

// CBBD labels a season by its ENDING year: 2026 is "2025–26".
function seasonLabel(season) {
    // Not Number(null), which is 0 and would label a missing season "-1–0".
    const s = season == null || season === '' ? NaN : Number(season);
    if (!Number.isInteger(s)) return null;
    return `${s - 1}–${String(s).slice(-2)}`;
}

// Where a season's tags came from, for the caption. `lastSeason` is the
// preseason case, which pages must say out loud: a team's tags before
// tip-off describe LAST year's roster.
function sourceOf(season, fromSeason) {
    if (fromSeason == null) return null;
    return { fromSeason, label: seasonLabel(fromSeason), lastSeason: Number(fromSeason) < Number(season) };
}

// { source, byTeam: { [teamId]: [{ key, label, detail }] } } for a season,
// optionally only some teams; `source` is null when nothing is stored.
async function stylesFor(season, teamIds = null) {
    const filter = { season: Number(season) };
    if (teamIds) filter.teamId = { $in: teamIds.map(Number) };
    const rows = await HoopsTeamStyle.find(filter, { teamId: 1, fromSeason: 1, tags: 1, _id: 0 }).lean();
    const byTeam = {};
    let fromSeason = null;
    for (const r of rows) {
        byTeam[String(r.teamId)] = (r.tags || []).map(t => ({ key: t.key, label: t.label, detail: t.detail || null }));
        // One season's rows always come from one leaderboard: the job
        // replaces them wholesale.
        if (fromSeason == null) fromSeason = r.fromSeason;
    }
    return { source: sourceOf(season, fromSeason), byTeam };
}

module.exports = { stylesFor, seasonLabel, sourceOf };
