// The basketball team page (#494). Renders GET /hoops/teams/:id/page.
//
// Built around how college basketball reads a team: the TEAM SHEET — wins
// and losses by quadrant, the selection committee's own view — and where
// the wins came from, because road wins are the currency. Each quadrant
// shows what a win there pays in this league, since that is the number a
// manager actually cares about.

(function () {
    var root = document.getElementById('hoops-team');
    if (!root) return;

    // Formatting, tabs, name fitting and loading come from the shared kit.
    var kit = window.ccSportPage;
    var esc = kit.esc, fixed = kit.fixed, record = kit.record;
    function venueMark(v) { return v === 'home' ? 'vs' : v === 'away' ? '@' : 'N'; }
    function won(g) { return g.us > g.them; }
    function teamHref(id) { return '/hoops/team/' + encodeURIComponent(id); }

    // A to-scale-in-spirit full court, drawn as thin strokes and stood on
    // end so one basket sits behind the name and half court runs along the
    // bottom of the hero. Coordinates are the source icon's 512-unit grid,
    // transposed.
    function court() {
        function end(m) {
            var X = function (x) { return m ? +(512 - x).toFixed(2) : x; };
            var sw = m ? 0 : 1;
            return '<path d="M' + X(8.35) + ' 128A128 128 0 0 ' + sw + ' ' + X(8.35) + ' 384"/>'
                + '<path d="M' + X(8.35) + ' 218.4H' + X(99.23) + 'M' + X(8.35) + ' 293.9H' + X(99.23) + '"/>'
                + '<path d="M' + X(84.08) + ' 218.4V293.9"/>'
                + '<path d="M' + X(99.23) + ' 218.4A37.75 37.75 0 0 ' + sw + ' ' + X(99.23) + ' 293.9"/>';
        }
        return '<svg class="ht-court" viewBox="97 0 318 512" fill="none" stroke="#fff" stroke-width="1.5" aria-hidden="true">'
            + '<g transform="matrix(0 1 1 0 0 0)">'
            + '<rect x="8.35" y="106.07" width="495.3" height="299.86"/>'
            + '<path d="M256 106.07V405.93"/><circle cx="256" cy="256" r="53.1"/>'
            + end(false) + end(true) + '</g></svg>';
    }

    function hero(d, done) {
        var t = d.team, pre = d.preseason;
        var conf = done.filter(function (g) { return g.conferenceGame; });
        var q1 = done.filter(function (g) { return g.quadrant === 1; });
        var chips = '';
        if (pre) {
            chips += '<span class="sp-chip">T-Rank <b>#' + esc(pre.rank) + '</b></span>';
            if (pre.projectedRecord) chips += '<span class="sp-chip">Torvik proj. <b>' + esc(pre.projectedRecord) + '</b></span>';
        }
        var sub = [t.mascot, t.conference, t.venue].filter(Boolean).map(esc).join(' · ');
        return '<section class="sp-hero team ht-hero"' + (t.color ? ' style="--team:' + esc(t.color) + '"' : '') + '>' + court()
            + '<div class="ht-id">' + (t.logo ? '<img class="ht-logo" src="' + esc(t.logo) + '" alt="">' : '')
            + '<div><div class="ht-school">' + esc(t.school).toUpperCase() + '</div>'
            + '<div class="ht-mascot">' + sub + '</div>'
            + (chips ? '<div class="ht-chips">' + chips + '</div>' : '') + '</div></div>'
            + '<div class="ht-rec">'
            + '<div><div class="n">' + record(done) + '</div><div class="l">Overall</div></div>'
            + (t.conference ? '<div><div class="n">' + record(conf) + '</div><div class="l">' + esc(t.conference) + '</div></div>' : '')
            + '<div><div class="n">' + record(q1) + '</div><div class="l">vs Q1</div></div>'
            + '</div></section>';
    }

    function ownerStrip(d, done, upcoming) {
        if (!d.owner) return '';
        var banked = done.reduce(function (s, g) { return s + (g.points || 0); }, 0);
        var vals = d.quadrantValues || {};
        var table = upcoming.reduce(function (s, g) { return s + (vals[g.quadrant] || 0); }, 0);
        var q1Left = upcoming.filter(function (g) { return g.quadrant === 1; }).length;
        var name = d.owner.franchiseName || d.owner.firstName || 'A manager';
        return '<div class="ht-own"><div class="who">On <b>' + esc(name) + '</b>’s roster'
            + (upcoming.length ? '<br><span class="sub">' + q1Left + ' Q1 game' + (q1Left === 1 ? '' : 's')
                + ' left · up to <b>+' + table + '</b> still on the table</span>' : '')
            + '</div><div class="pts"><div class="n" data-countup="' + banked + '" data-sign="+">' + (banked > 0 ? '+' : '') + banked + '</div><div class="l">pts banked</div></div></div>';
    }

    // The team sheet, phone-first: four tiles in a row — each quadrant's
    // record and what a win there pays — and ONE list under them, for the
    // tile that is selected. Four full lists side by side was the longest
    // stretch of the page on a phone.
    function sheet(d) {
        var vals = d.quadrantValues;
        var h = '<div class="ht-tiles" role="tablist" aria-label="Quadrants">';
        [1, 2, 3, 4].forEach(function (q) {
            var done = d.games.filter(function (g) { return g.quadrant === q && g.final; });
            var left = d.games.filter(function (g) { return g.quadrant === q && !g.final; }).length;
            var pay = vals && vals[q] != null ? (vals[q] ? '+' + vals[q] + ' a win' : 'no pts') : '';
            h += '<button type="button" role="tab" class="ht-tile ht-q' + q + (state.q === q ? ' on' : '') + '" data-q="' + q + '"'
                + ' aria-selected="' + (state.q === q) + '">'
                + '<span class="ht-tile-q">Q' + q + '</span>'
                + '<span class="ht-tile-wl">' + (done.length ? record(done) : '—') + '</span>'
                + '<span class="ht-tile-sub">' + (pay || '&nbsp;') + '</span>'
                + (left ? '<span class="ht-tile-left">' + left + ' left</span>' : '<span class="ht-tile-left">&nbsp;</span>')
                + '</button>';
        });
        h += '</div>';
        var games = d.games.filter(function (g) { return g.quadrant === state.q; });
        h += '<div class="sp-card ht-qlist">';
        if (!games.length) h += '<div class="sp-empty">No Q' + state.q + ' games on the schedule.</div>';
        games.forEach(function (g) { h += gameRow(d, g); });
        h += '</div><p class="ht-explain">Quadrants are the selection committee\'s yardstick: the opponent\'s rank, adjusted for where the game was played. Banked at time of play.</p>';
        return h;
    }

    function splits(done) {
        if (!done.length) return '';
        var by = function (v) { return record(done.filter(function (g) { return g.venue === v; })); };
        var streak = '', n = 0;
        for (var i = done.length - 1; i >= 0; i--) {
            var r = won(done[i]) ? 'W' : 'L';
            if (!streak) streak = r;
            if (r !== streak) break;
            n++;
        }
        var margin = done.reduce(function (s, g) { return s + g.us - g.them; }, 0) / done.length;
        var cell = function (n, l, cls) {
            return '<div class="ht-sp' + (cls ? ' ' + cls : '') + '"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>';
        };
        return '<h2 class="sp-h">Splits</h2><div class="ht-splits">'
            + cell(by('home'), 'Home') + cell(by('away'), 'Road', 'road') + cell(by('neutral'), 'Neutral')
            + cell(record(done.slice(-10)), 'Last 10') + cell(streak + n, 'Streak')
            + cell((margin > 0 ? '+' : '') + margin.toFixed(1), 'Margin') + '</div>';
    }

    function efficiency(d) {
        var p = d.preseason;
        if (!p || p.adjOE == null || p.adjDE == null) return '';
        var pct = function (x) { return Math.max(2, Math.min(100, Math.round(x))); };
        var row = function (label, width, value, sub) {
            return '<div class="ht-eff-row"><span>' + label + '</span><div class="ht-bar"><i style="width:' + pct(width) + '%"></i></div>'
                + '<span class="v">' + value + '<small>' + sub + '</small></span></div>';
        };
        var of = p.ratedTeams ? ' of ' + p.ratedTeams : '';
        return '<h2 class="sp-h">Efficiency<small>Torvik preseason · points per 100 possessions</small></h2><div class="sp-card ht-eff">'
            + row('Offense', (p.adjOE - 90) / 35 * 100, fixed(p.adjOE, 1), p.oeRank ? '#' + p.oeRank + of : '')
            + row('Defense', (125 - p.adjDE) / 35 * 100, fixed(p.adjDE, 1), p.deRank ? '#' + p.deRank + of : '')
            + row('Net', ((p.adjOE - p.adjDE) + 10) / 45 * 100, (p.adjOE >= p.adjDE ? '+' : '') + fixed(p.adjOE - p.adjDE, 1),
                p.barthag != null ? 'barthag ' + String(Math.round(p.barthag * 1000) / 1000).replace(/^0/, '') : '')
            + '<div class="ht-foot">Lower is better on defense.</div></div>';
    }

    // Dean Oliver's FOUR FACTORS: the four things that decide a basketball
    // game — shooting, turnovers, offensive rebounding, getting to the line.
    // Exactly those four, each named in plain words with what it measures,
    // ours against what opponents did. The edge marks the better side; for
    // turnovers lower is better, so the comparison flips.
    var FACTORS = [
        { key: 'efgPct', name: 'Shooting', what: 'Field-goal % with a three worth 1.5 makes', up: true },
        { key: 'tovRatio', name: 'Ball security', what: 'Turnovers per 100 possessions — lower is better', up: false, scale: 100 },
        { key: 'orbPct', name: 'Second chances', what: 'Share of their own misses they rebound', up: true },
        { key: 'ftRate', name: 'Getting to the line', what: 'Free throws tried per 100 shots', up: true }
    ];
    function fourFactors(s) {
        var t = s.team || {}, o = s.opponent || {};
        var h = '<div class="ht-ff">'
            + '<div class="ht-ff-head"><span></span><span>' + esc(state.school) + '</span><span>Opp.</span></div>';
        FACTORS.forEach(function (f) {
            var a = t[f.key], b = o[f.key];
            if (f.scale && a != null) a *= f.scale;
            if (f.scale && b != null) b *= f.scale;
            var better = a == null || b == null ? null : (f.up ? a > b : a < b);
            h += '<div class="ht-ff-row"><div><b>' + f.name + '</b><small>' + f.what + '</small></div>'
                + '<span' + (better === true ? ' class="edge"' : '') + '>' + fixed(a, 1) + '</span>'
                + '<span' + (better === false ? ' class="edge"' : '') + '>' + fixed(b, 1) + '</span></div>';
        });
        return h + '</div>';
    }

    // How they play, in four numbers that are not "factors": tempo, the
    // scoring rates both ways, and how much of the offence is threes.
    function style(s) {
        var t = s.team || {}, o = s.opponent || {};
        var chip = function (n, l) { return '<div class="ht-style-c"><b>' + n + '</b><small>' + l + '</small></div>'; };
        return '<div class="ht-style">'
            + chip(fixed(s.pace, 1), 'possessions per game')
            + chip(fixed(t.rating, 1), 'scored per 100')
            + chip(fixed(o.rating, 1), 'allowed per 100')
            + chip(t.threeRate != null ? fixed(t.threeRate, 0) + '%' : '—', 'of shots are threes')
            + '</div>';
    }

    function rotation(s) {
        var players = (s.players || []).filter(function (p) { return p.games > 0 && p.minutes > 0; })
            .sort(function (a, b) { return b.minutes / b.games - a.minutes / a.games; }).slice(0, 9);
        if (!players.length) return '';
        var per = function (p, k) { return p.games ? p[k] / p.games : null; };
        var top = {};
        ['points', 'rebounds', 'assists'].forEach(function (k) {
            top[k] = players.reduce(function (best, p) { return per(p, k) > per(best, k) ? p : best; }, players[0]).athleteId;
        });
        // "C. Boozer" on a phone, the full name where there is room — the
        // name column is what pushed the table off a 375px screen.
        var short = function (name) {
            var parts = String(name || '').trim().split(/\s+/);
            return parts.length > 1 ? parts[0].charAt(0) + '. ' + parts.slice(1).join(' ') : name;
        };
        var h = '<div class="ht-rot-wrap"><table class="ht-rot"><thead><tr><th>Player</th><th>MPG</th><th>PPG</th><th>RPG</th><th>APG</th><th class="wide">3P%</th><th>TS%</th></tr></thead><tbody>';
        players.forEach(function (p) {
            var c = function (k) { return '<td' + (top[k] === p.athleteId ? ' class="ht-lead"' : '') + '>' + fixed(per(p, k), 1) + '</td>'; };
            h += '<tr><td><span class="full">' + esc(kit.numbered(p, p.name)) + '</span><span class="short">' + esc(kit.numbered(p, short(p.name))) + '</span>'
                + (p.position ? '<span class="pos">' + esc(p.position) + '</span>' : '') + '</td>'
                + '<td>' + fixed(per(p, 'minutes'), 1) + '</td>' + c('points') + c('rebounds') + c('assists')
                + '<td class="wide">' + fixed(p.threePct, 1) + '</td><td>' + fixed(p.trueShootingPct, 1) + '</td></tr>';
        });
        return h + '</tbody></table></div>';
    }

    function stats(d) {
        var s = d.stats;
        if (!s || !s.games) {
            return '<div class="sp-card sp-empty">Box-score stats arrive once the season tips off, and refresh nightly.</div>';
        }
        return '<h2 class="sp-h">Style<small>' + esc(s.games) + ' games</small></h2>' + style(s)
            + '<h2 class="sp-h">Keys to the game<small>The four things that decide games</small></h2><div class="sp-card">' + fourFactors(s) + '</div>'
            + '<h2 class="sp-h">Rotation<small>Top nine by minutes per game</small></h2><div class="sp-card">' + rotation(s) + '</div>';
    }

    // The next game, one tap from its preview: when, where, who, and what a
    // win there pays this manager's league.
    // A game more than this far past its tip with no final (cancelled, or
    // a result still to arrive) is not "next".
    var STALE_TIP_MS = 4 * 60 * 60 * 1000;
    function nextUp(d, now) {
        now = now == null ? Date.now() : now;
        // A game with no date yet is kept: new Date(null) is 1970, not "past".
        var startOf = function (x) { return x.startDate ? new Date(x.startDate).getTime() : NaN; };
        var g = d.games.filter(function (x) { return !x.final && !(now - startOf(x) > STALE_TIP_MS); })[0];
        if (!g) return '';
        var vals = d.quadrantValues || {};
        var o = g.opponent;
        var pay = g.quadrant && vals[g.quadrant] ? '+' + vals[g.quadrant] + ' if won' : '';
        return '<a class="sp-card ht-next" href="/hoops/game/' + encodeURIComponent(g.id) + '">'
            // Tipped and not final: it is being played, not "awaiting" anything.
            + '<div class="ht-next-when">' + (!g.startTimeTbd && now >= startOf(g) ? 'Under way' : 'Next up · ' + esc(kit.countdown(g, now))) + '</div>'
            + '<div class="ht-next-row"><span class="ht-next-opp"><span class="ht-v">' + venueMark(g.venue) + '</span>'
            + (o.rank ? '<span class="ht-rk">' + o.rank + '</span> ' : '')
            + (o.logo ? '<img class="sp-ologo" src="' + esc(o.logo) + '" alt="" onerror="this.remove()">' : '')
            + '<b>' + esc(o.school) + '</b></span>'
            + (g.quadrant ? '<span class="ht-qt' + (g.quadrant === 1 ? ' q1' : '') + '">Q' + g.quadrant + '</span>'
                : '<span class="ht-qt post">' + esc(g.tournament || 'Post') + '</span>')
            + (pay ? '<span class="ht-next-pay">' + pay + '</span>' : '') + '</div>'
            + (g.notes ? '<div class="ht-next-note">' + esc(g.notes) + '</div>' : '') + '</a>';
    }

    // Where they sit in the conference, at a glance: the rows either side of
    // this team, with the full table one tap away on its own tab.
    var PEEK = 2;
    function standingsPeek(d) {
        if (!d.standings || !d.standings.length || !d.team.conference) return '';
        var at = -1;
        d.standings.forEach(function (r, i) { if (r.teamId === d.team.id) at = i; });
        if (at === -1) return '';
        var from = Math.max(0, Math.min(at - PEEK, d.standings.length - (PEEK * 2 + 1)));
        var rows = d.standings.slice(from, from + PEEK * 2 + 1);
        var h = '<h2 class="sp-h">' + esc(d.team.conference) + '<small>' + ordinal(at + 1) + ' of ' + d.standings.length + '</small></h2>'
            + '<div class="sp-card"><table class="ht-st"><thead><tr><th></th><th>Team</th><th>Conf</th><th>Overall</th></tr></thead><tbody>';
        rows.forEach(function (r, i) {
            h += standingsRow(d, r, from + i);
        });
        return h + '</tbody></table><button type="button" class="ht-peek-more" data-tab="conference">Full ' + esc(d.team.conference) + ' table</button></div>';
    }
    function ordinal(n) {
        var t = n % 100, s = n % 10;
        return n + (t >= 11 && t <= 13 ? 'th' : s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th');
    }
    function standingsRow(d, r, i) {
        return '<tr' + (r.teamId === d.team.id ? ' class="me"' : '') + '><td class="n">' + (i + 1) + '</td>'
            + '<td class="s"><a href="' + teamHref(r.teamId) + '">' + (r.logo ? '<img src="' + esc(r.logo) + '" alt="">' : '') + esc(r.school) + '</a></td>'
            + '<td>' + r.confW + '–' + r.confL + '</td><td>' + r.w + '–' + r.l + '</td></tr>';
    }

    function standings(d) {
        if (!d.standings || !d.standings.length || !d.team.conference) return '';
        var h = '<div class="sp-card"><table class="ht-st"><thead><tr>'
            + '<th></th><th>Team</th><th>Conf</th><th>Overall</th></tr></thead><tbody>';
        d.standings.forEach(function (r, i) { h += standingsRow(d, r, i); });
        return h + '</tbody></table></div>';
    }

    // A non-D-I opponent has no basketball page; its name is plain text
    // rather than a link to "No such basketball team".
    function oppOpen(o) {
        return o.hasPage === false ? '<span class="opp">' : '<a class="opp" href="' + teamHref(o.id) + '">';
    }

    function gameRow(d, g) {
        var vals = d.quadrantValues || {};
        var res = g.final
            ? '<span class="' + (won(g) ? 'sp-w' : 'sp-l') + '">' + (won(g) ? 'W' : 'L') + '</span> ' + g.us + '–' + g.them
            : (vals[g.quadrant] ? '+' + vals[g.quadrant] + ' if won' : '');
        var pts = g.final && g.points != null ? (g.points > 0 ? '+' + g.points : String(g.points)) : '';
        var gameHref = '/hoops/game/' + encodeURIComponent(g.id);
        return '<div class="sp-gr' + (g.final ? '' : ' up') + '"><a class="d" href="' + gameHref + '">' + kit.dayOf(g) + '</a>'
            + oppOpen(g.opponent) + '<span class="nm"><span class="ht-v">' + venueMark(g.venue) + '</span>'
            + (g.opponent.rank ? '<span class="ht-rk">' + g.opponent.rank + '</span> ' : '')
            + (g.opponent.logo ? '<img class="sp-ologo" src="' + esc(g.opponent.logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
            + '<span class="ht-school-nm" title="' + esc(g.opponent.school) + '"'
            + (g.opponent.abbreviation ? ' data-abbr="' + esc(g.opponent.abbreviation) + '"' : '') + '>'
            + esc(g.opponent.school) + '</span></span>'
            + (g.notes ? '<span class="note">' + esc(g.notes) + '</span>' : '') + (g.opponent.hasPage === false ? '</span>' : '</a>')
            + '<a class="res" href="' + gameHref + '">' + res + '</a>'
            + (g.quadrant ? '<span class="ht-qt' + (g.quadrant === 1 ? ' q1' : '') + '">Q' + g.quadrant + '</span>'
                : '<span class="ht-qt post" title="Scored on the tournament ladder">' + esc(g.tournament || 'Post') + '</span>')
            + '<span class="p' + (g.points ? '' : ' z') + '">' + pts + '</span></div>';
    }

    // Collapsed to what matters tonight — the last few results and the next
    // few games — with the full season one tap away.
    var RECENT = 5, NEXT = 3;
    function schedule(d) {
        var played = d.games.filter(function (g) { return g.final; });
        var ahead = d.games.filter(function (g) { return !g.final; });
        var shown = state.allGames ? d.games
            : played.slice(-RECENT).concat(ahead.slice(0, NEXT));
        var h = '<div class="sp-card sp-games">';
        var split = false;
        shown.forEach(function (g) {
            if (!g.final && !split) {
                split = true;
                h += '<div class="sp-gr div">Up next</div>';
            }
            h += gameRow(d, g);
        });
        h += '</div>';
        if (shown.length < d.games.length) {
            h += '<button type="button" class="sp-more" data-more="games">Full schedule · ' + d.games.length + ' games</button>';
        } else if (state.allGames && d.games.length > RECENT + NEXT) {
            h += '<button type="button" class="sp-more" data-more="games">Show less</button>';
        }
        return h;
    }

    // Page state: which tab, which quadrant, whether the full schedule is
    // open. The tab rides in the URL hash so back, refresh and a shared link
    // land where the reader was.
    var TABS = ['resume', 'schedule', 'stats', 'conference'];
    var state = { tab: 'resume', q: 1, allGames: false, school: '' };
    var data = null;

    function tabFromHash() {
        var h = (window.location.hash || '').replace('#', '');
        return TABS.indexOf(h) !== -1 ? h : 'resume';
    }

    function tabs(d) {
        var label = { resume: 'Resume', schedule: 'Schedule', stats: 'Stats', conference: d.team.conference || 'Conference' };
        var list = TABS.filter(function (t) { return t !== 'conference' || (d.standings && d.standings.length && d.team.conference); });
        return kit.tabs(list.map(function (t) { return [t, label[t]]; }), state.tab);
    }

    function panel(d, done) {
        if (state.tab === 'schedule') return schedule(d);
        if (state.tab === 'stats') return efficiency(d) + stats(d);
        if (state.tab === 'conference') return standings(d);
        return nextUp(d) + sheet(d) + splits(done) + standingsPeek(d);
    }

    // Scroll so the panel starts just under the sticky navbar and tabs.
    function toPanelTop() {
        var panel = root.querySelector('.ht-panel'), tabsEl = root.querySelector('.sp-tabs');
        var nav = document.getElementById('navbar');
        var cover = (nav ? nav.getBoundingClientRect().height : 0) + (tabsEl ? tabsEl.getBoundingClientRect().height : 0);
        window.scrollTo(0, Math.max(0, panel.getBoundingClientRect().top + window.pageYOffset - cover - 8));
    }

    function paintPanel() {
        var done = data.games.filter(function (g) { return g.final; });
        var tabsEl = root.querySelector('.sp-tabs');
        if (tabsEl) tabsEl.outerHTML = tabs(data);
        root.querySelector('.ht-panel').innerHTML = panel(data, done);
        fitSchools();
    }

    // A school name that would be cut off becomes its abbreviation.
    function fitSchools() { kit.fitNames(root, '.ht-school-nm[data-abbr]'); }

    function render(d) {
        data = d;
        state.school = d.team.school;
        state.tab = tabFromHash();
        if (state.tab === 'conference' && !(d.standings && d.standings.length)) state.tab = 'resume';
        // Open on the most valuable quadrant that has games in it.
        var withGames = [1, 2, 3, 4].filter(function (q) { return d.games.some(function (g) { return g.quadrant === q; }); });
        state.q = withGames.length ? withGames[0] : 1;
        var done = d.games.filter(function (g) { return g.final; });
        var upcoming = d.games.filter(function (g) { return !g.final; });
        root.innerHTML = hero(d, done) + ownerStrip(d, done, upcoming) + tabs(d)
            + '<div class="ht-panel" role="tabpanel">' + panel(d, done) + '</div>';
        var t = document.querySelector('title');
        if (t) t.setAttribute('data-league-title', d.team.school);
        if (window.ccLeague && window.ccLeague.paint) window.ccLeague.paint();
        fitSchools();
        kit.countUp(root);
    }

    root.addEventListener('click', function (e) {
        if (!data) return;
        var tab = e.target.closest('[data-tab]');
        if (tab) {
            state.tab = tab.getAttribute('data-tab');
            if (window.history && window.history.replaceState) window.history.replaceState(null, '', '#' + state.tab);
            paintPanel();
            // From the peek at the bottom of the Resume, the table would
            // otherwise open scrolled to wherever the peek was.
            if (tab.classList.contains('ht-peek-more')) toPanelTop();
            return;
        }
        var q = e.target.closest('[data-q]');
        if (q) {
            state.q = Number(q.getAttribute('data-q'));
            paintPanel();
            return;
        }
        if (e.target.closest('[data-more="games"]')) {
            state.allGames = !state.allGames;
            paintPanel();
        }
    });

    function load() {
        var id = root.getAttribute('data-team-id');
        return kit.load('/hoops/teams/' + encodeURIComponent(id) + '/page', render, root, 'team');
    }

    // Names are re-fitted when the room changes: a resize, or the webfont
    // swapping in. (The kit keeps the sticky tabs under the navbar.)
    window.addEventListener('resize', function () { if (data) fitSchools(); });
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
        document.fonts.ready.then(function () { if (data) fitSchools(); }).catch(function () {});
    }

    window.ccHoopsTeam = { render: render, load: load, state: state };
    load();
})();
