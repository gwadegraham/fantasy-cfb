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
    // keyed by where it sits: drive, period, clock, type and the score after
    // it. NOT by its text: CFBD rewrites play text after the fact (names,
    // yardage), and a reworded play would slide in and stamp a second time.
    // Two plays that collide here merely don't animate, which is harmless.
    function playKey(p) {
        if (!p) return '';
        return [p.driveIndex, p.period, p.clock, p.playType, p.awayScore, p.homeScore].join('|');
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

    // The word for the stamp, or null for no stamp. Only a play that DESCRIBES
    // a score gets one: its type ("Passing Touchdown", "Field Goal Good") or
    // its text ("... for a TD"; CFBD types plenty of touchdown passes as plain
    // "Pass Reception").
    //
    // The score change alone is not enough. CFBD stamps the new score on the
    // wrong row about once every two games: a sack, a kickoff, "End of 2nd
    // quarter", or a fumble out of bounds two plays before the touchdown.
    // Measured Oct 2026 across the 25 stored games: 13 of 251 scoring rows.
    // Stamping TOUCHDOWN over a fumble is worse than not stamping; the header
    // score still ticks either way.
    //
    // An extra point gets no stamp. It follows a touchdown that already had
    // one, often on a later fetch, and a second stamp for the kick is noise.
    function stampLabel(play) {
        var type = String((play && play.playType) || '').toLowerCase();
        var text = String((play && play.playText) || '');
        var say = type + ' ' + text.toLowerCase();
        if (/touchdown/.test(say) || /\bTD\b/.test(text)) return 'Touchdown';
        if (/field goal/.test(say)) return 'Field Goal';
        if (/safety/.test(say)) return 'Safety';
        if (/two.?point|2pt|conversion/.test(say)) return 'Two Points';
        return null;
    }

    // Which score, if any, a fetch should stamp. `plays` is the shaped feed in
    // order, `fresh` the keys that arrived on this fetch, `last` the previous
    // stamp ({ side, label, score }) or null. Returns the same shape, or null.
    //
    // The newest FRESH scoring play that describes its score wins. Scanning
    // stops at the first scoring play that isn't fresh: everything before it
    // is history the reader has already seen.
    //
    // The `last` check is for CFBD rewriting a row it already sent. A
    // touchdown first stored at 6 and revised to 7 when the kick is counted
    // gets a new key (the score is part of it), so it arrives "fresh" a second
    // time. Same side, same word, and the side's score moved by less than a
    // field goal since the last stamp means it's the same score being
    // corrected, not a new one.
    function pickStamp(plays, fresh, last) {
        var isFresh = {};
        (fresh || []).forEach(function (k) { isFresh[k] = true; });
        var list = plays || [];
        for (var i = list.length - 1; i >= 0; i--) {
            var p = list[i];
            if (!p || !p.scoring) continue;
            if (!isFresh[playKey(p)]) return null;
            var label = stampLabel(p);
            if (!label) continue;
            var side = p.scoringSide === 'home' || p.scoringSide === 'away' ? p.scoringSide : null;
            var score = side === 'home' ? p.homeScore : (side === 'away' ? p.awayScore : null);
            if (last && side && last.side === side && last.label === label
                && typeof score === 'number' && typeof last.score === 'number'
                && score >= last.score && score - last.score < 3) {
                return null;
            }
            return { play: p, label: label, side: side, score: score };
        }
        return null;
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
    // steps, not a slot machine. The real number is ALSO written by a timer:
    // rAF stops entirely in a hidden or occluded tab, and the count starts by
    // writing the OLD score, which would otherwise sit there until the tab
    // came back. Timers are throttled when hidden, not stopped.
    function countTo(el, from, to, ms) {
        if (!el || reduced()) return;
        var node = numberNode(el, to);
        if (!node) return;
        var dur = ms || 600;
        var start = null;
        var done = false;
        function land() {
            if (done) return;
            done = true;
            node.nodeValue = node.nodeValue.replace(/\d+/, String(to));
        }
        node.nodeValue = node.nodeValue.replace(String(to), String(from));
        requestAnimationFrame(function tick(now) {
            if (done) return;
            if (start == null) start = now;
            var t = Math.min((now - start) / dur, 1);
            if (t >= 1) { land(); return; }
            var e = 1 - Math.pow(1 - t, 3);
            node.nodeValue = node.nodeValue.replace(/\d+/, String(Math.round(from + (to - from) * e)));
            requestAnimationFrame(tick);
        });
        setTimeout(land, dur + 150);
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
        pickStamp: pickStamp,
        reduced: reduced,
        countTo: countTo,
        pulse: pulse,
        stamp: stamp
    };
}));
