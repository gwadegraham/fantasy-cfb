// Shared Head-to-Head matchup card (#230). One renderer for the compact
// matchup card — a one-line summary (avatars, names, scores, result / LIVE),
// a win-probability bar, and a tap-to-expand side-by-side team breakdown — so
// the Standings H2H panel and the My Team matchup view stay identical.
//
//   window.ccH2H.matchupCard(game, { byId, youId, week, open })  -> html string
//   window.ccH2H.wire(containerEl)                               -> attach toggles
//
// `game` is one entry from the /standings/h2h payload's schedule[].games:
//   { aId, bId, aScore, bScore, aTeams, bTeams, winner, winP, final }
// `byId` maps userId -> manager ({ franchise, name, avatarUrl, initials, color }).
// Pass `youId` to orient that manager to the left and label them "You" (My Team);
// omit it for the neutral two-manager view (Standings). `week` shows a "Wk N"
// tag; `open` starts the card expanded (used for the featured matchup).
(function () {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function avatar(m) {
        if (m && m.avatarUrl) {
            var src = m.avatarUrl.indexOf('/upload/') !== -1
                ? m.avatarUrl.replace('/upload/', '/upload/c_fill,g_face,w_48,h_48,q_auto,f_auto/') : m.avatarUrl;
            return '<span class="h2h-av"><img src="' + esc(src) + '" alt=""></span>';
        }
        return '<span class="h2h-av initials" style="background:' + ((m && m.color) || '#333') + '">' + esc((m && m.initials) || '?') + '</span>';
    }
    function nameOf(m) { return esc((m && (m.franchise || m.name)) || '—'); }

    // A team's value: final points, LIVE, or kickoff time.
    function teamVal(t) {
        return t.status === 'live' ? '<span class="h2h-tv live">LIVE</span>'
            : t.status === 'scheduled' ? '<span class="h2h-tv sched">' + esc(t.kickoff || 'TBD') + '</span>'
            : '<span class="h2h-tv">' + (t.score != null ? t.score : 0) + '</span>';
    }
    // One team row; the right column mirrors (value → name → logo) so both teams'
    // scores hug the center divider, like a Sleeper matchup.
    function teamRow(t, right) {
        var img = '<img class="h2h-tlogo" src="' + esc(t.logo) + '" alt="">';
        // Captain doubles this team's points — mark it so the inflated score reads.
        var cap = t.captain ? '<span class="h2h-capx" title="Captain — points doubled">★2×</span>' : '';
        var nm = '<span class="h2h-tnmline"><span class="h2h-tnm"><span class="tnm-full">' + esc(t.school) + '</span><span class="tnm-abbr">' + esc(t.abbr || t.school) + '</span></span>' + cap + '</span>';
        var sub = t.opp
            ? '<span class="h2h-tsub">' + esc(t.ha) + ' ' + esc(t.opp) + (t.status === 'final' && t.gameScore ? ' · ' + esc(t.gameScore) : '') + '</span>'
            : '';
        var idcol = '<span class="h2h-tid">' + nm + sub + '</span>';
        return right ? '<div class="h2h-trow">' + teamVal(t) + idcol + img + '</div>'
            : '<div class="h2h-trow">' + img + idcol + teamVal(t) + '</div>';
    }
    // Final weeks show only teams that scored; a live week shows every team with
    // a game (so upcoming/in-progress ones are visible, not mistaken for 0).
    function teamList(teams, live, right) {
        var list = live ? (teams || []) : (teams || []).filter(function (t) { return t.score > 0; });
        return list.length ? list.map(function (t) { return teamRow(t, right); }).join('')
            : '<div class="h2h-trow empty">no points</div>';
    }
    // Bar values: a finished matchup is settled (100/0 to the winner, tie 50/50);
    // an in-progress one shows the live/projected odds. null when nothing to show.
    function barVals(g) {
        if (g.final) return g.winner === 'a' ? { a: 100, b: 0 } : g.winner === 'b' ? { a: 0, b: 100 } : { a: 50, b: 50 };
        return g.winP ? { a: g.winP.a, b: g.winP.b } : null;
    }
    function winBar(g) {
        var v = barVals(g);
        if (!v) return '';
        var tone = function (mine, other) { return mine > other ? 'fav' : mine < other ? 'dog' : 'even'; };
        return '<div class="h2h-mbar" role="img" aria-label="Win probability ' + v.a + '% versus ' + v.b + '%">'
            + '<span class="h2h-mbpct ' + tone(v.a, v.b) + '">' + v.a + '%</span>'
            + '<div class="h2h-mbtrack">'
            + '<span class="h2h-mbfill ' + tone(v.a, v.b) + '" style="width:' + v.a + '%"></span>'
            + '<span class="h2h-mbfill r ' + tone(v.b, v.a) + '" style="width:' + v.b + '%"></span>'
            + '</div>'
            + '<span class="h2h-mbpct ' + tone(v.b, v.a) + '">' + v.b + '%</span></div>';
    }
    // Retrospective flavor on finished matchups: what the pre-game odds were.
    function pregameLine(g, aName, bName) {
        if (!g.final || !g.winP) return '';
        var favA = g.winP.a >= g.winP.b;
        var pct = favA ? g.winP.a : g.winP.b;
        if (pct <= 50) return '<div class="h2h-mpre">Pre-game: even matchup</div>';
        return '<div class="h2h-mpre">Pre-game odds: <b>' + pct + '%</b> ' + (favA ? aName : bName) + '</div>';
    }
    // Flip a game so `youId` sits on the A/left side.
    function orient(g, youId) {
        if (!youId || g.aId === youId || g.bId !== youId) return g;
        return {
            aId: g.bId, bId: g.aId, aScore: g.bScore, bScore: g.aScore,
            aTeams: g.bTeams, bTeams: g.aTeams,
            winner: g.winner === 'a' ? 'b' : g.winner === 'b' ? 'a' : g.winner,
            winP: g.winP ? { a: g.winP.b, b: g.winP.a } : g.winP,
            final: g.final
        };
    }

    function matchupCard(game, opts) {
        opts = opts || {};
        var g = orient(game, opts.youId);
        var byId = opts.byId || {};
        var A = byId[g.aId], B = byId[g.bId];
        var youLeft = opts.youId && g.aId === opts.youId;
        var aName = youLeft ? 'You' : nameOf(A);
        var bName = nameOf(B);
        var live = g.final === false;
        var remaining = (g.aTeams || []).concat(g.bTeams || []).filter(function (t) { return t.status && t.status !== 'final'; }).length;
        var sep = live ? '<span class="h2h-mlive">LIVE</span>' : (g.winner === 'tie' ? 'T' : 'vs');
        var wk = opts.week != null ? '<span class="h2h-mwk">Wk ' + opts.week + '</span>' : '';
        return '<div class="h2h-mcard' + (live ? ' live' : '') + (opts.open ? ' open' : '') + '">'
            + '<div class="h2h-msum" role="button" tabindex="0" aria-expanded="' + (opts.open ? 'true' : 'false') + '">'
            + wk
            + '<div class="h2h-mside' + (g.winner === 'a' ? ' win' : '') + '">' + avatar(A) + '<span class="h2h-mnm">' + aName + '</span><span class="h2h-msc">' + g.aScore + '</span></div>'
            + '<span class="h2h-msep">' + sep + '</span>'
            + '<div class="h2h-mside r' + (g.winner === 'b' ? ' win' : '') + '"><span class="h2h-msc">' + g.bScore + '</span><span class="h2h-mnm">' + bName + '</span>' + avatar(B) + '</div>'
            + '<i class="fa-solid fa-chevron-down h2h-mcaret" aria-hidden="true"></i>'
            + '</div>'
            + winBar(g)
            + '<div class="h2h-mdetail">'
            + '<div class="h2h-mdcol"><span class="h2h-mdcap">' + aName + '</span>' + teamList(g.aTeams, live, false) + '</div>'
            + '<div class="h2h-mdcol right"><span class="h2h-mdcap">' + bName + '</span>' + teamList(g.bTeams, live, true) + '</div>'
            + pregameLine(g, aName, bName)
            + (live ? '<div class="h2h-mfoot">In progress · ' + remaining + ' game' + (remaining === 1 ? '' : 's') + ' to play · scores update as they finish</div>' : '')
            + '</div></div>';
    }

    function wire(container) {
        if (!container) return;
        container.querySelectorAll('.h2h-msum').forEach(function (sum) {
            if (sum.dataset.wired) return;
            sum.dataset.wired = '1';
            var toggle = function () {
                var open = sum.closest('.h2h-mcard').classList.toggle('open');
                sum.setAttribute('aria-expanded', String(open));
            };
            sum.addEventListener('click', toggle);
            sum.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
        });
    }

    window.ccH2H = { matchupCard: matchupCard, wire: wire, avatar: avatar, nameOf: nameOf };
})();
