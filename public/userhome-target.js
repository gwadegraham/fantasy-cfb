// Which franchise /userHome shows, and what it shows when that fails (#641).
//
// Every link into the page carries ?user=, but a bookmark or a pasted link
// with the query stripped may not. The page used to fetch
// /users/null, get a 500, and render nothing at all. With no ?user= it now
// shows the VIEWER's own team — the same id the My Team tab links with (the
// Auth0 metadata userId, cached as localStorage 'userId' by the navbar) — and
// any failed load gets an error state with a way home instead of a blank page.
//
// UMD so the page loads it as a plain script and Jest can require it.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccUserHomeTarget = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function myTeamHref(viewerId) {
        return viewerId ? '/userHome?user=' + encodeURIComponent(viewerId) : null;
    }

    // { id, search }: the id to load, and the query string to put back in the
    // address bar when it was filled in from the viewer (null = leave the URL
    // alone). id is null when there is nobody to show — no ?user= and no
    // known viewer — which the caller treats as a failed load.
    function resolve(search, viewerId) {
        var params = new URLSearchParams(search || '');
        var asked = (params.get('user') || '').trim();
        if (asked) return { id: asked, search: null };
        if (!viewerId) return { id: null, search: null };
        params.set('user', String(viewerId));
        return { id: String(viewerId), search: '?' + params.toString() };
    }

    // The error state. "Go to My Team" is left off when it would only reload
    // the page that just failed (the viewer's own id, with no team here).
    function errorHtml(targetId, viewerId) {
        var href = myTeamHref(viewerId);
        var showLink = href && String(targetId || '') !== String(viewerId);
        return '<div class="uh-tile span2 uh-preseason uh-load-error" role="alert">'
            + '<p class="uh-preseason-h">That team isn’t in this league.</p>'
            + (showLink
                ? '<a class="btn-primary uh-load-error-cta" href="' + esc(href) + '">Go to My Team</a>'
                : '<a class="btn-secondary uh-load-error-cta" href="/leagues">See your leagues</a>')
            + '</div>';
    }

    return { resolve: resolve, errorHtml: errorHtml, myTeamHref: myTeamHref };
}));
