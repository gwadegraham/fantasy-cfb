// Shared player-name fitting for the Season Leaders cards (team view + game
// detail). Both cards give the name whatever width is left over after fixed
// stat columns, which is enough for a full name on desktop but not always on
// mobile. Rather than abbreviate everywhere — which needlessly shortens names
// that would have fit — each name is measured against its own column and only
// the ones that would clip are shortened.
(function (global) {
    'use strict';

    // "Thomas Castellanos" -> "T. Castellanos". Keeps any suffix ("Earl Little II").
    function abbreviateName(full) {
        var parts = String(full).trim().split(/\s+/);
        if (parts.length < 2) return full;
        return parts[0].charAt(0) + '. ' + parts.slice(1).join(' ');
    }

    function surnameOnly(full) {
        var parts = String(full).trim().split(/\s+/);
        return parts.length < 2 ? full : parts.slice(1).join(' ');
    }

    // Does the text inside el need more room than el actually has?
    //
    // Measured fractionally on purpose. scrollWidth/clientWidth round to whole
    // pixels, which hides sub-pixel overflow — "Thomas Castellanos" needed
    // 125.52px in a 124.65px box (0.87px over, so the browser drew an ellipsis)
    // but reported scrollWidth 126 / clientWidth 125 and looked like a fit.
    function textOverflows(el) {
        var range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width - el.getBoundingClientRect().width > 0.1;
    }

    // Shorten only the names that don't fit, stepping full -> "F. Last" -> "Last".
    // The full name is kept in data-full-name (and the title tooltip) so every
    // pass re-measures from it — that way widening the viewport restores the
    // full name instead of the abbreviation ratcheting down permanently.
    function fitNames(selector, root) {
        var scope = root || document;
        var names = scope.querySelectorAll(selector);
        for (var i = 0; i < names.length; i++) {
            var el = names[i];
            var full = el.dataset.fullName || el.textContent.trim();

            // Placeholders (e.g. the "—" shown when a team has no stats yet)
            // aren't names — leave them alone.
            if (!full || full === '—') continue;

            el.dataset.fullName = full;
            el.title = full;

            el.textContent = full;
            if (!textOverflows(el)) continue;

            el.textContent = abbreviateName(full);
            if (textOverflows(el)) {
                // Still tight — drop to the surname and let ellipsis take over.
                el.textContent = surnameOnly(full);
            }
        }
    }

    // Re-fit on resize, and once webfonts land (text widths shift when Poppins
    // swaps in over the fallback). Listeners attach once per selector.
    var watched = {};
    function watchNameFit(selector, root) {
        if (watched[selector]) return;
        watched[selector] = true;

        var t;
        global.addEventListener('resize', function () {
            clearTimeout(t);
            t = setTimeout(function () { fitNames(selector, root); }, 120);
        });

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () { fitNames(selector, root); });
        }
    }

    global.ccFitNames = fitNames;
    global.ccWatchNameFit = watchNameFit;
})(window);
