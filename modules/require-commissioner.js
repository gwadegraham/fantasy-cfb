const crypto = require('crypto');
const { effectiveRoles } = require('./dev-role');
const { managedLeagues } = require('./league-access');

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

// Allows a request through only if it is either:
//   1. a server-to-server call carrying the internal token (scheduled jobs /
//      scoring modules / the live-draft persist step), OR
//   2. an authenticated session whose user has a commissioner role
//      (Admin or League Manager), or who is on some league's commissioner
//      list (#600) — appointed without the Auth0 role. The handlers decide
//      WHICH league with canManageLeague; this gate only says "a commissioner
//      of something", exactly as the role always did.
// Everything else gets 403. Used to protect admin/write endpoints so an
// ordinary league member can't invoke them.
module.exports = function requireCommissioner(req, res, next) {
    const configured = process.env.INTERNAL_API_TOKEN;
    const provided = req.get('X-Internal-Token');
    if (configured && provided && safeEqual(provided, configured)) {
        return next();
    }

    if (req.oidc && req.oidc.isAuthenticated()) {
        const roles = effectiveRoles(req);
        if (roles.includes('Admin') || roles.includes('League Manager')) {
            return next();
        }
        if (managedLeagues(req).length) return next();
    }

    return res.status(403).json({ message: 'Forbidden' });
};
