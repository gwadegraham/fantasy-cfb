// Helpers for propagating refreshed team data into the DENORMALIZED copies the
// app renders from. A team's logos live in three places: the `teams` collection
// (source of truth, updated by /teams/refresh) and two snapshots taken at draft
// time — `users.seasons[].teams[]` and `drafts.picks[].team`. Refreshing only
// the source leaves Standings / My Team / Draft Room rendering the old logos, so
// after a refresh we push the new logos into those embedded copies.
//
// Pure + DB-free so the sync logic is unit-testable; the route does the Mongo I/O.

// Map of team id -> logos array, from the freshly-fetched CFBD teams.
function logosById(teams) {
    const map = {};
    (teams || []).forEach(t => { if (t && t.id != null && Array.isArray(t.logos)) map[t.id] = t.logos; });
    return map;
}

function sameLogos(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// Overwrite each embedded team's `logos` from the id->logos map, in place.
// Returns the number of teams actually changed (0 => nothing to save). Skips
// teams not in the map and teams whose logos already match, so re-running is a
// cheap no-op.
function applyLogos(embeddedTeams, map) {
    let changed = 0;
    (embeddedTeams || []).forEach(t => {
        if (!t || t.id == null) return;
        const next = map[t.id];
        if (next && !sameLogos(t.logos, next)) { t.logos = next.slice(); changed += 1; }
    });
    return changed;
}

module.exports = { logosById, applyLogos, sameLogos };
