const crypto = require('crypto');

// Constant-time string comparison that never throws on length mismatch.
function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

// Allows a request through if EITHER:
//   1. it carries a valid X-Internal-Token header (server-to-server calls from
//      the scheduled jobs / scoring modules), OR
//   2. it comes from an authenticated browser session (req.oidc).
// Everything else gets a 401. INTERNAL_API_TOKEN must be set to the same value
// on both the web host and the job/scheduler environment.
module.exports = function requireAuthOrToken(req, res, next) {
    const configured = process.env.INTERNAL_API_TOKEN;
    const provided = req.get('X-Internal-Token');

    if (configured && provided && safeEqual(provided, configured)) {
        return next();
    }

    if (req.oidc && req.oidc.isAuthenticated()) {
        return next();
    }

    return res.status(401).json({ message: 'Unauthorized' });
};
