const crypto = require('crypto');

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
//      (Admin or League Manager).
// Everything else gets 403. Used to protect admin/write endpoints so an
// ordinary league member can't invoke them.
module.exports = function requireCommissioner(req, res, next) {
    const configured = process.env.INTERNAL_API_TOKEN;
    const provided = req.get('X-Internal-Token');
    if (configured && provided && safeEqual(provided, configured)) {
        return next();
    }

    if (req.oidc && req.oidc.isAuthenticated()) {
        const roles = (req.oidc.user && req.oidc.user.user_metadata && req.oidc.user.user_metadata.roles) || [];
        if (roles.includes('Admin') || roles.includes('League Manager')) {
            return next();
        }
    }

    return res.status(403).json({ message: 'Forbidden' });
};
