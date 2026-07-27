// Dev-only role spoofing. Lets a real Admin, in a non-production environment,
// view the app as a "League Manager" or a regular member to test permissions.
// It only ever DE-escalates (the real user must already be Admin), so it can't
// grant access — and it's a hard no-op in production. Everything that gates on
// roles or builds the view context reads the "effective" user/roles here, so
// the spoof is consistent across the server gates and the client UI.

const DEV = process.env.NODE_ENV !== 'production';
const SPOOF_COOKIE = 'cc_spoof';

function realRoles(oidcUser) {
    return (oidcUser && oidcUser.user_metadata && oidcUser.user_metadata.roles) || [];
}

// Only a real (Auth0) Admin may spoof — never a spoofed identity.
function isRealAdmin(req) {
    return !!(req && req.oidc && req.oidc.isAuthenticated() && realRoles(req.oidc.user).includes('Admin'));
}

function getCookie(req, name) {
    const header = (req && req.headers && req.headers.cookie) || '';
    const hit = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

// Active spoof payload { roles: [...], league?: code } or null. Gated to
// dev + a real Admin so it can never take effect in prod or for anyone else.
function readSpoof(req) {
    if (!DEV || !isRealAdmin(req)) return null;
    const raw = getCookie(req, SPOOF_COOKIE);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return (parsed && Array.isArray(parsed.roles)) ? parsed : null;
    } catch (e) {
        return null;
    }
}

function isSpoofing(req) {
    return readSpoof(req) !== null;
}

function effectiveRoles(req) {
    const s = readSpoof(req);
    return s ? s.roles : realRoles(req && req.oidc && req.oidc.user);
}

// A shallow clone of the OIDC user with roles/league overridden when spoofing,
// so buildUserContext / userState reflect the spoof. Returns the real user
// untouched when not spoofing.
function effectiveUser(req) {
    const u = req && req.oidc && req.oidc.user;
    const s = readSpoof(req);
    if (!s || !u) return u;
    const um = u.user_metadata || {};
    return Object.assign({}, u, {
        user_metadata: Object.assign({}, um, {
            roles: s.roles,
            metadata: Object.assign({}, um.metadata || {}, s.league ? { league: s.league } : {})
        })
    });
}

module.exports = { DEV, SPOOF_COOKIE, realRoles, isRealAdmin, readSpoof, isSpoofing, effectiveRoles, effectiveUser };
