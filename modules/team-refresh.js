// Helpers for propagating refreshed team data into the DENORMALIZED copies the
// app renders from. Team data lives in three places: the `teams` collection
// (source of truth, updated by /teams/refresh) and two snapshots taken at draft
// time — `users.seasons[].teams[]` and `drafts.picks[].team`. Refreshing only
// the source leaves Standings / My Team / Draft Room rendering stale team info,
// so after a refresh we push the fresh fields into those embedded copies.
//
// Pure + DB-free so the sync logic is unit-testable; the route does the Mongo I/O.

// Fields safe to overwrite in the embedded copies. All are display data that
// nothing keys off — including `school`: the score aggregations now match by the
// stable teamId (with a school fallback), so a rename ("Louisiana St." ->
// "Louisiana State") flows through without dropping points. Deliberately NOT
// synced: `id` (the join key), and `conference`/`division` (year-sensitive — a
// global overwrite would mislabel past seasons for teams that changed leagues).
const SCALAR_FIELDS = ['school', 'mascot', 'abbreviation', 'color', 'alt_color', 'twitter'];
const ARRAY_FIELDS = ['logos', 'alternateNames'];

// Map of team id -> source team object, from the freshly-fetched CFBD teams.
function teamsById(teams) {
    const map = {};
    (teams || []).forEach(t => { if (t && t.id != null) map[t.id] = t; });
    return map;
}

function sameArray(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

// Overwrite each embedded team's synced fields from the id->team map, in place.
// Returns the number of teams actually changed (0 => nothing to save). Skips
// teams not in the map and fields already equal, so re-running is a cheap no-op.
function applyTeamFields(embeddedTeams, byId) {
    let changed = 0;
    (embeddedTeams || []).forEach(t => {
        if (!t || t.id == null) return;
        const src = byId[t.id];
        if (!src) return;
        let dirty = false;
        SCALAR_FIELDS.forEach(f => {
            if (src[f] !== undefined && t[f] !== src[f]) { t[f] = src[f]; dirty = true; }
        });
        ARRAY_FIELDS.forEach(f => {
            if (Array.isArray(src[f]) && !sameArray(t[f], src[f])) { t[f] = src[f].slice(); dirty = true; }
        });
        if (dirty) changed += 1;
    });
    return changed;
}

module.exports = { teamsById, applyTeamFields, sameArray, SCALAR_FIELDS, ARRAY_FIELDS };
