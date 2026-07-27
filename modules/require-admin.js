const crypto = require('crypto');
const { effectiveRoles } = require('./dev-role');

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// Platform-wide / cross-league operations (global data sync, scoring runs,
// market odds). Allowed only for:
//   1. server-to-server calls carrying the internal token (scheduled jobs), OR
//   2. an authenticated Admin session.
// A League Manager is NOT sufficient here — those are league-scoped and use
// requireCommissioner instead. Everything else gets 403.
module.exports = function requireAdmin(req, res, next) {
    const configured = process.env.INTERNAL_API_TOKEN;
    const provided = req.get('X-Internal-Token');
    if (configured && provided && safeEqual(provided, configured)) {
        return next();
    }
    if (req.oidc && req.oidc.isAuthenticated() && effectiveRoles(req).includes('Admin')) {
        return next();
    }
    return res.status(403).json({ message: 'Forbidden' });
};
