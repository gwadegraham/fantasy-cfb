// The basketball game page (#503). Renders GET /hoops/games/:id/page.
//
// Scoreboard and setting first; then the fantasy read — each side's own
// quadrant and who banked what — because that is why a manager opens a
// game; then the four factors that explain the score, and the box.

(function () {
    var root = document.getElementById('hoops-game');
    if (!root) return;

    // Formatting, names, dates, tabs and loading come from the shared kit.
    var kit = window.ccSportPage;
    var esc = kit.esc, fixed = kit.fixed, pct = kit.pct, shortNames = kit.shortNames, countdown = kit.countdown;
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
        // Live: "LIVE · 2nd · 8:43" (OT periods named), from the poller (#505).
        var half = function (p) { return p === 1 ? '1st' : p === 2 ? '2nd' : p > 2 ? 'OT' + (p > 3 ? p - 2 : '') : ''; };
        var liveBits = g.live ? [half(g.period), g.clock].filter(Boolean).join(' · ') : '';
        var status = g.final ? 'Final' : d.rescheduled ? 'Rescheduled' : g.live ? 'Live' + (liveBits ? ' · ' + liveBits : '') : null;
        var meta = (status ? '<b' + (g.live ? ' class="live"' : '') + '>' + esc(status) + '</b>' + (!g.live && when(g) ? ' · ' + esc(when(g)) : '') : '<b>' + esc(countdown(g)) + '</b>')
            + (g.tournament ? ' · ' + esc(g.tournament) : g.notes ? ' · ' + esc(g.notes) : '')
            + (place || g.neutralSite ? '<br>' + place + (g.neutralSite ? (place ? ' · ' : '') + 'neutral site' : '') : '');
        var side = function (t) {
            return '<div class="hg-side">' + teamLink(t, (t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : '')
                + '<div class="hg-nm">' + (t.rank ? '<small>' + t.rank + '</small>' : '') + esc(t.school).toUpperCase() + '</div>')
                + (t.record ? '<div class="hg-rec">' + t.record.w + '–' + t.record.l + '</div>' : '') + '</div>';
        };
        var scored = g.final || (g.live && H.points != null && A.points != null);
        var homeWon = scored && H.points > A.points;
        var tied = scored && H.points === A.points;              // live only; a tie dims nobody
        // Away on the left, home on the right — the scoreboard convention,
        // so "@" reads correctly — and the score in the same order. A live
        // score dims the side that is behind, as a final dims the loser.
        var score = scored
            ? '<span class="' + (homeWon ? 'lose' : '') + '">' + A.points + '</span><span class="dash">–</span>'
                + '<span class="' + (homeWon || tied ? '' : 'lose') + '">' + H.points + '</span>'
            : '<span class="vs">' + (g.neutralSite ? 'vs' : '@') + '</span>';
        return '<section class="sp-hero match hg-hero" style="--left:' + esc(A.color || '#343954') + ';--right:' + esc(H.color || '#343954') + '">'
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
        return '<table class="sp-lines"><tr><th></th>' + b.home.byPeriod.map(function (_, i) { return '<th>' + label(i) + '</th>'; }).join('')
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
                // banked null = the nightly scoring has not reached this game
                // yet, which is not the same as banking 0.
                else if (d.game.final && t.banked == null) foot = who + ' · points post overnight';
                else if (d.game.final) foot = '<b data-countup="' + t.banked + '" data-sign="+">' + (t.banked > 0 ? '+' : '') + t.banked + '</b> for ' + who;
                else foot = (t.quadrant && vals[t.quadrant] ? '<b>+' + vals[t.quadrant] + '</b> if won, for ' : 'On ') + who + (t.quadrant && vals[t.quadrant] ? '' : '’s roster');
            }
            return '<div class="hg-fc">' + head + (foot ? '<span class="p">' + foot + '</span>' : '') + '</div>';
        };
        var awayWon = d.game.final && d.away.points > d.home.points;
        return '<div class="hg-fan">' + card(d.away, awayWon) + card(d.home, d.game.final && !awayWon) + '</div>';
    }

    // One comparison row, away left and home right, as football draws them:
    // each side's number, the better one marked, and a bar in each team's
    // own colour. `better` is 'high', 'low' or null (no better side). For
    // 'low' each bar is drawn from the OTHER side's number, so the longer
    // bar is always the better side rather than the bigger number.
    function vsRow(label, sub, aText, hText, a, h, better) {
        var num = function (v) { return typeof v === 'number' && isFinite(v); };
        var both = !!better && num(a) && num(h);
        var aBetter = both && a !== h ? (better === 'high' ? a > h : a < h) : null;
        var bars = '';
        if (both) {
            var wa = Math.abs(better === 'low' ? h : a), wh = Math.abs(better === 'low' ? a : h);
            // Shares of 100: flex-grow values that sum below 1 (two
            // percentages written as fractions) leave the bar half empty.
            var share = wa + wh > 0 ? wa / (wa + wh) : 0.5;
            bars = '<span class="bars"><i style="flex:' + Math.round(share * 1000) / 10 + ';background:' + state.colors.away + '"></i>'
                + '<i style="flex:' + Math.round((1 - share) * 1000) / 10 + ';background:' + state.colors.home + '"></i></span>';
        }
        return '<div class="sp-vs"><span class="l' + (aBetter === true ? ' edge' : '') + '">' + aText + '</span>'
            + '<span class="mid">' + label + (sub ? '<small>' + sub + '</small>' : '') + bars + '</span>'
            + '<span class="r' + (aBetter === false ? ' edge' : '') + '">' + hText + '</span></div>';
    }
    function vsHead(d) {
        return '<div class="sp-vs-head"><span>' + esc(abbr(d.away)) + '</span><span></span><span>' + esc(abbr(d.home)) + '</span></div>';
    }

    // Plain words, as on the team page.
    var FACTORS = [
        { key: 'efgPct', name: 'Shooting', what: 'eFG%', better: 'high' },
        { key: 'tovPct', name: 'Ball security', what: 'turnovers per 100', better: 'low' },
        { key: 'orbPct', name: 'Second chances', what: 'off. rebound %', better: 'high' },
        { key: 'ftRate', name: 'Getting to the line', what: 'FT rate', better: 'high' }
    ];
    function factors(d) {
        var a = d.box.away, h = d.box.home;
        return vsHead(d) + FACTORS.map(function (f) {
            var x = a[f.key], y = h[f.key];
            if (x == null || y == null) return '';
            return vsRow(f.name, f.what, fixed(x, 1), fixed(y, 1), x, y, f.better);
        }).join('');
    }

    // [label, text, the number the bar compares, which way is better]. The
    // shooting lines read "22-52" but compare on the percentage.
    var rate = function (m, a) { return a ? m / a : null; };
    var TEAM_STATS = [
        ['Field goals', function (s) { return ma(s.fgMade, s.fgAtt); }, function (s) { return rate(s.fgMade, s.fgAtt); }, 'high'],
        ['Threes', function (s) { return ma(s.threeMade, s.threeAtt); }, function (s) { return rate(s.threeMade, s.threeAtt); }, 'high'],
        ['Free throws', function (s) { return ma(s.ftMade, s.ftAtt); }, function (s) { return rate(s.ftMade, s.ftAtt); }, 'high'],
        ['Rebounds', null, 'rebounds', 'high'],
        ['Assists', null, 'assists', 'high'],
        ['Turnovers', null, 'turnovers', 'low'],
        ['Points in the paint', null, 'paintPoints', 'high'],
        ['Fast-break points', null, 'fastBreakPoints', 'high'],
        ['Points off turnovers', null, 'pointsOffTurnovers', 'high'],
        ['Largest lead', null, 'largestLead', 'high']
    ];
    function teamStats(d) {
        return TEAM_STATS.map(function (r) {
            var val = typeof r[2] === 'function' ? r[2] : function (s) { return s[r[2]]; };
            var txt = r[1] || function (s) { return fixed(s[r[2]], 0); };
            var a = val(d.box.away), h = val(d.box.home);
            return vsRow(r[0], null, txt(d.box.away), txt(d.box.home), a == null ? null : Number(a), h == null ? null : Number(h), r[3]);
        }).join('');
    }

    function leaders(d) {
        var stat = [['Points', 'points'], ['Rebounds', 'rebounds'], ['Assists', 'assists']];
        var h = '<div class="sp-leaders">';
        stat.forEach(function (s) {
            h += '<div class="sp-ld"><div class="k">' + s[0] + '</div>';
            [['away', d.away], ['home', d.home]].forEach(function (pair) {
                var ps = (d.box[pair[0]].players || []).slice();
                if (!ps.length) return;
                var names = shortNames(ps);
                var top = ps.sort(function (a, b) { return (b[s[1]] || 0) - (a[s[1]] || 0); })[0];
                h += '<div class="sp-ld-row"><span>' + esc(names[top.name]) + ' <small>' + esc(abbr(pair[1])) + '</small></span><b>' + fixed(top[s[1]], 0) + '</b></div>';
            });
            h += '</div>';
        });
        return h + '</div>';
    }

    function boxTable(d) {
        var team = d[state.side], s = d.box[state.side];
        var ps = (s.players || []).slice().sort(function (a, b) { return (b.starter - a.starter) || ((b.minutes || 0) - (a.minutes || 0)); });
        if (!ps.length) return '<div class="sp-card sp-empty">No player lines for ' + esc(team.school) + '.</div>';
        var names = shortNames(ps);
        var high = Math.max.apply(null, ps.map(function (p) { return p.points || 0; }));
        var h = '<div class="sp-card"><table class="hg-box"><tr><th>Player</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>3PT</th><th>FG</th></tr>';
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

    // ---- preview: a game still to play ----------------------------------

    // The matchup predictor, drawn as a court the way football's is drawn
    // as a field: each team's colour in its own lane (away left, home right)
    // and the ball sitting at the home side's win probability measured from
    // the away end — football's rule, so the two read the same. The court is
    // to scale (94 x 50 ft; 19-ft lane, 12 wide; the men's 22.15-ft three).
    function court(colors) {
        var end = function (m) {
            var X = function (x) { return m ? 94 - x : x; };
            var lane = m ? 'x="75" ' : 'x="0" ';
            return '<rect ' + lane + 'y="19" width="19" height="12" fill="' + (m ? colors.home : colors.away) + '" fill-opacity=".85"/>'
                + '<circle cx="' + X(19) + '" cy="25" r="6"/>'
                // Corner threes run 22 ft from the basket, 3 ft in from each
                // sideline, until they meet the 22.15-ft arc at x = 7.79.
                + '<path d="M' + X(0) + ' 3H' + X(7.79) + 'M' + X(0) + ' 47H' + X(7.79) + '"/>'
                + '<path d="M' + X(7.79) + ' 3A22.15 22.15 0 0 ' + (m ? 0 : 1) + ' ' + X(7.79) + ' 47"/>'
                + '<circle cx="' + X(5.25) + '" cy="25" r=".9"/>';
        };
        return '<svg class="hg-court" viewBox="0 0 94 50" preserveAspectRatio="none" aria-hidden="true" fill="none"'
            + ' stroke="rgba(255,255,255,.8)" stroke-width=".5">'
            + '<rect x=".25" y=".25" width="93.5" height="49.5"/><path d="M47 0V50"/><circle cx="47" cy="25" r="6"/>'
            + end(false) + end(true) + '</svg>';
    }
    function winProbability(d) {
        var p = d.preview && d.preview.homeWinProb;
        if (p == null) return '';
        var a = 1 - p;
        var label = d.game.live ? 'Pregame win probability' : 'Matchup predictor';
        return '<h2 class="sp-h">' + label + '</h2><div class="sp-card hg-wp">'
            + '<div class="hg-floor" role="img" aria-label="' + esc(d.away.school) + ' ' + pct(a) + '%, ' + esc(d.home.school) + ' ' + pct(p) + '%"'
            + ' style="--wp:' + p + '">' + court(state.colors) + '<span class="hg-ball" aria-hidden="true">🏀</span></div>'
            + '<div class="hg-wp-head"><span><b>' + pct(a) + '%</b> <span class="nm">' + esc(d.away.school) + '</span></span>'
            + '<span><span class="nm">' + esc(d.home.school) + '</span> <b>' + pct(p) + '%</b></span></div>'
            + '<div class="hg-wp-foot">From Torvik ratings' + (d.game.neutralSite ? ', neutral floor' : ', with home court')
            + (d.game.live ? ', before tip-off — not updated during the game' : '') + '.</div></div>';
    }

    // What is on the line for the managers. Two rostered sides make it a
    // head-to-head between two managers — the most interesting thing about
    // the game to them — so that gets its own framing.
    function stakes(d) {
        var vals = d.quadrantValues;
        if (!vals) return '';
        var p = d.preview && d.preview.homeWinProb;
        var line = function (t, winP) {
            var v = t.quadrant ? vals[t.quadrant] : null;
            var owner = t.owner ? esc(t.owner.franchiseName || t.owner.firstName || 'A manager') : null;
            var q = t.quadrant ? '<span class="hg-q' + (t.quadrant === 1 ? ' q1' : '') + '">Q' + t.quadrant + '</span>'
                : '<span class="hg-q post">' + esc(d.game.tournament || 'Post') + '</span>';
            if (!owner) return '<div class="hg-st-row">' + q + '<span class="who"><b>' + esc(t.school) + '</b> · not on a roster</span></div>';
            // A win that pays nothing (Q4) says so, rather than "+0, expected +0".
            if (v === 0) {
                return '<div class="hg-st-row">' + q + '<span class="who"><b>' + owner + '</b> · ' + esc(t.school) + '</span>'
                    + '<span class="pts zero">no points<small>a Q' + t.quadrant + ' win</small></span></div>';
            }
            var exp = v != null && winP != null ? '<small>expected +' + (Math.round(v * winP * 10) / 10) + '</small>' : '';
            return '<div class="hg-st-row">' + q + '<span class="who"><b>' + owner + '</b> · ' + esc(t.school) + '</span>'
                + '<span class="pts">' + (v != null ? '+' + v : 'ladder') + exp + '</span></div>';
        };
        var both = d.home.owner && d.away.owner;
        var none = !d.home.owner && !d.away.owner;
        if (none) return '';
        return '<h2 class="sp-h">' + (both ? 'Manager matchup' : 'Fantasy stakes') + '<small>Points for a win</small></h2>'
            + '<div class="sp-card hg-stakes">' + line(d.away, p == null ? null : 1 - p) + line(d.home, p) + '</div>';
    }

    function rec(r) { return r ? r.w + '–' + r.l : '—'; }

    // Side by side, away left and home right like the scoreboard. `better`
    // names which way is good so the stronger side can be marked.
    function tape(d) {
        var A = d.preview.away, H = d.preview.home;
        if (!A || !H) return '';
        var rows = [
            ['T-Rank', A.preseason && A.preseason.rank, H.preseason && H.preseason.rank, 'low', function (v) { return '#' + v; }],
            ['Record', A.record, H.record, null, rec],
            ['Conference', A.confRecord, H.confRecord, null, rec],
            ['vs Q1', A.q1Record, H.q1Record, null, rec],
            ['On the road', A.roadRecord, H.roadRecord, null, rec],
            ['Offense', A.preseason && A.preseason.adjOE, H.preseason && H.preseason.adjOE, 'high', function (v) { return fixed(v, 1); }],
            ['Defense', A.preseason && A.preseason.adjDE, H.preseason && H.preseason.adjDE, 'low', function (v) { return fixed(v, 1); }]
        ];
        if (A.stats && H.stats) {
            rows.push(['Points a game', A.stats.ppg, H.stats.ppg, 'high', function (v) { return fixed(v, 1); }]);
            rows.push(['Allowed a game', A.stats.oppPpg, H.stats.oppPpg, 'low', function (v) { return fixed(v, 1); }]);
            rows.push(['Pace', A.stats.pace, H.stats.pace, null, function (v) { return fixed(v, 1); }]);
            rows.push(['Shooting (eFG%)', A.stats.efgPct, H.stats.efgPct, 'high', function (v) { return fixed(v, 1); }]);
            rows.push(['Turnovers / 100', A.stats.tovPct, H.stats.tovPct, 'low', function (v) { return fixed(v, 1); }]);
            rows.push(['Off. rebound %', A.stats.orbPct, H.stats.orbPct, 'high', function (v) { return fixed(v, 1); }]);
            rows.push(['FT rate', A.stats.ftRate, H.stats.ftRate, 'high', function (v) { return fixed(v, 1); }]);
        }
        var out = vsHead(d);
        rows.forEach(function (r) {
            var a = r[1], h = r[2];
            if (a == null && h == null) return;
            // Records ("6–2") are not one number, so they get no bar.
            out += vsRow(r[0], null, a == null ? '—' : r[4](a), h == null ? '—' : r[4](h),
                typeof a === 'number' ? a : null, typeof h === 'number' ? h : null, r[3]);
        });
        var src = A.stats && H.stats ? 'Ratings: Torvik preseason · stats: this season' : 'Torvik preseason ratings · season stats arrive after tip-off';
        return '<h2 class="sp-h">Tale of the tape<small>' + src + '</small></h2><div class="sp-card">' + out + '</div>';
    }

    function form(d) {
        var row = function (t, side) {
            if (!side) return '';
            var chips = side.last5.map(function (g) {
                return '<span class="sp-wl ' + (g.won ? 'w' : 'l') + '" title="' + (g.won ? 'W' : 'L') + ' ' + g.us + '–' + g.them
                    + (g.venue === 'away' ? ' at ' : g.venue === 'neutral' ? ' vs ' : ' vs ') + esc(g.opponent) + '">' + (g.won ? 'W' : 'L') + '</span>';
            }).join('');
            var streak = side.streak ? (side.streak.won ? 'W' : 'L') + side.streak.n : '';
            return '<div class="hg-form-row"><span class="nm">' + esc(abbr(t)) + '</span><span class="chips">'
                + (chips || '<small>No games yet</small>') + '</span><span class="sk">' + streak + '</span></div>';
        };
        if (!d.preview.away && !d.preview.home) return '';
        return '<h2 class="sp-h">Recent form<small>Last five, oldest first</small></h2><div class="sp-card hg-form">'
            + row(d.away, d.preview.away) + row(d.home, d.preview.home) + '</div>';
    }

    function keyPlayers(d) {
        var col = function (t, side) {
            if (!side || !side.topScorers.length) return '';
            var names = shortNames(side.topScorers);
            return '<div class="hg-kp"><div class="k">' + esc(t.school) + '</div>' + side.topScorers.map(function (p) {
                return '<div class="sp-ld-row"><span>' + esc(names[p.name]) + (p.position ? ' <small>' + esc(p.position) + '</small>' : '') + '</span>'
                    + '<b>' + fixed(p.ppg, 1) + '</b></div><div class="hg-kp-sub">' + fixed(p.rpg, 1) + ' reb · ' + fixed(p.apg, 1) + ' ast</div>';
            }).join('') + '</div>';
        };
        var a = col(d.away, d.preview.away), h = col(d.home, d.preview.home);
        if (!a && !h) return '';
        return '<h2 class="sp-h">Key players<small>Points a game, this season</small></h2><div class="hg-kps">' + a + h + '</div>';
    }

    function meetings(d) {
        var m = d.preview.meetings;
        if (!m || !m.length) return '';
        return '<h2 class="sp-h">Earlier this season</h2><div class="sp-card sp-games">' + m.map(function (g) {
            var homeWon = g.homeScore > g.awayScore;
            var p = window.ccKickoff && window.ccKickoff.parts ? window.ccKickoff.parts(g.startDate, g.startTimeTbd) : null;
            return '<a class="sp-gr hg-meet" href="/hoops/game/' + encodeURIComponent(g.id) + '"><span class="d">' + (p ? p.monthShort + ' ' + p.day : '') + '</span>'
                + '<span class="opp">' + esc(abbr(homeWon ? d.home : d.away)) + ' won ' + Math.max(g.homeScore, g.awayScore) + '–' + Math.min(g.homeScore, g.awayScore)
                + (g.notes ? '<span class="note">' + esc(g.notes) + '</span>' : '') + '</span></a>';
        }).join('') + '</div>';
    }

    // An old listing of a game that moved (#498): send them to the real one.
    function moved(d) {
        var r = d.rescheduled, k = window.ccKickoff;
        var p = k && k.parts ? k.parts(r.startDate, r.startTimeTbd) : null;
        return '<p class="hg-moved">This listing is out of date. The game was played '
            + (p ? 'on ' + esc(p.monthShort + ' ' + p.day) + ' ' : 'on another date ')
            + '— <a href="/hoops/game/' + encodeURIComponent(r.id) + '">see the result</a>.</p>';
    }

    function preview(d) {
        if (d.rescheduled) return moved(d);
        if (!d.preview) return '';
        return winProbability(d) + stakes(d) + tape(d) + form(d) + keyPlayers(d) + meetings(d);
    }

    function noBox(d) {
        // Box scores are pulled in a nightly batch (05:00 Central), as football's are.
        // The nightly batch looks back 3 days; past that, a game with no box
        // will not get one, and "check back in the morning" would be untrue.
        var old = Date.now() - new Date(d.game.startDate).getTime() > 3 * 24 * 60 * 60 * 1000;
        var text = !d.game.final ? 'The box score arrives after the final.'
            : old ? 'There’s no box score for this game.'
            : 'The box score lands overnight — check back in the morning.';
        return '<div class="sp-card sp-empty">' + text + '</div>';
    }

    function tabs(d) {
        if (!d.box) return '';
        return kit.tabs([['summary', 'Summary'], ['box', 'Box score']], state.tab);
    }

    function panel(d) {
        if (!d.box) return noBox(d);
        if (state.tab === 'box') {
            var seg = function (key) {
                var t = d[key];
                return '<button type="button" data-side="' + key + '" class="' + (state.side === key ? 'on' : '') + '">'
                    + (t.logo ? '<img src="' + esc(t.logo) + '" alt="">' : '') + esc(t.school) + '</button>';
            };
            return '<div class="sp-seg">' + seg('away') + seg('home') + '</div>' + boxTable(d);
        }
        return '<h2 class="sp-h">Four factors<small>Why it ended ' + d.away.points + '–' + d.home.points + '</small></h2><div class="sp-card">' + factors(d) + '</div>'
            + '<h2 class="sp-h">Team stats' + (d.box.pace ? '<small>' + fixed(d.box.pace, 0) + ' possessions</small>' : '') + '</h2><div class="sp-card">' + teamStats(d) + '</div>'
            + '<h2 class="sp-h">Leaders</h2>' + leaders(d);
    }

    function paintPanel() {
        var t = root.querySelector('.sp-tabs');
        if (t) t.outerHTML = tabs(data);
        root.querySelector('.hg-panel').innerHTML = panel(data);
    }

    function render(d) {
        data = d;
        var h = (window.location.hash || '').replace('#', '');
        state.tab = h === 'box' ? 'box' : 'summary';
        // Open the box on the viewer's own team; failing that, the one side
        // somebody rosters; otherwise the left-hand (away) side, so the toggle
        // reads in the scoreboard's order.
        var mine = function (t) { return !!(t.owner && t.owner.mine); };
        state.colors = kit.matchColors(d.away, d.home);
        state.side = mine(d.home) ? 'home' : mine(d.away) ? 'away'
            : (d.home.owner && !d.away.owner ? 'home' : 'away');
        root.innerHTML = d.game.final
            ? hero(d) + fantasy(d) + tabs(d) + '<div class="hg-panel" role="tabpanel">' + panel(d) + '</div>'
            : hero(d) + '<div class="hg-preview">' + preview(d) + '</div>';
        var title = document.querySelector('title');
        if (title) title.setAttribute('data-league-title', abbr(d.away) + (d.game.neutralSite ? ' vs ' : ' at ') + abbr(d.home));
        if (window.ccLeague && window.ccLeague.paint) window.ccLeague.paint();
        kit.countUp(root);
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

    function load() {
        var id = root.getAttribute('data-game-id');
        return kit.load('/hoops/games/' + encodeURIComponent(id) + '/page', render, root, 'game');
    }

    window.ccHoopsGame = { render: render, load: load, state: state, shortNames: shortNames, countdown: countdown };
    load();
})();
