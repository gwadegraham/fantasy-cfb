// Validation for a browser-supplied Web Push subscription. DB-free so it can be
// unit-tested; routes/users.js applies the result.
//
// The browser hands us a PushSubscription serialized by the Push API. It arrives
// from the client, so it is untrusted input: an authenticated manager could post
// an arbitrary endpoint, and every future send would then fire an HTTP request
// at a host of their choosing from our dyno. Restricting the endpoint to https
// and capping the field lengths is what keeps a subscription record from being
// a stored SSRF primitive or a way to bloat a user document.

const MAX_ENDPOINT = 1000;
const MAX_KEY = 200;
const MAX_USER_AGENT = 300;
// One manager, realistically: a phone, a tablet, a laptop, a work laptop. The
// cap exists so a buggy client that re-subscribes in a loop cannot grow the
// user document without bound.
const MAX_SUBSCRIPTIONS = 10;

function isHttpsUrl(value) {
    if (typeof value !== 'string' || value.length > MAX_ENDPOINT) return false;
    let parsed;
    try { parsed = new URL(value); } catch (e) { return false; }
    return parsed.protocol === 'https:';
}

function isKey(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY;
}

// Normalizes a posted subscription into exactly the fields we store. Throws
// Error(message) on invalid input -> the route maps to 400.
function sanitizeSubscription(body, userAgent) {
    const b = body || {};
    const sub = b.subscription || b;

    if (!isHttpsUrl(sub.endpoint)) {
        throw new Error('A push subscription needs an https endpoint.');
    }
    const keys = sub.keys || {};
    if (!isKey(keys.p256dh) || !isKey(keys.auth)) {
        throw new Error('A push subscription needs both p256dh and auth keys.');
    }

    const ua = typeof userAgent === 'string' ? userAgent.slice(0, MAX_USER_AGENT) : undefined;

    return {
        endpoint: sub.endpoint,
        keys: { p256dh: keys.p256dh, auth: keys.auth },
        userAgent: ua,
        createdAt: new Date()
    };
}

// Only the known alert types, only booleans. An absent key is left absent so a
// partial update doesn't silently re-enable something the manager muted.
const PREF_KEYS = ['score', 'leadChange', 'closeGame', 'final', 'captainLock'];

function sanitizePrefs(body) {
    const b = body || {};
    const out = {};
    for (const key of PREF_KEYS) {
        if (Object.prototype.hasOwnProperty.call(b, key)) {
            if (typeof b[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
            out[key] = b[key];
        }
    }
    if (!Object.keys(out).length) throw new Error('No alert preferences supplied.');
    return out;
}

module.exports = { sanitizeSubscription, sanitizePrefs, isHttpsUrl, PREF_KEYS, MAX_SUBSCRIPTIONS };
