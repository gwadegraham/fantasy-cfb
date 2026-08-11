// Wrapper around fetch() for server-to-server calls the app makes to its own
// API (jobs and scoring modules hitting process.env.URL). It attaches the
// shared internal token so those calls pass the requireAuthOrToken middleware
// even though there is no browser session. See modules/require-auth.js.
function internalFetch(url, options = {}) {
    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            'X-Internal-Token': process.env.INTERNAL_API_TOKEN || ''
        }
    });
}

// A failed internal call's message, read WITHOUT ever rejecting.
//
// The app's own API answers JSON, but what sits in front of it may not: Heroku
// serves an HTML error page for H12 (30s request timeout) and 503, which is
// exactly what a long Saturday scoring run provokes. response.json() rejects on
// that, and the scoring write helpers used to leave the rejection unhandled — no
// await, no catch. With no process-level unhandledRejection handler anywhere,
// Node exits: mid-pass, some managers written and others not, and the web dyno
// goes down with it because that is where the scheduler runs.
async function failureMessage(response) {
    try {
        const data = await response.json();
        if (data && data.message) return `${data.message} (HTTP ${response.status})`;
    } catch (err) {
        return `HTTP ${response.status} — non-JSON response body`;
    }
    return `HTTP ${response.status}`;
}

module.exports = { internalFetch, failureMessage };
