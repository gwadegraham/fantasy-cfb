const crypto = require('crypto');

// Small self-contained signed token (HMAC-SHA256) used to authenticate socket
// connections. The browser gets one from GET /draft-token (which requires an
// Auth0 session), then passes it in the socket handshake. This avoids threading
// the express-openid-connect session through Socket.IO while still giving the
// socket server a trustworthy identity. Signed with AUTH_SECRET.

function sign(payload, secret, ttlMs = 6 * 60 * 60 * 1000) {
    const body = { ...payload, exp: Date.now() + ttlMs };
    const data = Buffer.from(JSON.stringify(body)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${sig}`;
}

function verify(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, sig] = parts;

    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    let body;
    try {
        body = JSON.parse(Buffer.from(data, 'base64url').toString());
    } catch (e) {
        return null;
    }
    if (!body.exp || Date.now() > body.exp) return null;
    return body;
}

module.exports = { sign, verify };
