const crypto = require('crypto');
const { effectiveRoles, effectiveUser } = require('./dev-role');
const seasons = require('./active-season');

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

// The ACCOUNT id behind a session — the Auth0 pointer, which is a Mongo
// Account _id (#313). dev-role never overrides it, so a spoof keeps it.
function accountIdOf(req) {
    const u = effectiveUser(req);
    const inner = (u && u.user_metadata && u.user_metadata.metadata) || {};
    return inner.userId ? String(inner.userId) : null;
}

// Is this account on the league's commissioner list (#600)? A fact about the
// PERSON, so dev-role's spoof (which swaps the role) does not change it.
function commissions(req, league) {
    if (!league) return false;
    const id = accountIdOf(req);
    return !!id && seasons.commissionersOf(league).includes(id);
}

// Every league this caller may manage, short of being an Admin (an Admin's
// answer is "all of them", which a list cannot say). The Auth0 flag's league
// for a League Manager, then every league whose commissioner list has them.
// Ordered: the flag's league first, the rest sorted, so a "home" pick is
// stable.
function managedLeagues(req) {
    const out = [];
    if (effectiveRoles(req).includes('League Manager')) out.push(leagueCodeFor(effectiveUser(req)));
    seasons.leaguesCommissionedBy(accountIdOf(req)).sort()
        .forEach(code => { if (!out.includes(code)) out.push(code); });
    return out;
}

// May the caller manage this league? Trusted server-to-server calls (internal
// token) and Admins: any league. Everyone else: the leagues managedLeagues
// lists — a League Manager's own league from the Auth0 flag, plus any league
// that names them as a commissioner (#600). Uses effective roles/user so it
// honors a dev role-spoof.
//
// ⚠️ DELIBERATELY NOT modules/league-selection.js. That module answers which
// league the viewer picked, from a cookie they control — and a League Manager
// who could pick their way into managing another league is an escalation, not
// a feature. Authority comes from the Auth0 flag and the League document,
// which the viewer cannot write.
function canManageLeague(req, league) {
    if (tokenOk(req)) return true;
    const roles = effectiveRoles(req);
    if (roles.includes('Admin')) return true;
    if (roles.includes('League Manager') && leagueCodeFor(effectiveUser(req)) === league) return true;
    return commissions(req, league);
}

module.exports = { leagueCodeFor, leagueFlagFor, canManageLeague, accountIdOf, commissions, managedLeagues };
