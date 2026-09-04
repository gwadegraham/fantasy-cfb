// Live win-probability chart for the game detail page.
//
// Draws game.wpSnapshots — the series the scoreboard poller accumulates while a
// game is in progress (see modules/scoreboard.js). The card replaces the
// Matchup Predictor at kickoff: same slot, same probability readout underneath,
// but the football field gives way to the curve the game has actually traced.
//
// WHAT THIS DELIBERATELY DOES NOT DO: claim that a play caused a swing. An
// earlier design named the biggest move on the chart and captioned it with the
// play from that snapshot — but lastPlay is only "the last play CFBD had
// reported when we sampled", and at a 2-minute cadence the play that actually
// caused a swing is often one we never saw. So the scrubber reports the game
// STATE at a sample (clock, score, down & distance, last play) and asserts
// nothing about cause. The score sits next to the play, which lets a reader draw
// the connection themselves where one genuinely exists.
//
// COLOUR MEANS ONE THING: who is ahead. The line is cut at the 50% mark and each
// run drawn in the leading team's colour, so a game the away team won reads as
// theirs. Drawing the whole line in the home team's colour — which is what the
// y-axis is measured in — spends the most noticeable channel on a technical
// detail and leaves a chart that looks like the home team won it.
//
// UMD so a spec can require the pure builders directly (same as logo.js).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccWpChart = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var QUARTER = 900;              // seconds in a regulation quarter
    var PREGAME_LEAD = 60;          // where the pregame anchor sits, left of kickoff
    var REGULATION = 4 * QUARTER;

    // Drawing box, in viewBox units. The <svg> is width:100% so these are
    // arbitrary units, not pixels — only their ratios matter.
    var W = 340, H = 132;
    var PADL = 20, PADR = 8, TOP = 10, BOT = 116;
    var MID = (TOP + BOT) / 2;

    // A swing worth marking, and the most dots we'll draw. These control which
    // points get a visible target to aim at; they say nothing about causation.
    var SWING = 0.05;
    var MAX_DOTS = 8;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // "7:42" -> 462. Anything else -> null; CFBD sends null clocks between
    // periods and on games that haven't started.
    function clockSeconds(clock) {
        var m = /^(\d{1,3}):([0-5]\d)$/.exec(String(clock == null ? '' : clock).trim());
        if (!m) return null;
        return Number(m[1]) * 60 + Number(m[2]);
    }

    // Elapsed game time in seconds. The x-axis has to be game clock, not wall
    // clock: sampling every 2 real minutes over-samples a stoppage-heavy 4th
    // quarter and would stretch halftime into a flat plateau that never happened.
    // Overtime periods just keep counting past 3600, which extends the domain
    // rather than piling up on the right edge.
    function gameSeconds(period, clock) {
        var p = Number(period);
        if (!p || p < 1) return null;
        var remaining = clockSeconds(clock);
        if (remaining == null) return null;
        return (p - 1) * QUARTER + (QUARTER - Math.min(QUARTER, remaining));
    }

    // Snapshots -> plottable points, with the pregame anchor on the front.
    //
    // pregameWinProb is the one point the live strip never shows, and without it
    // the curve starts wherever the first poll happened to land — which reads as
    // if the game began there.
    function buildSeries(game) {
        var g = game || {};
        var snaps = Array.isArray(g.wpSnapshots) ? g.wpSnapshots : [];
        var out = [];

        if (g.pregameWinProb != null) {
            // Negative on purpose: the pregame number belongs BEFORE kickoff. At
            // t=0 it lands exactly on a first-quarter 15:00 snapshot, and the two
            // points stack at the same x — the kickoff sample then can't be
            // scrubbed to at all, because the anchor is always found first.
            out.push({
                t: -PREGAME_LEAD, wp: g.pregameWinProb, anchor: true,
                period: null, clock: null, homePoints: null, awayPoints: null,
                situation: null, lastPlay: null
            });
        }

        var prev = out.length ? out[0].t : -Infinity;
        for (var i = 0; i < snaps.length; i++) {
            var s = snaps[i];
            if (!s || s.homeWinProb == null) continue;
            // A missing or backwards clock (a stuck period, a mid-period null)
            // must not fold the curve back on itself, so time only ever advances.
            var t = gameSeconds(s.period, s.clock);
            if (t == null || t < prev) t = prev + 60;
            prev = t;
            out.push({
                t: t, wp: s.homeWinProb, anchor: false,
                period: s.period == null ? null : Number(s.period),
                clock: s.clock == null ? null : String(s.clock),
                homePoints: s.homePoints == null ? null : Number(s.homePoints),
                awayPoints: s.awayPoints == null ? null : Number(s.awayPoints),
                situation: s.situation || null,
                lastPlay: s.lastPlay || null
            });
        }
        return out;
    }

    // Points that moved most against the sample before them. Purely descriptive
    // — "the line moved here" is a property of our own series — and they double
    // as targets big enough to hit with a thumb.
    function swingDots(points) {
        var cands = [];
        for (var i = 1; i < points.length; i++) {
            var d = points[i].wp - points[i - 1].wp;
            if (Math.abs(d) >= SWING) cands.push({ i: i, d: d });
        }
        cands.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });

        var kept = [];
        for (var k = 0; k < cands.length && kept.length < MAX_DOTS; k++) {
            var c = cands[k];
            var crowded = false;
            for (var j = 0; j < kept.length; j++) {
                if (Math.abs(kept[j].i - c.i) < 2) { crowded = true; break; }
            }
            if (!crowded) kept.push(c);
        }
        kept.sort(function (a, b) { return a.i - b.i; });
        return kept;
    }

    // Split the curve where it crosses 50%, inserting the crossing point itself
    // so the two runs meet exactly on the midline.
    //
    // This is what lets color mean "who is ahead" rather than "whose axis this
    // is". A single-color line spends the most noticeable channel on a
    // technical detail: a game the away team won still renders entirely in the
    // home team's color, which reads as though the home team won it.
    function splitAtMidline(points, midY) {
        if (!points.length) return [];
        var runs = [];
        var cur = { home: points[0].wp >= 0.5, pts: [points[0]] };

        for (var i = 1; i < points.length; i++) {
            var prev = points[i - 1];
            var p = points[i];
            var home = p.wp >= 0.5;

            if (home === cur.home) {
                cur.pts.push(p);
                continue;
            }
            // Straddles the midline: cut there and start the other run from the
            // same point, so there is no gap and no overshoot.
            var f = (0.5 - prev.wp) / (p.wp - prev.wp);
            var cross = { x: prev.x + (p.x - prev.x) * f, y: midY, wp: 0.5 };
            cur.pts.push(cross);
            runs.push(cur);
            cur = { home: home, pts: [cross, p] };
        }
        runs.push(cur);
        return runs;
    }

    // Everything the SVG and the scrubber need. Null when there isn't enough of
    // a series to draw a line.
    function buildModel(game) {
        var series = buildSeries(game);
        if (series.length < 2) return null;

        var span = Math.max(REGULATION, series[series.length - 1].t) || REGULATION;
        var start = series[0].t;
        var innerW = W - PADL - PADR;
        var xAt = function (t) { return PADL + ((t - start) / (span - start)) * innerW; };
        var yAt = function (wp) { return BOT - Math.max(0, Math.min(1, wp)) * (BOT - TOP); };

        var points = series.map(function (p, i) {
            return {
                i: i, x: xAt(p.t), y: yAt(p.wp), t: p.t, wp: p.wp, anchor: p.anchor,
                period: p.period, clock: p.clock,
                homePoints: p.homePoints, awayPoints: p.awayPoints,
                situation: p.situation, lastPlay: p.lastPlay
            };
        });

        // Period boundaries that the game actually reached, plus a label centred
        // in each segment. OT only appears once the game got there.
        var bounds = [0];
        for (var b = QUARTER; b < span; b += QUARTER) bounds.push(b);
        bounds.push(span);

        var names = ['1st', '2nd', '3rd', '4th'];
        var segments = [];
        for (var s = 0; s < bounds.length - 1; s++) {
            var label = s < names.length ? names[s] : (bounds.length - 1 - names.length > 1 ? 'OT' + (s - names.length + 1) : 'OT');
            segments.push({ label: label, x: xAt((bounds[s] + bounds[s + 1]) / 2) });
        }

        return {
            points: points,
            runs: splitAtMidline(points, MID),
            dots: swingDots(points),
            dividers: bounds.slice(1, -1).map(xAt),
            segments: segments,
            span: span,
            box: { W: W, H: H, PADL: PADL, PADR: PADR, TOP: TOP, BOT: BOT, MID: MID }
        };
    }

    // Which sample a pointer at viewBox-x `px` refers to.
    //
    // Snaps to the LATER of the two samples a position falls between. A swing is
    // drawn as the segment between two points, and it is the later one whose
    // lastPlay and score explain the move — snapping backwards would caption the
    // drop with the play that came before it.
    function indexAt(model, px) {
        var pts = model.points;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i].x >= px) return i;
        }
        return pts.length - 1;
    }

    function pct(wp) { return (wp * 100).toFixed(1) + '%'; }

    // The scrubber line. Says when, what the score was, and what had just
    // happened — no more than the snapshot actually recorded.
    function readoutHtml(pt, ctx) {
        var c = ctx || {};
        var home = c.homeAbbr || c.homeTeam || 'Home';
        var away = c.awayAbbr || c.awayTeam || 'Away';

        if (pt.anchor) {
            return '<span class="gd-wp-when">Pregame</span>'
                 + '<span class="gd-wp-wp">' + esc(home) + ' ' + pct(pt.wp) + '</span>'
                 + '<span class="gd-wp-hint">Drag across the chart to read the game back</span>';
        }

        var when = [];
        if (pt.period != null) when.push('Q' + pt.period);
        if (pt.clock) when.push(pt.clock);

        var score = '';
        if (pt.awayPoints != null && pt.homePoints != null) {
            score = '<span class="gd-wp-score">' + esc(away) + ' ' + pt.awayPoints
                  + ' – ' + pt.homePoints + ' ' + esc(home) + '</span>';
        }

        var html = '';
        if (when.length) html += '<span class="gd-wp-when">' + esc(when.join(' · ')) + '</span>';
        html += score;
        html += '<span class="gd-wp-wp">' + esc(home) + ' ' + pct(pt.wp) + '</span>';
        if (pt.situation) html += '<span class="gd-wp-situation">' + esc(pt.situation) + '</span>';
        if (pt.lastPlay) html += '<span class="gd-wp-play">' + esc(pt.lastPlay) + '</span>';
        return html;
    }

    function path(points) {
        var d = '';
        for (var i = 0; i < points.length; i++) {
            d += (i ? 'L' : 'M') + points[i].x.toFixed(2) + ' ' + points[i].y.toFixed(2) + ' ';
        }
        return d.trim();
    }

    function svgHtml(model, ctx) {
        var c = ctx || {};
        var box = model.box;
        var pts = model.points;
        var last = pts[pts.length - 1];
        var homeColor = c.homeColor || 'var(--cc-interactive)';
        var awayColor = c.awayColor || 'var(--cc-accent)';

        var grid = '';
        model.dividers.forEach(function (x) {
            grid += '<line x1="' + x.toFixed(2) + '" y1="' + box.TOP + '" x2="' + x.toFixed(2)
                 +  '" y2="' + box.BOT + '" class="gd-wp-divider" />';
        });
        model.segments.forEach(function (seg) {
            grid += '<text x="' + seg.x.toFixed(2) + '" y="' + (box.BOT + 12)
                 +  '" class="gd-wp-qlab" text-anchor="middle">' + esc(seg.label) + '</text>';
        });

        // One colour meaning on the whole chart: who is ahead. The dots mark
        // where the line moved most and double as touch targets — coloring them
        // by the DIRECTION of the move instead would put a second, competing
        // colour semantic on top of the first.
        var sideColor = function (wp) { return wp >= 0.5 ? homeColor : awayColor; };

        var line = model.runs.map(function (run) {
            return '<path d="' + path(run.pts) + '" fill="none" stroke="'
                 + (run.home ? homeColor : awayColor) + '" stroke-width="1.8"'
                 + ' stroke-linejoin="round" stroke-linecap="round" class="gd-wp-line" />';
        }).join('');

        var dots = model.dots.map(function (d) {
            var p = pts[d.i];
            return '<circle cx="' + p.x.toFixed(2) + '" cy="' + p.y.toFixed(2) + '" r="3"'
                 + ' fill="' + sideColor(p.wp) + '" class="gd-wp-dot" />';
        }).join('');

        var label = c.homeTeam
            ? c.homeTeam + ' win probability through the game so far, currently ' + pct(last.wp)
            : 'Win probability through the game so far';

        return '<svg viewBox="0 0 ' + box.W + ' ' + box.H + '" class="gd-wp-svg" role="img" aria-label="' + esc(label) + '">'
             +   grid
             +   '<line x1="' + box.PADL + '" y1="' + box.MID + '" x2="' + (box.W - box.PADR)
             +     '" y2="' + box.MID + '" class="gd-wp-mid" />'
             +   line
             +   dots
             +   '<circle cx="' + last.x.toFixed(2) + '" cy="' + last.y.toFixed(2) + '" r="3.6"'
             +     ' fill="' + sideColor(last.wp) + '" class="gd-wp-now" />'
             +   '<line class="gd-wp-cursor" x1="0" y1="' + box.TOP + '" x2="0" y2="' + box.BOT + '" hidden />'
             +   '<circle class="gd-wp-pin" cx="0" cy="0" r="4.2" fill="' + sideColor(last.wp) + '" hidden />'
             // Both ends of the axis read "100", so the numbers alone don't say
             // whose certainty each end is. Tinting them to the team colors
             // answers that without spending the width an abbreviation needs.
             +   '<text x="' + (box.PADL - 4) + '" y="' + (box.TOP + 4) + '" class="gd-wp-axlab" fill="' + homeColor + '" text-anchor="end">100</text>'
             +   '<text x="' + (box.PADL - 4) + '" y="' + (box.MID + 3) + '" class="gd-wp-axlab" text-anchor="end">50</text>'
             +   '<text x="' + (box.PADL - 4) + '" y="' + (box.BOT + 2) + '" class="gd-wp-axlab" fill="' + awayColor + '" text-anchor="end">100</text>'
             + '</svg>';
    }

    // The card. Returns '' when there is no series yet — a game that just kicked
    // off has one snapshot at most, and the caller falls back to the predictor.
    function render(game, ctx) {
        var model = buildModel(game);
        if (!model) return '';

        var c = ctx || {};
        var pts = model.points;
        var live = pts[pts.length - 1];
        var homeWP = live.wp * 100;
        var awayWP = 100 - homeWP;

        var html = '<div class="gd-section gd-wp">';
        html += '<h3 class="gd-section-title">Win Probability</h3>';
        html += '<div class="gd-wp-plot" tabindex="0" role="slider"'
             +  ' aria-label="Scrub the win probability chart"'
             +  ' aria-valuemin="0" aria-valuemax="' + (pts.length - 1) + '" aria-valuenow="0">';
        html += svgHtml(model, c);
        html += '</div>';

        // Same readout the Matchup Predictor used, so the card keeps its shape
        // when the field is swapped out for the chart.
        html += '<div class="gd-field-probs">';
        html += '<div class="gd-field-prob">';
        if (c.awayLogo) html += '<img src="' + esc(c.awayLogo) + '" alt="" />';
        html += '<div><div class="gd-field-pct">' + awayWP.toFixed(1) + '%</div>';
        html += '<div class="gd-field-name">' + esc(c.awayTeam || '') + '</div></div>';
        html += '</div>';
        html += '<div class="gd-field-prob gd-field-prob-right">';
        html += '<div><div class="gd-field-pct">' + homeWP.toFixed(1) + '%</div>';
        html += '<div class="gd-field-name">' + esc(c.homeTeam || '') + '</div></div>';
        if (c.homeLogo) html += '<img src="' + esc(c.homeLogo) + '" alt="" />';
        html += '</div>';
        html += '</div>';

        html += '<div class="gd-wp-readout" aria-live="polite">' + readoutHtml(pts[0], c) + '</div>';
        html += '</div>';

        state = { model: model, ctx: c };
        return html;
    }

    // Last rendered chart, handed from render() to attach(). The page re-renders
    // itself wholesale every 30 seconds, so the pin is kept here too — indices
    // are stable from the front as snapshots append, so a pinned moment survives
    // the refresh instead of snapping back to rest under the reader.
    var state = null;
    var pinned = null;

    function attach(root) {
        if (!state) return;
        var scope = root || document;
        var plot = scope.querySelector('.gd-wp-plot');
        if (!plot) return;

        var svg = plot.querySelector('.gd-wp-svg');
        var cursor = plot.querySelector('.gd-wp-cursor');
        var pin = plot.querySelector('.gd-wp-pin');
        var readout = scope.querySelector('.gd-wp-readout');
        if (!svg || !cursor || !pin || !readout) return;

        var model = state.model;
        var ctx = state.ctx;
        var pts = model.points;
        var homeColor = ctx.homeColor || 'var(--cc-interactive)';
        var awayColor = ctx.awayColor || 'var(--cc-accent)';

        function show(idx) {
            if (idx == null) {
                pinned = null;
                cursor.setAttribute('hidden', '');
                pin.setAttribute('hidden', '');
                readout.innerHTML = readoutHtml(pts[0], ctx);
                plot.setAttribute('aria-valuenow', '0');
                plot.classList.remove('is-scrubbing');
                return;
            }
            idx = Math.max(0, Math.min(pts.length - 1, idx));
            pinned = idx;
            var p = pts[idx];
            cursor.setAttribute('x1', p.x.toFixed(2));
            cursor.setAttribute('x2', p.x.toFixed(2));
            cursor.removeAttribute('hidden');
            pin.setAttribute('cx', p.x.toFixed(2));
            pin.setAttribute('cy', p.y.toFixed(2));
            pin.setAttribute('fill', p.wp >= 0.5 ? homeColor : awayColor);
            pin.removeAttribute('hidden');
            readout.innerHTML = readoutHtml(p, ctx);
            plot.setAttribute('aria-valuenow', String(idx));
            plot.classList.add('is-scrubbing');
        }

        // Pointer x -> viewBox x. getBoundingClientRect rather than the SVG's
        // own coordinate transform so this works the same in jsdom.
        function toViewBox(clientX) {
            var r = svg.getBoundingClientRect();
            if (!r.width) return 0;
            return ((clientX - r.left) / r.width) * model.box.W;
        }

        function scrub(e) {
            show(indexAt(model, toViewBox(e.clientX)));
        }

        plot.addEventListener('pointerdown', function (e) { scrub(e); });
        plot.addEventListener('pointermove', function (e) {
            // A mouse scrubs on hover; a finger only while it is down, so a
            // vertical swipe over the card still scrolls the page.
            if (e.pointerType === 'mouse' || e.pressure > 0 || e.buttons) scrub(e);
        });
        plot.addEventListener('pointerleave', function (e) {
            // Touch keeps the moment on screen after the finger lifts — there is
            // no hover to come back to.
            if (e.pointerType === 'mouse') show(null);
        });
        plot.addEventListener('keydown', function (e) {
            var at = pinned == null ? pts.length - 1 : pinned;
            if (e.key === 'ArrowRight') { show(at + 1); e.preventDefault(); }
            else if (e.key === 'ArrowLeft') { show(at - 1); e.preventDefault(); }
            else if (e.key === 'Home') { show(0); e.preventDefault(); }
            else if (e.key === 'End') { show(pts.length - 1); e.preventDefault(); }
            else if (e.key === 'Escape') { show(null); }
        });

        if (pinned != null && pinned < pts.length) show(pinned);
    }

    // Drop the scrubber's pinned moment. A page load clears it by re-evaluating
    // this file; this is for callers that re-render a DIFFERENT game into the
    // same document, and for specs.
    function reset() { state = null; pinned = null; }

    return {
        reset: reset,
        clockSeconds: clockSeconds,
        gameSeconds: gameSeconds,
        buildSeries: buildSeries,
        buildModel: buildModel,
        splitAtMidline: splitAtMidline,
        swingDots: swingDots,
        indexAt: indexAt,
        readoutHtml: readoutHtml,
        render: render,
        attach: attach
    };
}));
