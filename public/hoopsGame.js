// The basketball game page (#503). Renders GET /hoops/games/:id/page.
//
// Scoreboard and setting first; then the fantasy read — each side's own
// quadrant and who banked what — because that is why a manager opens a
// game; then the four factors that explain the score, and the box.

(function () {
    var root = document.getElementById('hoops-game');
    if (!root) return;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fixed(n, d) { return n == null || !isFinite(n) ? '—' : Number(n).toFixed(d); }
    function ma(m, a) { return (m == null ? '—' : m) + '-' + (a == null ? '—' : a); }
    function abbr(t) { return t.abbreviation || t.school; }
    function teamLink(t, inner) {
        return t.hasPage ? '<a href="/hoops/team/' + encodeURIComponent(t.id) + '">' + inner + '</a>' : inner;
    }

    var state = { tab: 'summary', side: 'away' };
    var data = null;

    function when(g) {
        var k = window.ccKickoff;
        var p = k && k.parts ? k.parts(g.startDate, g.startTimeTbd) : null;
        if (!p) return '';
        var day = p.monthShort + ' ' + p.day;
        if (g.final) return day;
        return day + (p.tbd ? ' · TBD' : ' · ' + k.time(g.startDate, g.startTimeTbd, 'spaced'));
    }

    function hero(d) {
        var g = d.game, H = d.home, A = d.away;
        var place = [g.venue, [g.city, g.state].filter(Boolean).join(', ')].filter(Boolean).map(esc).join(' · ');
        var status = g.final ? 'Final' : (String(g.status || '').toLowerCase() === 'in_progress' ? 'Live' : 'Upcoming');
        var meta = '<b>' + status + '</b>' + (when(g) ? ' · ' + esc(when(g)) : '')
            + (g.tournament ? ' · ' + esc(g.tournament) : g.notes ? ' · ' + esc(g.notes) : '')
            + (place || g.neutralSite ? '<br>' + place + (g.neutralSite ? (place ? ' · ' : '') + 'neutral site' : '') : '');
        var side = function (t) {
            return '<div class="hg-side">' + teamLink(t, (t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : '')
                + '<div class="hg-nm">' + (t.rank ? '<small>' + t.rank + '</small>' : '') + esc(t.school).toUpperCase() + '</div>')
                + (t.record ? '<div class="hg-rec">' + t.record.w + '–' + t.record.l + '</div>' : '') + '</div>';
        };
        var homeWon = g.final && H.points > A.points;
        // Away on the left, home on the right — the scoreboard convention,
        // so "@" reads correctly — and the score in the same order.
        var score = g.final
            ? '<span class="' + (homeWon ? 'lose' : '') + '">' + A.points + '</span><span class="dash">–</span>'
                + '<span class="' + (homeWon ? '' : 'lose') + '">' + H.points + '</span>'
            : '<span class="vs">' + (g.neutralSite ? 'vs' : '@') + '</span>';
        return '<section class="hg-hero" style="--left:' + esc(A.color || '#343954') + ';--right:' + esc(H.color || '#343954') + '">'
            + '<div class="hg-meta">' + meta + '</div>'
            + '<div class="hg-board">' + side(A) + '<div class="hg-score">' + score + '</div>' + side(H) + '</div>'
            + lineScore(d) + '</section>';
    }

    function lineScore(d) {
        var b = d.box;
        if (!b || !b.home || !b.home.byPeriod || !b.home.byPeriod.length) return '';
        var label = function (i) { return i === 0 ? '1st' : i === 1 ? '2nd' : 'OT' + (i > 2 ? i - 1 : ''); };
        var row = function (t, s) {
            return '<tr><td>' + esc(abbr(t)) + '</td>' + s.byPeriod.map(function (x) { return '<td>' + x + '</td>'; }).join('')
                + '<td>' + s.points + '</td></tr>';
        };
        return '<table class="hg-lines"><tr><th></th>' + b.home.byPeriod.map(function (_, i) { return '<th>' + label(i) + '</th>'; }).join('')
            + '<th>T</th></tr>' + row(d.away, b.away) + row(d.home, b.home) + '</table>';
    }

    // Each side's own read of the game: the quadrant it was worth to THAT
    // team (Q1 for one side can be Q3 for the other) and who banked what.
    function fantasy(d) {
        var vals = d.quadrantValues;
        var card = function (t, won) {
            var q = t.quadrant ? '<span class="hg-q' + (t.quadrant === 1 ? ' q1' : '') + '">Q' + t.quadrant + '</span>'
                : '<span class="hg-q post">' + esc(d.game.tournament || 'Post') + '</span>';
            var head = d.game.final
                ? q + (won ? 'win' : 'loss') + ' for <b>' + esc(t.school) + '</b>'
                : q + 'game for <b>' + esc(t.school) + '</b>';
            var foot = '';
            if (vals) {
                var who = t.owner ? esc(t.owner.franchiseName || t.owner.firstName || 'a manager') : null;
                if (!who) foot = 'Not on a roster';
                else if (d.game.final) foot = '<b>' + (t.banked > 0 ? '+' : '') + (t.banked == null ? 0 : t.banked) + '</b> for ' + who;
                else foot = (t.quadrant && vals[t.quadrant] ? '<b>+' + vals[t.quadrant] + '</b> if won, for ' : 'On ') + who + (t.quadrant && vals[t.quadrant] ? '' : '’s roster');
            }
            return '<div class="hg-fc">' + head + (foot ? '<span class="p">' + foot + '</span>' : '') + '</div>';
        };
        var awayWon = d.game.final && d.away.points > d.home.points;
        return '<div class="hg-fan">' + card(d.away, awayWon) + card(d.home, d.game.final && !awayWon) + '</div>';
    }

    // Plain words, as on the team page. `up` false means lower is better —
    // the bar is then drawn from the OTHER side's number, so the longer bar
    // is always the better side rather than the bigger number.
    var FACTORS = [
        { key: 'efgPct', name: 'Shooting', what: 'eFG%', up: true },
        { key: 'tovPct', name: 'Ball security', what: 'turnovers per 100', up: false },
        { key: 'orbPct', name: 'Second chances', what: 'off. rebound %', up: true },
        { key: 'ftRate', name: 'Getting to the line', what: 'FT rate', up: true }
    ];
    function factors(d) {
        var a = d.box.away, h = d.box.home;
        var out = '<div class="hg-vs-head"><span>' + esc(abbr(d.away)) + '</span><span></span><span>' + esc(abbr(d.home)) + '</span></div>';
        FACTORS.forEach(function (f) {
            var x = a[f.key], y = h[f.key];
            if (x == null || y == null) return;
            var awayBetter = f.up ? x > y : x < y;
            var wa = f.up ? x : y, wh = f.up ? y : x;          // bar lengths: longer = better
            out += '<div class="hg-vs"><span class="l' + (awayBetter ? ' edge' : '') + '">' + fixed(x, 1) + '</span>'
                + '<span class="mid">' + f.name + '<small>' + f.what + '</small><span class="bars">'
                + '<i style="flex:' + (wa || 0.001) + '" class="' + (awayBetter ? 'on' : '') + '"></i>'
                + '<i style="flex:' + (wh || 0.001) + '" class="' + (awayBetter ? '' : 'on') + '"></i></span></span>'
                + '<span class="r' + (awayBetter ? '' : ' edge') + '">' + fixed(y, 1) + '</span></div>';
        });
        return out;
    }

    var TEAM_STATS = [
        ['Field goals', function (s) { return ma(s.fgMade, s.fgAtt); }],
        ['Threes', function (s) { return ma(s.threeMade, s.threeAtt); }],
        ['Free throws', function (s) { return ma(s.ftMade, s.ftAtt); }],
        ['Rebounds', function (s) { return fixed(s.rebounds, 0); }],
        ['Assists', function (s) { return fixed(s.assists, 0); }],
        ['Turnovers', function (s) { return fixed(s.turnovers, 0); }],
        ['Points in the paint', function (s) { return fixed(s.paintPoints, 0); }],
        ['Fast-break points', function (s) { return fixed(s.fastBreakPoints, 0); }],
        ['Points off turnovers', function (s) { return fixed(s.pointsOffTurnovers, 0); }],
        ['Largest lead', function (s) { return fixed(s.largestLead, 0); }]
    ];
    function teamStats(d) {
        return TEAM_STATS.map(function (r) {
            return '<div class="hg-vs"><span class="l">' + r[1](d.box.away) + '</span><span class="mid">' + r[0] + '</span><span class="r">' + r[1](d.box.home) + '</span></div>';
        }).join('');
    }

    // "C. Boozer" — unless two players on the team shorten to the same
    // thing (Duke had Cameron and Cayden Boozer), in which case both keep
    // their full names.
    function shortNames(players) {
        var short = function (n) {
            var p = String(n || '').trim().split(/\s+/);
            return p.length > 1 ? p[0].charAt(0) + '. ' + p.slice(1).join(' ') : n;
        };
        var count = {};
        players.forEach(function (p) { var s = short(p.name); count[s] = (count[s] || 0) + 1; });
        var out = {};
        players.forEach(function (p) { var s = short(p.name); out[p.name] = count[s] > 1 ? p.name : s; });
        return out;
    }

    function leaders(d) {
        var stat = [['Points', 'points'], ['Rebounds', 'rebounds'], ['Assists', 'assists']];
        var h = '<div class="hg-lead">';
        stat.forEach(function (s) {
            h += '<div class="hg-ld"><div class="k">' + s[0] + '</div>';
            [['away', d.away], ['home', d.home]].forEach(function (pair) {
                var ps = (d.box[pair[0]].players || []).slice();
                if (!ps.length) return;
                var names = shortNames(ps);
                var top = ps.sort(function (a, b) { return (b[s[1]] || 0) - (a[s[1]] || 0); })[0];
                h += '<div class="hg-ld-row"><span>' + esc(names[top.name]) + ' <small>' + esc(abbr(pair[1])) + '</small></span><b>' + fixed(top[s[1]], 0) + '</b></div>';
            });
            h += '</div>';
        });
        return h + '</div>';
    }

    function boxTable(d) {
        var team = d[state.side], s = d.box[state.side];
        var ps = (s.players || []).slice().sort(function (a, b) { return (b.starter - a.starter) || ((b.minutes || 0) - (a.minutes || 0)); });
        if (!ps.length) return '<div class="ht-card ht-empty">No player lines for ' + esc(team.school) + '.</div>';
        var names = shortNames(ps);
        var high = Math.max.apply(null, ps.map(function (p) { return p.points || 0; }));
        var h = '<div class="ht-card"><table class="hg-box"><tr><th>Player</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>3PT</th><th>FG</th></tr>';
        var bench = false;
        if (ps[0].starter) h += '<tr class="grp"><td colspan="7">Starters</td></tr>';
        ps.forEach(function (p) {
            if (!p.starter && !bench) { bench = true; h += '<tr class="grp"><td colspan="7">Bench</td></tr>'; }
            h += '<tr><td>' + esc(names[p.name]) + (p.position ? '<span class="pos">' + esc(p.position) + '</span>' : '') + '</td>'
                + '<td>' + fixed(p.minutes, 0) + '</td><td' + (p.points === high && high > 0 ? ' class="hi"' : '') + '>' + fixed(p.points, 0) + '</td>'
                + '<td>' + fixed(p.rebounds, 0) + '</td><td>' + fixed(p.assists, 0) + '</td>'
                + '<td>' + ma(p.threeMade, p.threeAtt) + '</td><td>' + ma(p.fgMade, p.fgAtt) + '</td></tr>';
        });
        return h + '</table></div>';
    }

    function noBox(d) {
        var text = !d.game.final ? 'The box score arrives after the final.'
            : d.boxUnavailable ? 'Couldn’t reach the stats provider — try again in a bit.'
            : d.boxMissing ? 'There’s no box score for this game.'
            : 'The box score isn’t posted yet. It usually lands within the hour.';
        return '<div class="ht-card ht-empty">' + text + '</div>';
    }

    function tabs(d) {
        if (!d.box) return '';
        return '<nav class="ht-tabs" role="tablist">' + [['summary', 'Summary'], ['box', 'Box score']].map(function (t) {
            return '<button type="button" role="tab" data-tab="' + t[0] + '" class="ht-tab' + (state.tab === t[0] ? ' on' : '') + '" aria-selected="' + (state.tab === t[0]) + '">' + t[1] + '</button>';
        }).join('') + '</nav>';
    }

    function panel(d) {
        if (!d.box) return noBox(d);
        if (state.tab === 'box') {
            var seg = function (key) {
                var t = d[key];
                return '<button type="button" data-side="' + key + '" class="' + (state.side === key ? 'on' : '') + '">'
                    + (t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : '') + esc(t.school) + '</button>';
            };
            return '<div class="hg-seg">' + seg('away') + seg('home') + '</div>' + boxTable(d);
        }
        return '<h2>Four factors<small>Why it ended ' + d.away.points + '–' + d.home.points + '</small></h2><div class="ht-card">' + factors(d) + '</div>'
            + '<h2>Team stats' + (d.box.pace ? '<small>' + fixed(d.box.pace, 0) + ' possessions</small>' : '') + '</h2><div class="ht-card">' + teamStats(d) + '</div>'
            + '<h2>Leaders</h2>' + leaders(d);
    }

    function paintPanel() {
        var t = root.querySelector('.ht-tabs');
        if (t) t.outerHTML = tabs(data);
        root.querySelector('.hg-panel').innerHTML = panel(data);
    }

    function render(d) {
        data = d;
        var h = (window.location.hash || '').replace('#', '');
        state.tab = h === 'box' ? 'box' : 'summary';
        // Open the box on the side a manager owns; otherwise the left-hand
        // (away) side, so the toggle reads in the scoreboard's order.
        state.side = d.home.owner && !d.away.owner ? 'home' : 'away';
        root.innerHTML = hero(d) + fantasy(d) + tabs(d) + '<div class="hg-panel" role="tabpanel">' + panel(d) + '</div>';
        var title = document.querySelector('title');
        if (title) title.setAttribute('data-league-title', abbr(d.away) + (d.game.neutralSite ? ' vs ' : ' at ') + abbr(d.home));
        if (window.ccLeague && window.ccLeague.paint) window.ccLeague.paint();
    }

    root.addEventListener('click', function (e) {
        if (!data) return;
        var tab = e.target.closest('[data-tab]');
        if (tab) {
            state.tab = tab.getAttribute('data-tab');
            if (window.history && window.history.replaceState) window.history.replaceState(null, '', '#' + state.tab);
            paintPanel();
            return;
        }
        var side = e.target.closest('[data-side]');
        if (side) {
            state.side = side.getAttribute('data-side');
            paintPanel();
        }
    });

    function fail(text) { root.innerHTML = '<div class="ht-error">' + esc(text) + '</div>'; }

    function load() {
        var id = root.getAttribute('data-game-id');
        return fetch('/hoops/games/' + encodeURIComponent(id) + '/page', { headers: { Accept: 'application/json' } })
            .then(function (r) {
                return r.json().catch(function () { return {}; }).then(function (body) {
                    if (!r.ok) throw new Error(body.message || ('Could not load this game (' + r.status + ')'));
                    return body;
                });
            })
            .then(render)
            .catch(function (e) { fail(e.message); });
    }

    // Tabs pin under the sticky navbar, measured, as on the team page.
    function syncStickyTop() {
        var nav = document.getElementById('navbar');
        document.documentElement.style.setProperty('--ht-sticky-top', (nav ? Math.floor(nav.getBoundingClientRect().height) : 0) + 'px');
    }
    syncStickyTop();
    window.addEventListener('resize', syncStickyTop);
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(syncStickyTop).catch(function () {});

    window.ccHoopsGame = { render: render, load: load, state: state, shortNames: shortNames };
    load();
})();
