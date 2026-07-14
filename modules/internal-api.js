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

module.exports = { internalFetch };
