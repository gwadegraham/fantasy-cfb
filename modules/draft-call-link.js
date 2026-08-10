// Validation for the commissioner's draft-night video call link (Zoom, Google
// Meet, Discord — whatever the league uses). DB-free so it can be unit-tested;
// routes/draft.js applies the result.
//
// The saved value becomes an href on every manager's My Team tile and in the
// draft room, so it is only accepted as an absolute http(s) URL. That is what
// keeps a `javascript:` or `data:` payload — entered by a commissioner, or by
// anyone who reaches the commissioner-gated save — from turning into a live
// link on someone else's page. The clients re-check before rendering too.

const CALL_URL_MAX = 500;

// Returns a normalized URL string, or null when there's no link (blank clears
// it). Throws with a manager-facing message on anything unusable.
function sanitizeCallUrl(value) {
    if (value == null) return null;
    if (typeof value !== 'string') {
        throw new Error('Video call link must be text');
    }
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > CALL_URL_MAX) {
        throw new Error(`Video call link must be ${CALL_URL_MAX} characters or fewer`);
    }

    let parsed;
    try {
        parsed = new URL(trimmed);
    } catch (err) {
        throw new Error('Video call link must be a full URL, e.g. https://zoom.us/j/123456789');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Video call link must start with http:// or https://');
    }
    return parsed.href;
}

module.exports = { sanitizeCallUrl, CALL_URL_MAX };
