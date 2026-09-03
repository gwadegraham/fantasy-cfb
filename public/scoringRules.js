// Keep the Scoring Rules page in step with the app-wide league selection. The
// page is server-rendered from ?league= (Admins only, gated) or the caller's
// own league; #scoring-league carries whichever league the server used.
window.onload = function () {
    var el = document.getElementById('scoring-league');
    var rendered = el && el.getAttribute('data-code');
    if (!rendered) return;

    var roles = (userState && userState.user_metadata && userState.user_metadata.roles) || [];
    var isAdmin = roles.indexOf('Admin') !== -1;
    var hasParam = /[?&]league=/.test(window.location.search);
    var stored = window.localStorage.getItem('leagueCode');

    // Admin who selected another league elsewhere but reached /rules with no
    // ?league=: jump to that league so Scoring matches the rest of the app.
    // Guarded (a valid, switchable league that differs from what rendered) so it
    // cannot loop — after the redirect the URL carries ?league=, and the server
    // renders that same league for an Admin.
    if (isAdmin && !hasParam && stored && stored !== rendered
        && document.querySelector('[league-select] option[value="' + stored + '"]')) {
        window.location.replace('/rules?league=' + encodeURIComponent(stored));
        return;
    }

    // Otherwise reflect the rendered league in the dropdown label + sticky
    // storage, so the label always matches the rules shown.
    window.localStorage.setItem('leagueCode', rendered);
    var _lSel = document.querySelector('[league-select]');
    if (_lSel) {
        _lSel.value = rendered;
        var opt = _lSel.options[_lSel.selectedIndex];
        if (opt) window.sessionStorage.setItem('league', opt.text);
    }
};

// Picking a league navigates to that league's rules via the server param (the
// page is server-rendered, so a plain reload wouldn't switch it).
setTimeout(function () {
    var _lSel = document.querySelector('[league-select]');
    if (_lSel) {
        _lSel.addEventListener('change', function () {
            var opt = this.options[this.selectedIndex];
            window.sessionStorage.setItem('league', opt.text);
            window.localStorage.setItem('leagueCode', opt.value);
            window.location.href = '/rules?league=' + encodeURIComponent(opt.value);
        });
    }
}, 200);


// The navbar owns the "My team" link + userId caching (views/partials/navbar.ejs).