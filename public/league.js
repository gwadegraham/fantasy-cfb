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
    //      pin it on <body>) — that can carry an Admin's ?league=, which the
    //      cookie knows nothing about,
    //   2. the server's answer.
    //
    // THERE IS NO LONGER A STEP 3. An Admin's sticky localStorage.leagueCode
    // used to sit between them, because before #319 the server could not know
    // which league an Admin had picked — the switcher wrote localStorage and
    // reloaded, and the server rendered the Admin's own league regardless. The
    // sticky read was how the client patched that up.
    //
    // The server knows now: SEED.code is the validated cookie. Keeping the
    // override would leave the two able to disagree in the OTHER direction,
    // which is the same bug with the arrow reversed. Seen in dev: a cookie of
    // hoops-league rendered the basketball accent and favicon server-side
    // while every league label on the page still read "The Polar Depressed",
    // because a stale localStorage from before the cookie existed won.
    //
    // localStorage.leagueCode is still WRITTEN, because several pages fetch
    // by it directly — it is a mirror of the choice now, not a source of it.
    function code() {
        var pinned = document.body && document.body.getAttribute('data-league-code');
        if (pinned) return pinned;
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

    // Points the navbar switcher at the league the page is actually showing.
    //
    // The <option> list is rendered in LEAGUES order with no `selected`, so with
    // nothing else done a browser lands on the first one — Claunts. That is only
    // ever right by accident: code() may resolve to the viewer's own league or to
    // a server-pinned one, and an Admin on a fresh browser was shown "Claunts"
    // above a page full of Graham League data, with no way back except selecting
    // their own league and then re-selecting Claunts.
    //
    // Every page already wires a `change` handler to this element, but only four
    // of them ever set its value, and those read localStorage directly rather
    // than asking code() — so they miss the pinned and first-visit cases. This is
    // the one place that knows the answer, so it is the one place that sets it.
    function syncSwitcher(root) {
        var sel = (root || document).querySelector('[league-select]');
        if (!sel) return;                       // not an Admin, or no switcher here
        var want = code();
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === want) { sel.value = want; return; }
        }
        // A league that isn't in the list: leave whatever is there rather than
        // silently pointing the switcher at someone else's league.
    }

    // Fills every [league-label] on the page, points the navbar switcher at the
    // right league, and applies the <title> of any view that opted in with
    // [data-league-title]. Runs on DOMContentLoaded; exposed so a page that
    // renders its header later can repaint.
    function paint(root) {
        var label = name();
        syncSwitcher(root);
        // A page that renders its navbar late calls paint(); without this it
        // would get a correctly-populated dropdown that does nothing. Binding
        // is idempotent, so calling it twice is free.
        bindSwitcher();
        var nodes = (root || document).querySelectorAll('[league-label]');
        for (var i = 0; i < nodes.length; i++) {
            nodes[i].textContent = label;
            nodes[i].hidden = !label;
        }
        var t = document.querySelector('title[data-league-title]');
        if (t) document.title = title(t.getAttribute('data-league-title'));
    }

    // Switching league. BOUND ONCE, HERE.
    //
    // Eight pages each carried their own copy of this handler, and every copy
    // did the same thing: write localStorage and reload. The server never saw
    // any of it — so a server-rendered page kept showing the viewer's own
    // league however the dropdown looked, which is exactly the bug #319 is
    // about. Telling the server is one POST, and doing it in eight places
    // meant eight chances to forget.
    //
    // localStorage is still written, because the client helpers above read it
    // and several pages fetch by league code. The cookie is what the SERVER
    // reads, and it is the authority on the next render.
    function bindSwitcher() {
        var sel = document.querySelector('[league-select]');
        if (!sel || sel.dataset.ccBound) return;
        sel.dataset.ccBound = '1';
        sel.addEventListener('change', async function () {
            var opt = this.options[this.selectedIndex];
            if (!opt) return;
            // A refusal means it is not one of your leagues — put the
            // dropdown back rather than reloading into the same page and
            // looking like nothing happened.
            var ok = await selectLeague(opt.value, opt.text);
            if (!ok) syncSwitcher();
        });
    }

    // Switching from the phone tab bar (#319 part 2).
    //
    // Shares selectLeague with the <select>, so the POST, the localStorage
    // mirror and the reload happen in exactly one place — eight copies of
    // this handler is the thing part 2 was cleaning up, and adding a second
    // surface is how a ninth gets written.
    function selectLeague(codeWanted, label) {
        return fetch('/league/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ league: codeWanted })
        }).then(function (res) {
            if (!res.ok) return false;
            return true;
        }).catch(function () {
            // Offline: the local choice still applies to client-side reads.
            return true;
        }).then(function (ok) {
            if (!ok) return false;
            try {
                if (label) window.sessionStorage.setItem('league', label);
                window.localStorage.setItem('leagueCode', codeWanted);
            } catch (e) { /* private window */ }
            window.location.reload();
            return true;
        });
    }

    function sheet() { return document.querySelector('[data-league-sheet-panel]'); }

    function openSheet(open) {
        var el = sheet();
        if (!el) return;
        el.hidden = !open;
        document.body.classList.toggle('league-sheet-open', open);
        var btn = document.querySelector('[data-league-sheet]');
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    // One delegated listener on the document, so the tab and every sheet row
    // are covered whether or not the bar was rendered by the time this ran.
    function bindTab() {
        if (document.documentElement.dataset.ccLeagueTab) return;
        document.documentElement.dataset.ccLeagueTab = '1';

        document.addEventListener('click', function (e) {
            var go = e.target.closest && e.target.closest('[data-league-go]');
            if (go) {
                e.preventDefault();
                var wanted = go.getAttribute('data-league-go');
                if (wanted === code()) { openSheet(false); return; }
                var row = go.querySelector('span');
                selectLeague(wanted, row ? row.textContent : null);
                return;
            }
            if (e.target.closest && e.target.closest('[data-league-sheet]')) {
                e.preventDefault();
                openSheet(sheet() ? sheet().hidden : false);
                return;
            }
            if (e.target.closest && e.target.closest('[data-league-sheet-close]')) {
                openSheet(false);
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') openSheet(false);
        });
    }

    // The league a PAGE should load data for. Exported as a bare global as
    // well as on ccLeague, because the pages that need it are plain scripts
    // that run before any module wiring.
    //
    // Every one of them used to re-derive this from the Auth0 flag —
    // `metadata.league == 'gg' ? 'graham-league' : 'claunts-league'` — in
    // eleven places across seven files, honouring the stored choice only for
    // an Admin. Two consequences: a member who switched league got new chrome
    // and the OLD league's data, and no member could ever load a basketball
    // league at all, the flag having exactly two values.
    window.ccLeagueCode = function () {
        var c = code();
        if (c) return c;
        // Only reached on a page rendered without the navbar seed.
        try {
            var meta = window.userState && window.userState.user_metadata
                && window.userState.user_metadata.metadata;
            if (meta && meta.league) return meta.league === 'gg' ? 'graham-league' : 'claunts-league';
        } catch (e) { /* fall through */ }
        return '';
    };

    window.ccLeague = { code: code, name: name, title: title, paint: paint, syncSwitcher: syncSwitcher, bindSwitcher: bindSwitcher, selectLeague: selectLeague };

    document.addEventListener('DOMContentLoaded', function () { paint(); bindSwitcher(); bindTab(); });
})();
