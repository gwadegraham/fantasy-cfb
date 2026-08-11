const crypto = require('crypto');
const { effectiveRoles, effectiveUser } = require('./dev-role');

// The league a user belongs to, from their Auth0 inner metadata flag
// ('gg' -> graham-league, anything else -> claunts-league).
function leagueCodeFor(oidcUser) {
    const inner = (oidcUser && oidcUser.user_metadata && oidcUser.user_metadata.metadata) || {};
    return inner.league === 'gg' ? 'graham-league' : 'claunts-league';
}

// Inverse of leagueCodeFor: the Auth0 metadata flag for a league code. Anything
// that WRITES the flag (modules/invite-bind.js) has to go through this — the two
// vocabularies are easy to confuse, since Mongo stores 'graham-league' while
// Auth0 stores 'gg', and writing the Mongo value silently resolves the member
// into the other league rather than failing. Kept next to its inverse so the
// pair can't drift.
function leagueFlagFor(league) {
    return league === 'graham-league' ? 'gg' : 'cl';
}

function tokenOk(req) {
    const configured = process.env.INTERNAL_API_TOKEN;
    const provided = req && req.get && req.get('X-Internal-Token');
    if (!configured || !provided) return false;
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(configured));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// May the caller manage this league? Trusted server-to-server calls (internal
// token) and Admins: any league. League Managers: only their own. Uses
// effective roles/user so it honors a dev role-spoof.
function canManageLeague(req, league) {
    if (tokenOk(req)) return true;
    const roles = effectiveRoles(req);
    if (roles.includes('Admin')) return true;
    if (roles.includes('League Manager')) return leagueCodeFor(effectiveUser(req)) === league;
    return false;
}

module.exports = { leagueCodeFor, leagueFlagFor, canManageLeague };
