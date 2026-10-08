// The shared kit for the sport pages (#506): the helpers every team and
// game page needs, written once. Paired with sport-page.css.
//
//   window.ccSportPage.esc / fixed / pct / record      formatting
//   window.ccSportPage.shortName / shortNames           "C. Boozer", collision-safe
//   window.ccSportPage.numbered(player, label)          "#2 C. Boozer", or the label alone
//   window.ccSportPage.dayOf / countdown                dates via ccKickoff
//   window.ccSportPage.tabs(list, active)               sticky tab bar markup
//   window.ccSportPage.fitNames(root, selector)         full name, or abbr if it clips
//   window.ccSportPage.load(url, render, root, noun)    fetch → render, or an error state
//   window.ccSportPage.overflows(el)                    does a name clip (sub-pixel)
//   window.ccSportPage.syncStickyTop()                  re-measure the navbar offset
//
// It also pins the sticky tabs under the navbar (--sp-sticky-top), measured.
// Works in the browser and under Node (module.exports) for tests.

(function (global) {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fixed(n, d) { return n == null || !isFinite(n) ? '—' : Number(n).toFixed(d); }
    function pct(p) { return Math.round(p * 100); }
    // "12–3" from a list of games carrying us/them.
    function record(list) {
        var w = list.filter(function (g) { return g.us > g.them; }).length;
        return w + '–' + (list.length - w);
    }

    // "Cameron Boozer" → "C. Boozer".
    function shortName(name) {
        var p = String(name || '').trim().split(/\s+/);
        return p.length > 1 ? p[0].charAt(0) + '. ' + p.slice(1).join(' ') : name;
    }
    // Short names for a whole roster — unless two players shorten to the
    // same thing (Duke had Cameron and Cayden Boozer), in which case both
    // keep their full names. Keyed by full name.
    function shortNames(players) {
        var count = {};
        players.forEach(function (p) { var s = shortName(p.name); count[s] = (count[s] || 0) + 1; });
        var out = {};
        players.forEach(function (p) { var s = shortName(p.name); out[p.name] = count[s] > 1 ? p.name : s; });
        return out;
    }
    // A player's label with their jersey in front — "#2 C. Boozer". A player
    // with no number on file is just the label. Not escaped: callers esc() it.
    function numbered(p, label) {
        var j = p && p.jersey != null ? String(p.jersey).trim() : '';
        if (label == null) label = '';
        return j && label ? '#' + j + ' ' + label : label;
    }

    // "Nov 14" — the game's day as the app shows days (ccKickoff handles a
    // TBD tip's midnight-Eastern placeholder).
    function dayOf(g) {
        var k = global.ccKickoff;
        if (k && k.parts) {
            var p = k.parts(g.startDate, g.startTimeTbd);
            if (p) return p.monthShort + ' ' + p.day;
        }
        var d = new Date(g.startDate);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // When a game still to play starts, said the way people say it: "Tonight
    // · 9:00 PM", "Tomorrow · 7:00 PM", "Sat, Nov 12 · 7:00 PM". A TBD start
    // keeps its day and says the time is TBD. Past the start with no result
    // yet, it says so rather than counting down to the past.
    function countdown(g, now) {
        var k = global.ccKickoff;
        var p = k && k.parts ? k.parts(g.startDate, g.startTimeTbd) : null;
        if (!p) return 'Upcoming';
        var time = p.tbd ? 'time TBD' : k.time(g.startDate, g.startTimeTbd, 'spaced');
        var start = new Date(g.startDate).getTime();
        now = now == null ? Date.now() : now;
        if (!p.tbd && now >= start) return 'Awaiting the result';
        var key = function (t) { return k.dayKey ? k.dayKey(new Date(t).toISOString(), false) : new Date(t).toDateString(); };
        var day = k.dayKey ? k.dayKey(g.startDate, g.startTimeTbd) : new Date(start).toDateString();
        if (day === key(now)) return 'Tonight · ' + time;
        if (day === key(now + 24 * 60 * 60 * 1000)) return 'Tomorrow · ' + time;
        return p.weekdayLong.slice(0, 3) + ', ' + p.monthShort + ' ' + p.day + ' · ' + time;
    }

    // list: [[key, label], …]. Buttons carry data-tab; the page owns the click.
    function tabs(list, active) {
        return '<nav class="sp-tabs" role="tablist">' + list.map(function (t) {
            return '<button type="button" role="tab" data-tab="' + esc(t[0]) + '" class="sp-tab' + (active === t[0] ? ' on' : '') + '"'
                + ' aria-selected="' + (active === t[0]) + '">' + esc(t[1]) + '</button>';
        }).join('') + '</nav>';
    }

    // A name that would be cut off becomes its abbreviation — "Michigan St…"
    // reads worse than "MSU". Each element carries the full name in `title`
    // and the short one in `data-abbr`; measured against the room its PARENT
    // has, and re-run from the full name each time so widening the screen
    // restores it. Fractional, like fit-names.js: whole-pixel scrollWidth
    // hides the sub-pixel overflow that still draws an ellipsis.
    function overflows(el) {
        var range = global.document.createRange && global.document.createRange();
        if (!range || typeof range.getBoundingClientRect !== 'function') {
            return el.scrollWidth > el.clientWidth;     // whole pixels, but never a crash
        }
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width - el.getBoundingClientRect().width > 0.1;
    }
    function fitNames(root, selector) {
        var names = root.querySelectorAll(selector);
        for (var i = 0; i < names.length; i++) {
            var n = names[i];
            n.textContent = n.getAttribute('title');
            if (overflows(n.parentNode)) n.textContent = n.getAttribute('data-abbr');
        }
    }

    // Fetch a page payload and hand it to render; any failure — network, a
    // non-2xx, a body that is not JSON — becomes the page's error state.
    function load(url, render, root, noun) {
        return global.fetch(url, { headers: { Accept: 'application/json' } })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (body) {
                    if (!r.ok) throw new Error(body.message || ('Could not load this ' + noun + ' (' + r.status + ')'));
                    return body;
                });
            })
            .then(render)
            .catch(function (e) { root.innerHTML = '<div class="sp-error">' + esc(e.message) + '</div>'; });
    }

    // The tabs pin just under the navbar, which is itself sticky — so the
    // offset is the navbar's height, measured, the way the Scoreboard does
    // it. Re-measured when the webfont swaps in, which changes that height.
    function syncStickyTop() {
        var nav = global.document.getElementById('navbar');
        var h = nav ? Math.floor(nav.getBoundingClientRect().height) : 0;
        global.document.documentElement.style.setProperty('--sp-sticky-top', h + 'px');
    }

    var api = { esc: esc, fixed: fixed, pct: pct, record: record, shortName: shortName, shortNames: shortNames,
        dayOf: dayOf, countdown: countdown, tabs: tabs, overflows: overflows, fitNames: fitNames, load: load,
        syncStickyTop: syncStickyTop };

    api.numbered = numbered;

    if (global.document) {
        syncStickyTop();
        global.addEventListener('resize', syncStickyTop);
        var fonts = global.document.fonts;
        if (fonts && fonts.ready && fonts.ready.then) fonts.ready.then(syncStickyTop).catch(function () {});
    }
    global.ccSportPage = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
