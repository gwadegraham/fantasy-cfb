// Commissioner roster correction: swap one team on a manager's season roster
// for an undrafted one.
//
// Until now a completed draft was final — the only write path was
// PATCH /users/draft/:id, which bulk-overwrites all ten teams and has no UI. So
// a misclick on draft night (easy, since commissioners pick on behalf of absent
// managers) was permanent. This is the narrow, auditable fix for that.
//
// A correction rewrites BOTH sides: the manager's seasons[].teams AND the
// matching drafts.picks[] entry. Those are the two places a rostered team is
// stored (see modules/team-refresh.js, which has to keep them in sync for the
// same reason), and draft grades, the draft board, and the "Draft Steal"
// highlight all read the picks. Correcting one and not the other would leave
// them quietly disagreeing.
//
// Pure and DB-free so it's unit-testable; routes/users.js loads the documents
// and applies the results.

// CFBD's team.location uses `id`; the user schema's location requires
// `venue_id`. modules/draft-socket.js does this same remap when it persists a
// completed draft onto rosters — the two must agree, or a corrected team would
// be shaped differently from a drafted one.
function normalizeLocation(location) {
    if (!location) return location;
    const loc = Object.assign({}, location);
    if (loc.id != null && loc.venue_id == null) loc.venue_id = loc.id;
    delete loc.id;
    return loc;
}

// The fields a roster team carries (models/user.js teamSchema). Copied
// explicitly rather than spreading the whole Team document, which also holds
// per-season ratings and scores that have no business on a roster entry.
const ROSTER_TEAM_FIELDS = [
    'id', 'school', 'mascot', 'abbreviation',
    'alt_name1', 'alt_name2', 'alt_name3', 'alternateNames',
    'conference', 'division', 'color', 'alt_color', 'logos', 'twitter'
];

// Build a roster-shaped team from a Team document.
function rosterTeamFrom(teamDoc) {
    if (!teamDoc) return null;
    const out = {};
    ROSTER_TEAM_FIELDS.forEach(f => { if (teamDoc[f] !== undefined) out[f] = teamDoc[f]; });
    if (teamDoc.location) out.location = normalizeLocation(teamDoc.location);
    return out;
}

// The user schema's location requires more fields than the team schema does
// (zip, latitude, longitude, capacity, grass, dome), so a team with a thin
// location record would fail validation on save with an opaque error. Checking
// up front turns that into a message naming the team.
const REQUIRED_LOCATION_FIELDS = ['venue_id', 'name', 'city', 'state', 'zip', 'latitude', 'longitude', 'capacity'];

function missingLocationFields(team) {
    const loc = (team && team.location) || null;
    if (!loc) return ['location'];
    return REQUIRED_LOCATION_FIELDS.filter(f => loc[f] == null);
}

// Validate a proposed correction. Returns { ok: true } or { ok: false, status,
// message }. Every branch is a distinct HTTP status so the client can react
// (409 = taken, 423 = locked) rather than parsing prose.
//
//   roster        the manager's current seasons[].teams
//   targetTeam    the Team document for toTeamId (null if unknown)
//   takenBy       { name } if another manager in the league already has it
//   seasonUnderway  whether the season has scored games
//   isAdmin       Admins may still correct a season that's underway
function validateCorrection({ roster, fromTeamId, toTeamId, targetTeam, takenBy, seasonUnderway, isAdmin }) {
    if (fromTeamId == null || toTeamId == null) {
        return { ok: false, status: 400, message: 'Both the current team and the replacement are required.' };
    }
    if (Number(fromTeamId) === Number(toTeamId)) {
        return { ok: false, status: 400, message: 'That manager already has this team.' };
    }
    // Locked once results exist: the roster is baked into every scored week, so
    // a swap needs a full re-score to be meaningful. Admins can still proceed
    // (and are told to re-score); League Managers are stopped. Mirrors the
    // season-membership lock in routes/users.js.
    if (seasonUnderway && !isAdmin) {
        return { ok: false, status: 423, message: 'Rosters lock once the season is underway. Ask an admin — the change needs a full re-score.' };
    }
    const current = (roster || []).find(t => Number(t.id) === Number(fromTeamId));
    if (!current) {
        return { ok: false, status: 404, message: 'That team is not on this manager\'s roster.' };
    }
    // The manager's OWN roster, checked here rather than via the "taken by
    // someone else" lookup — that query deliberately excludes this user, so
    // without this a swap onto a team they already hold would sail through and
    // leave the same team on the roster twice.
    const dupe = (roster || []).find(t => Number(t.id) === Number(toTeamId));
    if (dupe) {
        return { ok: false, status: 409, message: `That manager already has ${dupe.school}.` };
    }
    if (!targetTeam) {
        return { ok: false, status: 404, message: 'Could not find the replacement team.' };
    }
    if (takenBy) {
        return { ok: false, status: 409, message: `${targetTeam.school} is already on ${takenBy.name}'s roster.` };
    }
    const missing = missingLocationFields(rosterTeamFrom(targetTeam));
    if (missing.length) {
        return {
            ok: false, status: 422,
            message: `${targetTeam.school} is missing venue details (${missing.join(', ')}) and can't be rostered. Run Refresh Teams for this season, then try again.`
        };
    }
    return { ok: true, current };
}

// Swap the team on a roster, preserving order so the draft-order reading of a
// roster (and anything rendering it) doesn't jump around after a correction.
function replaceRosterTeam(teams, fromTeamId, nextTeam) {
    let changed = false;
    const out = (teams || []).map(t => {
        if (!changed && Number(t.id) === Number(fromTeamId)) { changed = true; return nextTeam; }
        return t;
    });
    return { teams: out, changed };
}

// Swap the team on the matching draft pick — the manager's pick of that team in
// that draft. Keeps round/overall/pickedAt intact: the slot is unchanged, only
// which team went in it was wrong.
function replaceDraftPick(picks, userId, fromTeamId, nextTeam) {
    let changed = false;
    const out = (picks || []).map(p => {
        if (changed) return p;
        const sameUser = String(p.userId) === String(userId);
        const sameTeam = p.team && Number(p.team.id) === Number(fromTeamId);
        if (!sameUser || !sameTeam) return p;
        changed = true;
        const next = Object.assign({}, p.toObject ? p.toObject() : p);
        next.team = nextTeam;
        next.correctedAt = new Date();
        return next;
    });
    return { picks: out, changed };
}

module.exports = {
    normalizeLocation, rosterTeamFrom, missingLocationFields,
    validateCorrection, replaceRosterTeam, replaceDraftPick,
    ROSTER_TEAM_FIELDS, REQUIRED_LOCATION_FIELDS
};
