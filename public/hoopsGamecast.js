// The basketball game page's Gamecast tab: On the floor, Game flow and the
// play-by-play, drawn from GET /hoops/games/:id/plays (modules/hoops-gamecast.js).
// Pure rendering: public/hoopsGame.js owns the fetching, the tab and the
// clicks, and passes the play log in.
//
// A play is { type, text, period, clock, side, home, away, points, wp, shot }
// (modules/hoops-play-log.js): home/away and wp are always OUR home side's.

(function (global) {
    var kit = global.ccSportPage;
    var esc = kit.esc;

    var half = function (p) { return p === 1 ? '1st' : p === 2 ? '2nd' : p > 2 ? 'OT' + (p > 3 ? p - 2 : '') : ''; };
    var abbr = function (t) { return t.abbreviation || t.school; };
    // Seconds into the game: two 20-minute halves, then 5-minute overtimes.
    function secs(p) {
        var m = /^(\d+):(\d+)/.exec(p.clock || '');
        var left = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
        return p.period <= 2 ? (p.period - 1) * 1200 + (1200 - left) : 2400 + (p.period - 3) * 300 + (300 - left);
    }
    var scored = function (p) { return p.home != null && p.away != null; };
    var TIMEOUT = /TimeOut/i;

    // Every run of unanswered points; the last one is still going.
    function runs(plays) {
        var out = [], cur = null, h = 0, a = 0;
        plays.forEach(function (p) {
            if (!scored(p)) return;
            var dh = p.home - h, da = p.away - a;
            var side = dh > 0 && da === 0 ? 'home' : da > 0 && dh === 0 ? 'away' : null;
            if (side) {
                if (!cur || cur.side !== side) { if (cur) out.push(cur); cur = { side: side, pts: 0, from: p }; }
                cur.pts += side === 'home' ? dh : da;
                cur.to = p;
            }
            h = p.home; a = p.away;
        });
        if (cur) out.push(cur);
        return out;
    }

    function leads(plays) {
        var big = { home: 0, away: 0 }, changes = 0, ties = 0, prev = 0;
        plays.forEach(function (p) {
            if (!scored(p)) return;
            var m = p.home - p.away, s = m > 0 ? 1 : m < 0 ? -1 : 0;
            if (m > big.home) big.home = m;
            if (-m > big.away) big.away = -m;
            if (s === 0 && prev !== 0) ties++;
            if (s !== 0 && prev !== 0 && s !== prev) changes++;
            if (s !== 0) prev = s;
        });
        return { big: big, changes: changes, ties: ties };
    }

    // ---- On the floor (live only) ----

    function halfCourt() {
        return '<path d="M0 0H50M0 0V47M50 0V47M0 47H50"/>'
            + '<rect x="19" y="0" width="12" height="19"/>'
            + '<path d="M19 19A6 6 0 0 0 31 19"/><path d="M19 19A6 6 0 0 1 31 19" stroke-dasharray="1 1"/>'
            + '<path d="M3 0V7.79M47 0V7.79M3 7.79A22.15 22.15 0 0 0 47 7.79"/>'
            + '<path d="M21 5.25A4 4 0 0 0 29 5.25"/>'
            + '<path d="M22 4H28"/><circle cx="25" cy="5.25" r=".75"/>';
    }
    var shotKey = function (p) { return p ? [p.period, p.clock, p.side, p.shot.x, p.shot.y].join('|') : null; };

    function floor(d, plays, colors, animate) {
        var shots = plays.filter(function (p) { return p.shot; });
        var last = plays[plays.length - 1];
        if (!shots.length || !last) return '';
        var s = shots[shots.length - 1], team = { home: d.home, away: d.away };
        var dot = function (p, cls) {
            var c = esc(colors[p.side] || '#F4F6FB');
            return p.shot.made
                ? '<circle class="mk' + cls + '" cx="' + p.shot.x + '" cy="' + p.shot.y + '" r="1" fill="' + c + '"/>'
                : '<circle class="ms' + cls + '" cx="' + p.shot.x + '" cy="' + p.shot.y + '" r=".75" stroke="' + c + '"/>';
        };
        // Seen from above: a straight flight to the rim, the ball swelling as
        // it rises. Drawn only when the shot is new, so a refresh that brings
        // nothing new does not replay it.
        var path = 'M' + s.shot.x + ' ' + s.shot.y + ' L25 5.25';
        var flight = animate
            ? '<path class="arc" d="' + path + '"/>'
                + (s.shot.made ? '<circle class="boom" cx="25" cy="5.25" r="1.2"/>' : '')
                + '<g class="land">' + dot(s, '') + '</g>'
                + '<g><animateMotion dur=".9s" fill="freeze" path="' + path + '" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".3 0 .6 1"/>'
                + '<circle class="ball" r=".85"><animate attributeName="r" dur=".9s" fill="freeze" values=".85;1.7;.75" keyTimes="0;.45;1"/>'
                + '<animate attributeName="opacity" begin=".9s" dur=".4s" fill="freeze" values="1;0"/></circle></g>'
            : dot(s, '');
        var lt = last.side ? team[last.side] : null;
        var chip = function (k) {
            var f = d.fouls && d.fouls[k];
            if (!f) return '';
            return '<span class="hg-gc-chip"><i style="background:' + esc(colors[k]) + '"></i>' + esc(abbr(team[k])) + ' · ' + f.fouls + ' foul' + (f.fouls === 1 ? '' : 's')
                + (f.bonus ? ' · <b>in the ' + (f.bonus === 'double' ? 'double bonus' : 'bonus') + '</b>' : '') + '</span>';
        };
        var run = runs(plays).pop();
        var runChip = run && run.pts >= 4
            ? '<span class="hg-gc-chip hot" style="--tc:' + esc(colors[run.side]) + '"><i style="background:' + esc(colors[run.side]) + '"></i>'
                + esc(abbr(team[run.side])) + ' on a ' + run.pts + '–0 run</span>' : '';
        return '<h2 class="sp-h">On the floor</h2><div class="sp-card hg-gc">'
            + '<div class="hg-gc-head"><b>Last shot</b><span class="hg-gc-live"><i></i>' + half(last.period) + ' · ' + esc(last.clock) + '</span></div>'
            + '<svg class="hg-gc-floor" viewBox="-1 -1 52 40" role="img" aria-label="' + esc(abbr(team[s.side])) + ' ' + (s.shot.made ? 'made' : 'missed') + ' shot">'
            + '<g class="ln">' + halfCourt() + '</g>'
            + shots.slice(-7, -1).map(function (p) { return dot(p, ' old'); }).join('')
            + flight + '</svg>'
            + '<p class="hg-gc-cap"><b>' + esc(abbr(team[s.side])) + '</b> · ' + esc(String(s.text || '').replace(/\s*\(.*\)\s*$/, '')) + ' · ' + half(s.period) + ' ' + esc(s.clock) + '</p>'
            + '<div class="hg-gc-last" style="--tc:' + esc(lt ? colors[last.side] : 'transparent') + '">'
            + (lt && lt.logo ? '<img src="' + esc(lt.logo) + '" alt="">' : '')
            + '<div class="t">' + esc(last.text) + '<small>' + half(last.period) + ' · ' + esc(last.clock) + ' · Last play</small></div>'
            + (scored(last) ? '<div class="sc">' + last.away + '–' + last.home + '</div>' : '') + '</div>'
            + '<div class="hg-gc-chips">' + runChip + chip('away') + chip('home') + '</div></div>';
    }

    // ---- Game flow: win probability | lead ----

    var W = 320, H = 130;
    function chartFrame(end, body, label) {
        var X = function (t) { return (t / end) * W; };
        return '<svg class="hg-gc-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">'
            + '<line class="half" x1="' + X(1200) + '" x2="' + X(1200) + '" y1="0" y2="' + H + '"/>'
            + '<line class="mid" x1="0" x2="' + W + '" y1="' + H / 2 + '" y2="' + H / 2 + '"/>' + body + '</svg>'
            + '<div class="hg-gc-axis"><span>Tip</span><span>Half</span><span>' + (end > 2400 ? 'OT' : 'End') + '</span></div>';
    }
    // Away's colour above the midline, home's below; a white line on top.
    function twoTone(pts, end, colors, id) {
        var X = function (t) { return ((t / end) * W).toFixed(1); };
        var line = pts.map(function (q, i) { return (i ? 'L' : 'M') + X(q[0]) + ' ' + q[1].toFixed(1); }).join('');
        var area = 'M' + X(pts[0][0]) + ' ' + H / 2 + line.replace(/^M/, 'L') + 'L' + X(pts[pts.length - 1][0]) + ' ' + H / 2 + 'Z';
        return '<defs><clipPath id="' + id + 'a"><rect width="' + W + '" height="' + H / 2 + '"/></clipPath>'
            + '<clipPath id="' + id + 'h"><rect y="' + H / 2 + '" width="' + W + '" height="' + H / 2 + '"/></clipPath></defs>'
            + '<path d="' + area + '" fill="' + esc(colors.away) + '" fill-opacity=".35" clip-path="url(#' + id + 'a)"/>'
            + '<path d="' + area + '" fill="' + esc(colors.home) + '" fill-opacity=".35" clip-path="url(#' + id + 'h)"/>'
            + '<path d="' + line + '" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
    }

    function winProb(d, plays, colors, end, now) {
        var pts = plays.filter(function (p) { return p.wp != null; }).map(function (p) { return [secs(p), p.wp * H]; });
        if (pts.length < 2) return '<p class="hg-gc-empty">No win probability for this game yet.</p>';
        var wp = plays.filter(function (p) { return p.wp != null; }).pop().wp;
        // A final is decided, whatever the model's last number says.
        if (d.game.final && d.home.points != null && d.away.points != null) {
            wp = d.home.points > d.away.points ? 1 : 0;
            pts.push([now, wp * H]);
        }
        var lead = wp >= 0.5 ? 'home' : 'away', team = { home: d.home, away: d.away };
        var pct = Math.round(100 * (lead === 'home' ? wp : 1 - wp));
        var pre = d.preview && d.preview.homeWinProb != null ? d.preview.homeWinProb : null;
        return '<div class="hg-gc-big"><b style="color:' + esc(colors[lead]) + '">' + esc(abbr(team[lead])) + ' ' + pct + '%</b><span>'
            + (d.game.final ? 'won' : 'to win, now') + '</span></div>'
            + chartFrame(end, twoTone(pts, end, colors, 'wp')
                + (d.game.live ? '<circle cx="' + ((now / end) * W).toFixed(1) + '" cy="' + (wp * H).toFixed(1) + '" r="3.5" fill="#fff"/>' : '')
                + '<text x="4" y="12">' + esc(abbr(d.away)) + '</text><text x="4" y="' + (H - 4) + '">' + esc(abbr(d.home)) + '</text>', 'Win probability')
            + '<p class="hg-gc-foot">' + (pre != null ? 'Pregame (Torvik): ' + esc(abbr(d.home)) + ' ' + Math.round(pre * 100) + '%. ' : '')
            + (d.gcSource === 'espn' ? 'Live line from ESPN.' : 'Line from CollegeBasketballData.') + '</p>';
    }

    function leadChart(d, plays, colors, end, now) {
        var marks = [[0, 0]], maxM = 1;
        plays.forEach(function (p) { if (scored(p)) { marks.push([secs(p), p.away - p.home]); maxM = Math.max(maxM, Math.abs(p.away - p.home)); } });
        maxM = Math.ceil((maxM + 2) / 5) * 5;
        var Y = function (m) { return H / 2 - (m / maxM) * (H / 2 - 6); };
        // Stepped: the margin holds until the next basket.
        var pts = [];
        marks.forEach(function (q, i) { if (i) pts.push([q[0], Y(marks[i - 1][1])]); pts.push([q[0], Y(q[1])]); });
        pts.push([d.game.final ? end : now, Y(marks[marks.length - 1][1])]);
        var team = { home: d.home, away: d.away };
        var m = marks[marks.length - 1][1];
        var who = m === 0 ? null : m > 0 ? 'away' : 'home';
        var L = leads(plays), bigSide = L.big.home >= L.big.away ? 'home' : 'away';
        var top = runs(plays).filter(function (r) { return r.pts >= 8; }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, 3);
        var stat = function (k, v) { return '<div class="hg-gc-stat"><span>' + k + '</span><b>' + v + '</b></div>'; };
        return '<div class="hg-gc-big"><b' + (who ? ' style="color:' + esc(colors[who]) + '"' : '') + '>'
            + (who ? esc(abbr(team[who])) + ' by ' + Math.abs(m) : 'Tied') + '</b><span>' + (d.game.final ? 'final margin' : 'lead now') + '</span></div>'
            + chartFrame(end, twoTone(pts, end, colors, 'ld')
                + '<text x="4" y="12">' + esc(abbr(d.away)) + ' +' + maxM + '</text><text x="4" y="' + (H - 4) + '">' + esc(abbr(d.home)) + ' +' + maxM + '</text>', 'Lead over the game')
            + '<div class="hg-gc-stats">' + stat('Lead changes', L.changes) + stat('Ties', L.ties)
            + stat('Biggest lead', Math.max(L.big.home, L.big.away) ? Math.max(L.big.home, L.big.away) + ' ' + esc(abbr(team[bigSide])) : '—') + '</div>'
            + (top.length ? '<div class="hg-gc-runs">' + top.map(function (r) {
                return '<div class="hg-gc-run"><i style="background:' + esc(colors[r.side]) + '"></i><b>' + esc(abbr(team[r.side])) + ' ' + r.pts + '–0</b> run'
                    + '<small>' + half(r.from.period) + ' ' + esc(r.from.clock) + ' – ' + half(r.to.period) + ' ' + esc(r.to.clock) + '</small></div>';
            }).join('') + '</div>' : '');
    }

    function flow(d, plays, colors, ui) {
        var last = plays[plays.length - 1];
        var now = last ? secs(last) : 0;
        var end = Math.max(2400, now);
        var b = function (k, label) { return '<button type="button" data-gc-chart="' + k + '" class="' + (ui.chart === k ? 'on' : '') + '" aria-pressed="' + (ui.chart === k) + '">' + label + '</button>'; };
        return '<h2 class="sp-h">Game flow</h2><div class="sp-card hg-gc">'
            + '<div class="hg-gc-seg">' + b('wp', 'Win probability') + b('lead', 'Lead') + '</div>'
            + (ui.chart === 'lead' ? leadChart(d, plays, colors, end, now) : winProb(d, plays, colors, end, now)) + '</div>';
    }

    // ---- Play-by-play ----

    function row(d, p, colors) {
        if (TIMEOUT.test(p.type || '')) return '<div class="hg-gc-row mute">' + esc(p.text) + ' · ' + esc(p.clock) + '</div>';
        if (/^End (Period|Game)$/.test(p.type || '')) return '<div class="hg-gc-row mute">' + esc(p.text) + '</div>';
        var t = p.side ? d[p.side] : null;
        return '<div class="hg-gc-row' + (p.points ? ' score' : '') + '" style="--tc:' + esc(p.side ? colors[p.side] : 'transparent') + '">'
            + (t && t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : '<span class="nl"></span>')
            + '<span class="ck">' + esc(p.clock) + '</span>'
            + '<span class="tx">' + esc(p.text) + '</span>'
            + '<span class="sc">' + (p.points ? '<em>+' + p.points + '</em>' : '') + (scored(p) ? p.away + '–' + p.home : '') + '</span></div>';
    }

    function pbp(d, plays, colors, ui) {
        var live = !!d.game.live;
        var list = ui.pbp === 'scoring' ? plays.filter(function (p) { return p.points; }) : plays;
        var periods = [];
        list.forEach(function (p) { if (periods.indexOf(p.period) < 0) periods.push(p.period); });
        // Newest first while it is on, as football's play log does; the
        // newest period opens, the rest fold to one line each.
        var newest = periods[periods.length - 1];
        if (live) periods.reverse();
        var tab = function (k, label) { return '<button type="button" class="hg-pbp-tab' + (ui.pbp === k ? ' on' : '') + '" data-gc-pbp="' + k + '" aria-pressed="' + (ui.pbp === k) + '">' + label + '</button>'; };
        var body = periods.map(function (per) {
            var rows = list.filter(function (p) { return p.period === per; });
            if (live) rows = rows.slice().reverse();
            var open = ui.open[per] != null ? ui.open[per] : per === newest;
            var n = rows.filter(function (p) { return !TIMEOUT.test(p.type || '') && !/^End /.test(p.type || ''); }).length;
            return '<div class="hg-pbp-group' + (open ? ' on' : '') + '">'
                + '<button type="button" class="hg-pbp-period" data-gc-per="' + per + '" aria-expanded="' + open + '"><span class="caret" aria-hidden="true"></span>'
                + '<span class="lbl">' + (per <= 2 ? half(per) + ' half' : half(per)) + '</span><span class="n">' + n + ' play' + (n === 1 ? '' : 's') + '</span></button>'
                + (open ? '<div class="hg-pbp-body">' + rows.map(function (p) { return row(d, p, colors); }).join('') + '</div>' : '') + '</div>';
        }).join('');
        return '<h2 class="sp-h">Play-by-play' + (live ? '<small>Newest first</small>' : '') + '</h2><div class="sp-card hg-gc">'
            + '<div class="hg-pbp-tabs">' + tab('all', 'All plays') + tab('scoring', 'Scoring') + '</div>'
            + (list.length ? '<div class="hg-pbp-list">' + body + '</div>' : '<p class="hg-gc-empty">No scoring plays yet.</p>')
            + '<p class="hg-gc-note">Substitutions hidden.' + (d.gcSource === 'espn' ? ' Plays from ESPN.' : '') + '</p></div>';
    }

    // The whole tab. `ui` is { chart, pbp, open, animate }.
    function panel(d, plays, colors, ui) {
        if (!plays || !plays.length) return '<div class="sp-card sp-empty">No plays yet.</div>';
        return (d.game.live ? floor(d, plays, colors, ui.animate) : '') + flow(d, plays, colors, ui) + pbp(d, plays, colors, ui);
    }

    // The latest located shot's key: the page replays the flight only when it changes.
    function latestShot(plays) {
        var s = (plays || []).filter(function (p) { return p.shot; });
        return shotKey(s[s.length - 1]);
    }

    global.ccHoopsGamecast = { panel: panel, latestShot: latestShot, runs: runs, leads: leads, secs: secs };
})(typeof window !== 'undefined' ? window : this);
