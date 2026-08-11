// Minimal Auth0 Management API client.
//
// Used for exactly one thing: writing user_metadata when an invite is claimed
// (see modules/invite-bind.js). That is why the M2M application backing this
// only needs the `update:users` scope — the invite flow never creates Auth0
// accounts, it binds whichever identity the invitee signed in with.
//
// No SDK: Node has global fetch, and one PATCH does not justify a dependency
// with its own release cadence.

const CLOCK_SKEW_MS = 60 * 1000;   // renew a minute early rather than race expiry

// Module-level cache. Management tokens last 24h by default and every invite
// claim would otherwise buy a fresh one.
let cached = null;   // { token, expMs }

function issuerBase() {
    return String(process.env.ISSUER_BASE_URL || '').replace(/\/$/, '');
}

function isConfigured() {
    return !!(issuerBase() && process.env.AUTH0_M2M_CLIENT_ID && process.env.AUTH0_M2M_CLIENT_SECRET);
}

async function getToken(now = Date.now()) {
    if (cached && cached.expMs > now + CLOCK_SKEW_MS) return cached.token;

    const res = await fetch(issuerBase() + '/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            client_id: process.env.AUTH0_M2M_CLIENT_ID,
            client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
            audience: issuerBase() + '/api/v2/'
        })
    });
    if (!res.ok) {
        throw new Error('Auth0 token request failed: ' + res.status);
    }
    const body = await res.json();
    if (!body || !body.access_token) throw new Error('Auth0 token response had no access_token');

    cached = {
        token: body.access_token,
        expMs: now + (Number(body.expires_in) || 86400) * 1000
    };
    return cached.token;
}

// Shallow-merges `patch` into the user's user_metadata.
//
// Auth0 merges at the TOP level of user_metadata only — nested objects are
// replaced wholesale, not deep-merged. So a patch of { userId, league } leaves
// any other top-level key intact, and that is exactly the granularity the invite
// bind wants. Don't assume a deep merge when adding a second writer.
//
// Note `roles` does NOT live in user_metadata: the tenant's post-login Action
// sources it from event.authorization.roles and only re-nests user_metadata
// underneath. Nothing here needs to preserve it.
async function patchUserMetadata(sub, patch) {
    if (!isConfigured()) throw new Error('Auth0 Management API is not configured');
    if (!sub) throw new Error('patchUserMetadata needs a sub');

    const token = await getToken();
    const res = await fetch(issuerBase() + '/api/v2/users/' + encodeURIComponent(sub), {
        method: 'PATCH',
        headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + token
        },
        body: JSON.stringify({ user_metadata: patch })
    });
    if (!res.ok) {
        // A 401 here usually means the cached token was revoked rather than
        // expired; drop it so the next attempt re-authenticates instead of
        // replaying a dead token until the cache times out on its own.
        if (res.status === 401) cached = null;
        throw new Error('Auth0 user PATCH failed: ' + res.status);
    }
    return res.json();
}

// Tests only — the cache is module state and would leak between cases.
function _reset() { cached = null; }

module.exports = { getToken, patchUserMetadata, isConfigured, _reset };
