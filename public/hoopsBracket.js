// The March Madness bracket page (/hoops/bracket). Renders the payload of
// GET /hoops/bracket/data (routes/hoopsBracket.js, modules/hoops-march-bracket.js):
// before Selection Sunday, the bracket date, each team's chance to make the
// field and what March pays in this league; after it, the bracket by region
// with the league's owners and their banked points.
//
// Every number here comes from the payload. The pay table is the league's
// own config and a team's points are what its owner banked — this file does
// no scoring arithmetic of its own.

(function (global) {
    'use strict';

    var root = document.getElementById('march-bracket');
    if (!root) return;
    var kit = global.ccSportPage;
    var esc = kit.esc;

    var ROUND_NAMES = { ff: 'Opening Round', r64: 'Round of 64', r32: 'Round of 32', s16: 'Sweet 16', e8: 'Elite Eight', f4: 'Final Four', title: 'Title game' };
    var NEXT = { ff: 'r64', r64: 'r32', r32: 's16', s16: 'e8', e8: 'f4', f4: 'title', title: 'champ' };
    var FILTERS = [['all', 'All teams'], ['league', 'On a roster'], ['mine', 'My teams']];

    var data = null;
    var state = { season: null, tab: null, filter: 'all' };

    function leagueCode() { return typeof global.ccLeagueCode === 'function' ? global.ccLeagueCode() : ''; }
    function leagueName() {
        try { return (global.ccLeague && global.ccLeague.name && global.ccLeague.name()) || ''; } catch (e) { return ''; }
    }

    function load() {
        var q = [];
        var lc = leagueCode();
        if (lc) q.push('league=' + encodeURIComponent(lc));
        if (state.season) q.push('season=' + encodeURIComponent(state.season));
        kit.load('/hoops/bracket/data' + (q.length ? '?' + q.join('&') : ''), function (body) {
            data = body;
            state.season = body.season;
            render();
        }, root, 'bracket');
    }

    // ---- small helpers ----------------------------------------------------

    function pts(n) { return n > 0 ? '+' + n : String(n || 0); }
    function roundName(r) { return r === 'ff' ? data.openingLabel : ROUND_NAMES[r]; }
    function rung(key) {
        var r = (data.pay.rungs || []).filter(function (x) { return x.key === key; })[0];
        return r ? r.points : 0;
    }
    function team(id) { return id != null && data.teams ? data.teams[id] : null; }
    function isMine(t) { return !!(t && t.owner && t.owner.isMe); }
    function inLeague(t) { return !!(t && t.owner); }
    function sideTeam(s) { return s && s.id != null ? team(s.id) : null; }
    function passes(g) {
        if (state.filter === 'all') return true;
        var f = state.filter === 'mine' ? isMine : inLeague;
        return f(sideTeam(g.a)) || f(sideTeam(g.b));
    }
    function shortDate(iso) {
        var d = new Date(iso + 'T12:00:00Z');
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    function logoHtml(t) {
        if (t && t.logo) return '<img class="mmb-lg" src="' + esc(t.logo) + '" alt="" loading="lazy">';
        var name = (t && (t.abbr || t.name)) || '?';
        return '<span class="mmb-lg mmb-lg-txt">' + esc(name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()) + '</span>';
    }
    function ownerChip(o) {
        if (!o) return '';
        return '<span class="mmb-own' + (o.isMe ? ' me' : '') + '" title="' + esc(o.franchise || o.name || '') + '">'
            + (o.isMe ? 'You' : esc(o.initials || '?')) + '</span>';
    }

    // ---- a game -----------------------------------------------------------

    function teamRow(s, g) {
        if (!s) return '<div class="mmb-t"><span class="sd"></span><span class="nm tbd">TBD</span></div>';
        if (s.tbd) {
            var names = s.tbd.map(function (id) { var t = team(id); return t ? t.name : '?'; }).join(' / ');
            return '<div class="mmb-t"><span class="sd">' + (s.seed || '') + '</span><span class="nm tbd">' + esc(names) + '</span></div>';
        }
        var t = team(s.id) || { name: '?' };
        var cls = g.winner != null ? (g.winner === s.id ? ' win' : ' lose') : '';
        var sc = s.score != null ? '<span class="sc">' + s.score + '</span>' : '';
        var p = t.owner && t.points ? '<span class="mmb-pts">' + pts(t.points) + '</span>' : '';
        return '<button type="button" class="mmb-t' + cls + '" data-team="' + s.id + '">'
            + '<span class="sd">' + (s.seed != null ? s.seed : '') + '</span>' + logoHtml(t)
            + '<span class="nm">' + esc(t.name || '?') + '</span>' + ownerChip(t.owner) + sc + p + '</button>';
    }

    function statusHtml(g) {
        if (g.state === 'live') return '<span class="lv">● LIVE' + (g.clock ? ' ' + esc(g.clock) : '') + '</span>';
        if (g.state === 'final') return '<span>FINAL</span>';
        if (!g.startDate) return '<span>TBD</span>';
        var k = global.ccKickoff;
        var p = k && k.parts ? k.parts(g.startDate, g.startTimeTbd) : null;
        if (!p) return '<span>TBD</span>';
        return '<span>' + esc(p.weekdayLong.slice(0, 3) + ' ' + p.monthShort + ' ' + p.day + ' · ' + k.time(g.startDate, g.startTimeTbd, 'spaced')) + '</span>';
    }

    function gameHtml(g, label) {
        var mine = isMine(sideTeam(g.a)) || isMine(sideTeam(g.b));
        var link = g.id != null ? '<a class="mmb-glink" href="/hoops/game/' + g.id + '">Game</a>' : '';
        return '<div class="mmb-g' + (g.state === 'live' ? ' live' : '') + (mine ? ' mine' : '') + (passes(g) ? '' : ' dim') + '">'
            + '<div class="mmb-gh">' + (label ? '<span class="lb">' + esc(label) + '</span>' : '') + statusHtml(g) + link + '</div>'
            + teamRow(g.a, g) + teamRow(g.b, g) + '</div>';
    }

    // ---- before Selection Sunday ----------------------------------------

    function payHtml() {
        return '<div class="mmb-sec">What March pays in this league</div><div class="sp-card mmb-card"><table class="mmb-pay">'
            + data.pay.rungs.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td>' + pts(r.points) + '</td></tr>'; }).join('')
            + '<tr><td>Upset bonus, per seed line beaten</td><td>' + pts(data.pay.upsetPerSeed) + '</td></tr></table>'
            + '<div class="mmb-sub mmb-note">Every round reached pays, win or lose. Captain and head-to-head don\'t apply in March.</div></div>';
    }

    function preHtml() {
        var d = data.dates;
        var o = data.outlook || { teams: [] };
        var rows = o.teams.map(function (t) {
            var pc = Math.round(t.field * 100);
            var via = t.opening >= 0.05 && t.field < 0.9 ? 'about ' + Math.round(t.opening * 100) + '% via the ' + data.openingLabel : '';
            var who = !o.mine && t.owner ? (t.owner.isMe ? 'You' : t.owner.name) : '';
            var sub = [who, t.rank ? 'preseason #' + t.rank : '', via].filter(Boolean).join(' · ');
            return '<a class="mmb-row" href="/hoops/team/' + t.id + '">' + logoHtml(t)
                + '<span class="nm">' + esc(t.name || '?') + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>'
                + '<span class="mmb-bar"><i style="width:' + pc + '%"></i></span><span class="pc">' + pc + '%</span></a>';
        }).join('');
        return '<div class="sp-card mmb-card"><h3>The bracket is set Sunday, ' + esc(shortDate(d.selection).replace(/^\w+, /, '')) + '</h3>'
            + '<div class="mmb-sub">' + esc(data.openingLabel) + ' ' + esc(shortDate(d.openingStart)) + '–' + esc(shortDate(d.openingEnd).replace(/^\w+, \w+ /, ''))
            + ' · Round of 64 ' + esc(shortDate(d.r64Start)) + ' · Final Four ' + esc(shortDate(d.finalFour)) + ' · title game ' + esc(shortDate(d.title)) + '</div></div>'
            + '<div class="mmb-sec">' + (o.mine ? 'Your teams’ March outlook' : 'The league’s March outlook')
            + '<small>chance to make the field, from the projection</small></div>'
            + (rows ? '<div class="sp-card mmb-card">' + rows + '</div>'
                : '<div class="sp-card sp-empty">' + (data.league ? 'No teams on a roster yet.' : 'Pick a basketball league to see its teams.') + '</div>')
            + payHtml();
    }

    // ---- the tournament ---------------------------------------------------

    function liveIn(tab) {
        var list = tabGames(tab);
        return list.some(function (g) { return g.state === 'live'; });
    }
    function tabGames(tab) {
        if (tab === 'opening') return data.opening;
        if (tab === 'final') return data.finalFour.concat([data.title]);
        var r = data.regions[tab];
        return r ? [].concat(r.r64, r.r32, r.s16, r.e8) : [];
    }

    function regionHtml(region) {
        var r = data.regions[region];
        return '<div class="mmb-hint"><span class="mmb-swipe">Swipe for later rounds. </span>Tap a team for its March points.</div>'
            + '<div class="mmb-scroll"><div class="mmb-grid">' + ['r64', 'r32', 's16', 'e8'].map(function (rd) {
                return '<div class="mmb-col"><div class="mmb-colh">' + ROUND_NAMES[rd] + '<small>a win → ' + pts(rung(NEXT[rd])) + '</small></div>'
                    + '<div class="mmb-slots">' + r[rd].map(function (g) { return gameHtml(g); }).join('') + '</div></div>';
            }).join('') + '</div></div>';
    }

    function openingHtml() {
        var games = data.opening;
        var sec = function (kind, title) {
            var list = games.filter(function (g) { return g.kind === kind; });
            if (!list.length) return '';
            var lines = list.map(function (g) { return g.seedLine; }).filter(function (v, i, a) { return v != null && a.indexOf(v) === i; })
                .sort(function (a, b) { return a - b; });
            return '<div class="mmb-sec">' + title + '<small>' + list.length + ' game' + (list.length === 1 ? '' : 's')
                + (lines.length ? ' · ' + lines.join(' and ') + ' line' + (lines.length === 1 ? '' : 's') : '') + '</small></div><div class="mmb-list">'
                + list.map(function (g) { return gameHtml(g, [g.region, g.seedLine != null ? g.seedLine + ' line' : ''].filter(Boolean).join(' · ')); }).join('') + '</div>';
        };
        var ff = rung('ff'), r64 = rung('r64');
        return '<div class="mmb-hint">' + games.length + ' game' + (games.length === 1 ? '' : 's') + '. Winners take their seed line in the Round of 64. '
            + 'A game here pays ' + pts(ff) + ' in this league; reaching the Round of 64 pays ' + pts(r64) + '.</div>'
            + sec('aq', 'Automatic qualifiers') + sec('al', 'At-large');
    }

    function finalHtml() {
        var c = team(data.champion);
        return '<div class="mmb-sec">Final Four<small>a win → ' + pts(rung('title')) + '</small></div><div class="mmb-list">'
            + data.finalFour.map(function (g) { return gameHtml(g, g.label); }).join('') + '</div>'
            + '<div class="mmb-sec">National title game<small>a win → ' + pts(rung('champ')) + '</small></div><div class="mmb-list">' + gameHtml(data.title) + '</div>'
            + (c ? '<button type="button" class="mmb-champ" data-team="' + c.id + '"><div class="k">National champion</div>'
                + '<div class="t">' + logoHtml(c) + esc((c.name || '').toUpperCase()) + '</div>'
                + '<div class="mmb-sub">' + (c.owner ? esc(c.owner.isMe ? 'You' : (c.owner.franchise || c.owner.name)) + ' · ' + pts(c.points) + ' in March' : 'Not on a roster') + '</div></button>' : '');
    }

    function tabsList() {
        var list = [];
        if (data.opening.length) list.push(['opening', data.openingLabel === 'Opening Round' ? 'Opening' : 'First Four']);
        data.regionOrder.forEach(function (r) { list.push([r, r]); });
        list.push(['final', 'Final Four']);
        return list;
    }

    function bracketHtml() {
        var s = data.summary;
        var tabs = tabsList();
        if (!state.tab || !tabs.some(function (t) { return t[0] === state.tab; })) {
            // The first region with a live game, else the first region.
            var live = tabs.filter(function (t) { return liveIn(t[0]); })[0];
            state.tab = live ? live[0] : (data.regionOrder[0] || tabs[0][0]);
        }
        return '<div class="mmb-me">'
            + '<div class="mmb-stat"><div class="n">' + s.field + '</div><div class="l">Yours in the field</div></div>'
            + '<div class="mmb-stat"><div class="n">' + s.alive + '</div><div class="l">Still alive</div></div>'
            + '<div class="mmb-stat"><div class="n acc">' + pts(s.points) + '</div><div class="l">March points</div></div></div>'
            + '<div class="sp-tabs mmb-tabs" role="tablist">' + tabs.map(function (t) {
                return '<button type="button" role="tab" class="sp-tab' + (t[0] === state.tab ? ' on' : '') + '" data-tab="' + esc(t[0]) + '" aria-selected="' + (t[0] === state.tab) + '">'
                    + esc(t[1]) + (liveIn(t[0]) ? '<span class="mmb-dot" aria-hidden="true"></span><span class="mmb-sr"> (live)</span>' : '') + '</button>';
            }).join('') + '</div>'
            + '<div class="mmb-filters">' + FILTERS.map(function (f) {
                return '<button type="button" class="mmb-chip' + (state.filter === f[0] ? ' on' : '') + '" data-filter="' + f[0] + '">' + f[1] + '</button>';
            }).join('') + '</div>'
            + (state.tab === 'opening' ? openingHtml() : state.tab === 'final' ? finalHtml() : regionHtml(state.tab));
    }

    function render() {
        var name = leagueName();
        var head = (name ? '<p class="mmb-eyebrow">' + esc(name) + '</p>' : '')
            + '<h1 class="mmb-title">March Madness</h1>'
            + '<p class="mmb-sub">' + data.season + ' NCAA Tournament'
            + (data.state === 'bracket' ? ' · ' + Object.keys(data.teams).length + ' teams' : '') + '</p>'
            + (data.seasons && data.seasons.length > 1 ? '<div class="mmb-seasons">' + data.seasons.map(function (y) {
                return '<button type="button" class="mmb-pill' + (y === data.season ? ' on' : '') + '" data-season="' + y + '">' + y + '</button>';
            }).join('') + '</div>' : '')
            + (!data.league ? '<div class="mmb-sub mmb-note">Not viewing a basketball league: no owners shown, default scoring.</div>' : '');
        root.innerHTML = head + (data.state === 'pre' ? preHtml() : bracketHtml());
        kit.syncStickyTop();
        // Six tabs overflow a phone: keep the chosen one in view (sideways
        // only — scrollIntoView would also move the page).
        var bar = root.querySelector('.mmb-tabs'), on = bar && bar.querySelector('.sp-tab.on');
        if (on && (on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth || on.offsetLeft < bar.scrollLeft)) {
            bar.scrollLeft = on.offsetLeft - 16;
        }
    }

    // ---- the team sheet ---------------------------------------------------

    var sheet = document.getElementById('mmb-sheet');
    var sheetBody = document.getElementById('mmb-sheet-body');
    var lastFocus = null;

    function openSheet(id) {
        var t = team(id);
        if (!t) return;
        var o = t.owner;
        var rows = t.games.map(function (g) {
            var opp = team(g.oppId);
            var head = '<tr class="hd"><td colspan="2"><a href="/hoops/game/' + g.gameId + '">' + esc(roundName(g.round)) + ' · '
                + (g.won ? 'W' : 'L') + ' ' + g.score[0] + '–' + g.score[1] + ' vs ' + esc((opp && opp.name) || '?') + '</a></td></tr>';
            var lines = g.lines.map(function (l) { return '<tr><td>' + esc(l.label) + '</td><td>' + pts(l.points) + '</td></tr>'; }).join('');
            var note = '';
            if (g.bankedElsewhere) note = '<tr class="nt"><td colspan="2">Banked to the team\u2019s owner at the time</td></tr>';
            else if (o && g.banked == null) note = '<tr class="nt"><td colspan="2">Not banked yet</td></tr>';
            else if (o && g.banked !== g.rulesTotal) note = '<tr class="nt"><td colspan="2">Banked ' + pts(g.banked) + ' (scored under the rules at the time)</td></tr>';
            return head + (lines || '<tr><td>Nothing under this league’s rules</td><td>0</td></tr>') + note;
        }).join('');
        var who = o ? (o.isMe ? 'Yours' : esc(o.franchise || o.name)) + (o.isMe && o.franchise ? ' · ' + esc(o.franchise) : '') : 'Not on a roster in this league';
        sheetBody.innerHTML = '<h3 id="mmb-sheet-title">' + esc((t.name || '').toUpperCase()) + '</h3>'
            + '<div class="mmb-who">' + (t.seed != null ? t.seed + ' seed' + (t.region ? ', ' + esc(t.region) : '') + ' · ' : '') + who + '</div>'
            + (t.games.length
                ? '<table class="mmb-pay">' + rows
                    + (o ? '<tr class="tot"><td>March total</td><td>' + pts(t.points) + '</td></tr>'
                        : '<tr class="nt"><td colspan="2">No one in this league banked these.</td></tr>') + '</table>'
                : '<div class="mmb-sub">No games played yet.</div>')
            + '<a class="mmb-teamlink" href="/hoops/team/' + t.id + (data.seasons && data.seasons[0] !== data.season ? '?season=' + data.season : '') + '">Team page →</a>';
        lastFocus = document.activeElement;
        sheet.hidden = false;
        var x = sheet.querySelector('.mmb-sheet-x');
        if (x) x.focus();
    }
    function closeSheet() {
        sheet.hidden = true;
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener('click', function (e) {
        var el = e.target.closest('[data-season],[data-tab],[data-filter],[data-team],[data-close]');
        if (!el || !data) return;
        if (el.closest('#march-bracket') && el.dataset.season) {
            state.season = Number(el.dataset.season);
            state.tab = null;
            load();
        } else if (el.closest('#march-bracket') && el.dataset.tab) { state.tab = el.dataset.tab; render(); }
        else if (el.dataset.filter) { state.filter = el.dataset.filter; render(); }
        else if (el.dataset.team) openSheet(Number(el.dataset.team));
        else if (el.hasAttribute('data-close')) closeSheet();
    });
    // A modal sheet: Escape closes it, and Tab stays inside it.
    document.addEventListener('keydown', function (e) {
        if (sheet.hidden) return;
        if (e.key === 'Escape') { closeSheet(); return; }
        if (e.key !== 'Tab') return;
        var f = [].slice.call(sheet.querySelectorAll('a[href], button'));
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    });

    load();
})(window);
