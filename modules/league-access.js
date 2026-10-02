const crypto = require('crypto');
const { effectiveRoles, effectiveUser } = require('./dev-role');

// The league a user belongs to, from their Auth0 inner metadata flag
// ('gg' -> graham-league, anything else -> claunts-league).
//
// ⚠️ THIS IS AUTHORITY, NOT A VIEW. It answers "which league is this person
// OF", and canManageLeague below decides a League Manager's permissions with
// it. It must never become the league they are currently LOOKING AT — that is
// modules/league-selection.js, which is a cookie the viewer controls, and
// wiring it in here would let a League Manager select the other league and
// manage it. The two answers are separate on purpose.
//
// Binary, and the default branch is why it cannot express a third league: a
// basketball league resolves to claunts-league. Retiring it in favour of
// franchise membership is the rest of #319; it survives here because
// permissions are the one place a wrong answer is a security bug rather than
// a wrong page.
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
//
// ⚠️ DELIBERATELY NOT modules/league-selection.js. That module answers which
// league the viewer picked, from a cookie they control — and a League Manager
// who could pick their way into managing another league is an escalation, not
// a feature. Authority stays on the Auth0 flag.
function canManageLeague(req, league) {
    if (tokenOk(req)) return true;
    const roles = effectiveRoles(req);
    if (roles.includes('Admin')) return true;
    if (roles.includes('League Manager')) return leagueCodeFor(effectiveUser(req)) === league;
    return false;
}

module.exports = { leagueCodeFor, leagueFlagFor, canManageLeague };
