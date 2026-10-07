// Live-update motion for the scoreboard and the gamecast.
//
// Both pages refresh every 10 seconds by swapping in new markup, and a swap is
// silent: a touchdown turned 14 into 21 and nothing on screen said so. This
// file is what says so — the score ticks up and its row glows, a new play
// slides into the feed, a score gets a stamp over the field, a game going
// final settles instead of snapping.
//
// The rule every effect follows: motion marks a CHANGE the reader would
// otherwise have to spot for themselves. Nothing animates on first paint, on a
// filter or tab switch, or on a re-render that brought nothing new — those are
// the reader's own actions, not news.
//
// Everything here is skipped under prefers-reduced-motion. None of it carries
// information the page doesn't already show statically, so skipping it loses
// nothing.
//
// UMD so a spec can require the pure helpers directly (same as wp-chart.js).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccLiveMotion = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // ---- pure ----------------------------------------------------------

    // Which sides of which games scored between two scoreboard payloads, and
    // which games went final. Only games present in BOTH are compared: a game
    // that appears for the first time has no "before" to tick up from.
    //
    // A score that went DOWN is not reported. It happens — CFBD corrects a
    // mis-keyed score — and celebrating a correction as a score is wrong.
    function scoreChanges(prevGames, nextGames) {
        var before = {};
        (prevGames || []).forEach(function (g) { if (g && g.id != null) before[g.id] = g; });

        var scored = [];
        var finals = [];
        (nextGames || []).forEach(function (g) {
            var p = g && before[g.id];
            if (!p) return;
            ['away', 'home'].forEach(function (side) {
                var from = p[side] && p[side].points;
                var to = g[side] && g[side].points;
                if (typeof from === 'number' && typeof to === 'number' && to > from) {
                    scored.push({ id: g.id, side: side, from: from, to: to });
                }
            });
            if (p.state === 'live' && g.state === 'final') finals.push(g.id);
        });
        return { scored: scored, finals: finals };
    }

    // A play has no id in the shaped feed (modules/play-by-play.js), so it is
    // keyed by when it happened and what it said. Two plays share a key only if
    // they share a period, a clock AND their text — which is the same play.
    function playKey(p) {
        if (!p) return '';
        return [p.period, p.clock, p.playText || p.playType || ''].join('|');
    }

    // Plays in `plays` whose key isn't in `seen`. `seen` null means this is the
    // first look at the game, and everything on a first look is history, not
    // news — so nothing is fresh.
    //
    // A burst bigger than `cap` is also treated as history: that is a tab
    // coming back from the background, or a feed resyncing, and sliding twenty
    // rows in at once is noise rather than a signal.
    function freshPlays(seen, plays, cap) {
        if (!seen) return [];
        var out = [];
        (plays || []).forEach(function (p) {
            var k = playKey(p);
            if (!seen.has(k)) out.push(k);
        });
        return out.length > (cap == null ? 6 : cap) ? [] : out;
    }

    // The word for the stamp. CFBD's play types are long ("Passing Touchdown",
    // "Field Goal Good", "Interception Return Touchdown"); the stamp wants the
    // one word that matters. Order matters: a "Fumble Return Touchdown" is a
    // touchdown, and so is a two-point try's parent play.
    function stampLabel(playType) {
        var t = String(playType || '').toLowerCase();
        if (/touchdown/.test(t)) return 'Touchdown';
        if (/field goal/.test(t)) return 'Field Goal';
        if (/safety/.test(t)) return 'Safety';
        if (/two.?point|2pt|conversion/.test(t)) return 'Two Points';
        return 'Score';
    }

    // ---- DOM -----------------------------------------------------------

    function reduced() {
        return typeof window !== 'undefined' && window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    // The text node that holds `value`. Score cells carry more than the number
    // (the possession football, the winner caret), so writing textContent would
    // wipe those out.
    function numberNode(el, value) {
        var want = String(value);
        var walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
        var n;
        while ((n = walker.nextNode())) {
            if (n.nodeValue.trim() === want) return n;
        }
        return null;
    }

    // Tick a score up from `from` to `to`. Short — a score is two or three
    // steps, not a slot machine — and it always lands on the real number, so a
    // tab that throttles rAF mid-count still ends correct.
    function countTo(el, from, to, ms) {
        if (!el || reduced()) return;
        var node = numberNode(el, to);
        if (!node) return;
        var dur = ms || 600;
        var start = null;
        node.nodeValue = node.nodeValue.replace(String(to), String(from));
        requestAnimationFrame(function tick(now) {
            if (start == null) start = now;
            var t = Math.min((now - start) / dur, 1);
            var e = 1 - Math.pow(1 - t, 3);
            var cur = t < 1 ? Math.round(from + (to - from) * e) : to;
            node.nodeValue = node.nodeValue.replace(/\d+/, String(cur));
            if (t < 1) requestAnimationFrame(tick);
        });
    }

    // Restart a CSS animation class on an element, tinted with `color`. The
    // class is removed again when its animation ends so the element is clean
    // for the next one. Removing and re-adding in the same frame does nothing,
    // hence the forced reflow between them.
    function pulse(el, cls, color) {
        if (!el || reduced()) return;
        if (color) el.style.setProperty('--lm-color', color);
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        el.addEventListener('animationend', function done(e) {
            if (e.target !== el) return;
            el.classList.remove(cls);
            el.removeEventListener('animationend', done);
        });
    }

    // A one-word stamp laid over `host` (the field, or the scoreboard header
    // when there is no field). Decorative: the scoring play's own card says
    // the same thing in words, so screen readers are spared a duplicate.
    function stamp(host, label, color, delayMs) {
        if (!host || reduced()) return;
        var el = host.ownerDocument.createElement('div');
        el.className = 'lm-stamp';
        el.setAttribute('aria-hidden', 'true');
        if (color) el.style.setProperty('--lm-color', color);
        el.innerHTML = '<span class="lm-stamp-word"></span>';
        el.firstChild.textContent = label;
        setTimeout(function () {
            host.appendChild(el);
            el.addEventListener('animationend', function (e) {
                if (e.target === el) el.remove();
            });
        }, delayMs || 0);
    }

    return {
        scoreChanges: scoreChanges,
        playKey: playKey,
        freshPlays: freshPlays,
        stampLabel: stampLabel,
        reduced: reduced,
        countTo: countTo,
        pulse: pulse,
        stamp: stamp
    };
}));
