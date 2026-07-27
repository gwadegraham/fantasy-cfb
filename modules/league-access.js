const crypto = require('crypto');
const { effectiveRoles, effectiveUser } = require('./dev-role');

// The league a user belongs to, from their Auth0 inner metadata flag
// ('gg' -> graham-league, anything else -> claunts-league).
function leagueCodeFor(oidcUser) {
    const inner = (oidcUser && oidcUser.user_metadata && oidcUser.user_metadata.metadata) || {};
    return inner.league === 'gg' ? 'graham-league' : 'claunts-league';
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

module.exports = { leagueCodeFor, canManageLeague };
