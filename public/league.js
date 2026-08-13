// Shared league identity (ccLeague): which league a page is showing, and what
// that league is CALLED.
//
// Display names are commissioner-editable (models/league.js + PATCH
// /leagues/:code), so nothing client-side may hardcode "Graham League" — a
// rename has to reach every surface. views/partials/navbar.ejs seeds
// window.CC_LEAGUE from the server on every render; this is its only reader.
(function () {
    var SEED = window.CC_LEAGUE || {};

    function all() { return SEED.all || []; }

    // The league this page is about, in priority order:
    //   1. a league the server rendered the page FOR (/rules and /draft-board
    //      pin it on <body>) — that can carry an Admin's ?league=, which storage
    //      knows nothing about,
    //   2. an Admin's sticky selection from the navbar switcher,
    //   3. the viewer's own league.
    // Step 2 is Admin-gated on purpose: leagueCode outlives a logout, so a
    // member signing in on a shared browser must not inherit the last Admin's
    // pick. It mirrors how the pages already choose which league's data to load.
    function code() {
        var pinned = document.body && document.body.getAttribute('data-league-code');
        if (pinned) return pinned;
        if (SEED.canSwitch) {
            var stored = null;
            try { stored = window.localStorage.getItem('leagueCode'); } catch (e) { stored = null; }
            if (stored && all().some(function (l) { return l.code === stored; })) return stored;
        }
        return SEED.code || '';
    }

    // Display name for a league code (defaults to the current page's league).
    // Empty string when it can't be resolved, so callers can treat "no name" as
    // "render nothing" rather than printing a raw code at someone.
    function name(which) {
        var want = which || code();
        var hit = all().filter(function (l) { return l.code === want; })[0];
        return hit ? hit.name : '';
    }

    // Page title with the league in it, so two tabs on the same page in
    // different leagues are tellable apart:
    //   "Standings · Graham League · Campus Clash"
    function title(page) {
        return [page, name(), 'Campus Clash'].filter(Boolean).join(' · ');
    }

    // Fills every [league-label] on the page and applies the <title> of any view
    // that opted in with [data-league-title]. Runs on DOMContentLoaded; exposed
    // so a page that renders its header later can repaint.
    function paint(root) {
        var label = name();
        var nodes = (root || document).querySelectorAll('[league-label]');
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = label;
            nodes[i].hidden = !label;
        }
        var t = document.querySelector('title[data-league-title]');
        if (t) document.title = title(t.getAttribute('data-league-title'));
    }

    window.ccLeague = { code: code, name: name, title: title, paint: paint };

    document.addEventListener('DOMContentLoaded', function () { paint(); });
})();
