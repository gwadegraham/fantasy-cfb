// Commissioner invite tokens.
//
// A link the commissioner sends to a new (or locked-out) manager. The token
// names a franchise; it does NOT create an Auth0 account. The invitee opens the
// link, signs in however they like — Google, Apple, password — and
// modules/invite-bind.js binds whatever identity they used to that franchise.
//
// The signing is draft-token's: HMAC-SHA256 over base64url with a baked-in
// `exp`, compared with timingSafeEqual, keyed on AUTH_SECRET. That is exactly
// what an invite needs, so this wraps it rather than growing a second crypto
// implementation to keep in step. What lives here is the invite's own shape and
// lifetime.
//
// The token is a bearer credential: whoever holds the link can claim the
// franchise. Three things bound the damage — a 14-day expiry, single-use
// (invite-bind refuses once User.authSub is set), and the email gate in
// invite-bind for franchises that already know their manager's address.

const draftToken = require('./draft-token');

// Long enough to survive a group chat that nobody reads until the weekend,
// short enough that a link forwarded around in March is dead by preseason.
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

// `userId` is the Mongo User._id the invitee will be bound to. `league` rides
// along so the bind can write metadata.league without a second lookup, and so a
// token minted for one league can be sanity-checked against the record.
function sign(claim, secret, ttlMs = TTL_MS) {
    if (!claim || !claim.userId || !secret) return null;
    return draftToken.sign(
        { inv: String(claim.userId), league: claim.league || '' },
        secret,
        ttlMs
    );
}

// Returns { userId, league } or null. Null covers every failure the caller
// should treat identically: bad signature, tampered payload, expired, garbage.
function verify(token, secret) {
    if (!secret) return null;
    const body = draftToken.verify(token, secret);
    if (!body || !body.inv) return null;
    return { userId: String(body.inv), league: body.league || '' };
}

// The URL to hand the invitee. baseUrl is process.env.URL.
function linkFor(baseUrl, token) {
    return String(baseUrl || '').replace(/\/$/, '') + '/invite/' + token;
}

module.exports = { sign, verify, linkFor, TTL_MS };
