// Terminal 404 / 500 handlers. Registered after every route in server.js, so
// they only ever see requests that no route claimed.
//
// Without them an unmatched path fell through to Express's built-in
// finalhandler, which answers with a bare unstyled "Cannot GET /whatever".
// That hurt in two places: logged-out visitors following a stale link saw it
// instead of a hand-off to /login (authRequired is false, so unmatched paths
// never reach the auth router at all), and a mistyped fetch against one of the
// JSON routers got HTML back — so client code calling res.json() threw a parse
// error instead of surfacing the status.
//
// Both handlers content-negotiate: a JSON body for API/XHR callers, the branded
// views/error.ejs page for browser navigations.

// Every prefix that server.js mounts a JSON router on. A request falling
// through under one of these was an API call, so it gets JSON even when the
// caller sent no Accept header (fetch's default is "*/*").
const API_PREFIXES = [
    '/users', '/teams', '/games', '/rankings', '/scores', '/recruiting',
    '/records', '/betting', '/draft', '/scoring-config', '/leagues',
    '/job-runs', '/audit-log', '/standings', '/history',
    '/calculate-team-score', '/dev'
];

function isApiPath(pathname) {
    return API_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

// Explicit signals win over the path heuristic: an XHR or a JSON-only Accept
// always gets JSON, and anything that asked for HTML (i.e. someone typing in
// the address bar, even under an API prefix) always gets the page.
function prefersJson(req) {
    const accept = (req.headers && req.headers.accept) || '';
    if (req.xhr) return true;
    if (accept.includes('application/json')) return true;
    if (accept.includes('text/html')) return false;
    return isApiPath(req.path || '');
}

function isAuthenticated(req) {
    try {
        return !!(req.oidc && req.oidc.isAuthenticated && req.oidc.isAuthenticated());
    } catch (e) {
        return false;   // never let the error page itself throw
    }
}

// apiMessage, when given, replaces `message` in the JSON body — "that page" is
// the wrong noun for a caller that asked for an endpoint.
function respond(req, res, status, heading, message, apiMessage) {
    res.status(status);
    if (prefersJson(req)) return res.json({ status, message: apiMessage || message });
    // res.render can throw in its own right (missing view, bad template). With a
    // callback nothing is sent until we say so, so a template failure degrades to
    // plain text instead of re-entering the error handler.
    res.render('error', {
        status,
        heading,
        message,
        isAuthenticated: isAuthenticated(req)
    }, (err, html) => {
        if (err) {
            console.error('Failed to render the error page:', err.message);
            return res.type('txt').send(status + ' ' + heading);
        }
        res.type('html').send(html);
    });
}

function notFound(req, res) {
    respond(req, res, 404, 'Page not found',
        "We couldn't find that page. It may have moved, or the link may be out of date.",
        'No route matches ' + req.method + ' ' + req.path);
}

// Four args: that signature is how Express recognizes error middleware.
function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);
    const status = Number(err && (err.status || err.statusCode)) || 500;
    if (status >= 500) console.error('Unhandled request error:', (err && err.stack) || err);
    // Deliberately never echoes err.message — the message would leak internals
    // (stack frames, driver errors, connection strings) to the browser.
    const heading = status >= 500 ? 'Something went wrong' : 'That request went sideways';
    const message = status >= 500
        ? "This one's on us. Try again in a moment — if it keeps happening, let the commissioner know."
        : "That request couldn't be completed. Head back and give it another shot.";
    respond(req, res, status, heading, message);
}

module.exports = { notFound, errorHandler, isApiPath, prefersJson, API_PREFIXES };
