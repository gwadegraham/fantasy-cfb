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
//   window.ccSportPage.readable(hex)                    a team colour that shows on the dark page
//   window.ccSportPage.matchColors(away, home)          two team colours a reader can tell apart
//   window.ccSportPage.countUp(root)                    [data-countup] numbers tick up (not if reduced motion)
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

    // ---- team colours -----------------------------------------------------

    function rgbOf(hex) {
        if (typeof hex !== 'string') return null;
        var m = hex.trim().replace('#', '');
        if (m.length === 3) m = m.split('').map(function (c) { return c + c; }).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
        return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
    }
    function hexOf(rgb) {
        return '#' + rgb.map(function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'); }).join('');
    }
    function luminance(rgb) {
        var a = rgb.map(function (v) {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    // A team colour that reads on the dark page: navy and black are eased
    // toward white until they clear a minimum luminance — football's rule
    // (team.js readableOnDark). Null for anything that is not a hex colour.
    function readable(hex) {
        var rgb = rgbOf(hex);
        if (!rgb) return null;
        for (var i = 0; i < 12 && luminance(rgb) < 0.22; i++) {
            rgb = rgb.map(function (v) { return v + (255 - v) * 0.18; });
        }
        return hexOf(rgb);
    }
    // Two colours side by side — away left, home right — have to be told
    // apart. When the two readable primaries are too close (two navies),
    // home switches to its alternate colour, then away to its; failing both,
    // home falls back to the neutral fill. Each side: { color, altColor }.
    var NEUTRAL = '#8A90A8';
    function distance(a, b) {
        var x = rgbOf(a), y = rgbOf(b);
        return Math.sqrt(Math.pow(x[0] - y[0], 2) + Math.pow(x[1] - y[1], 2) + Math.pow(x[2] - y[2], 2));
    }
    function matchColors(away, home) {
        var a = readable(away && away.color) || NEUTRAL;
        var h = readable(home && home.color) || NEUTRAL;
        var CLOSE = 90;
        if (distance(a, h) >= CLOSE) return { away: a, home: h };
        var hAlt = readable(home && home.altColor);
        if (hAlt && distance(a, hAlt) >= CLOSE) return { away: a, home: hAlt };
        var aAlt = readable(away && away.altColor);
        if (aAlt && distance(aAlt, h) >= CLOSE) return { away: aAlt, home: h };
        return { away: a, home: distance(a, NEUTRAL) >= CLOSE ? NEUTRAL : '#F4F6FB' };
    }

    // ---- motion -------------------------------------------------------------

    // [data-countup="12"] ticks up from 0 over ~0.85s, as football's season
    // score does. A reader who asked for reduced motion sees the number at
    // once. data-sign="+" keeps a leading plus on a positive number ("+12").
    function reducedMotion() {
        return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function countUp(root) {
        var els = root.querySelectorAll('[data-countup]');
        Array.prototype.forEach.call(els, function (el) {
            var to = Number(el.getAttribute('data-countup'));
            if (!isFinite(to)) return;
            var plus = el.getAttribute('data-sign') === '+';
            var show = function (v) { el.textContent = (plus && v > 0 ? '+' : '') + v; };
            // A hidden tab throttles animation frames to a crawl, so it just
            // shows the number.
            if (reducedMotion() || !global.requestAnimationFrame || global.document.hidden) { show(to); return; }
            var start = null, dur = 850;
            show(0);
            var step = function (ts) {
                if (start === null) start = ts;
                var p = Math.min(1, (ts - start) / dur);
                // The last frame shows the value itself, so 7.5 never ends as 8.
                if (p >= 1) { show(to); return; }
                show(Math.round(to * (1 - Math.pow(1 - p, 3))));
                global.requestAnimationFrame(step);
            };
            global.requestAnimationFrame(step);
        });
    }

    var api = { esc: esc, fixed: fixed, pct: pct, record: record, shortName: shortName, shortNames: shortNames,
        dayOf: dayOf, countdown: countdown, tabs: tabs, overflows: overflows, fitNames: fitNames, load: load,
        syncStickyTop: syncStickyTop, readable: readable, matchColors: matchColors, countUp: countUp };

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
