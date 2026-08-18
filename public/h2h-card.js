// Shared Head-to-Head matchup card (#230). One renderer for the compact
// matchup card — a one-line summary (avatars, names, scores, result / LIVE),
// a win-probability bar, and a tap-to-expand side-by-side team breakdown — so
// the Standings H2H panel and the My Team matchup view stay identical.
//
//   window.ccH2H.matchupCard(game, { byId, youId, week, open })  -> html string
//   window.ccH2H.wire(containerEl)                               -> attach toggles
//
// `game` is one entry from the /standings/h2h payload's schedule[].games:
//   { aId, bId, aScore, bScore, aTeams, bTeams, winner, winP, final, upcoming }
// `byId` maps userId -> manager ({ franchise, name, avatarUrl, initials, color }).
// Pass `youId` to orient that manager to the left and label them "You" (My Team);
// pass `youLabel` to override that label with a name (viewing another's profile);
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

    // Optional link wrappers: a manager avatar/name links to their profile, a
    // team logo/name to the team page. display:contents (h2h-card.css) keeps the
    // card layout unchanged. No id -> no link (e.g. the dev sim's fake rows).
    function manLink(id, inner) { return id != null ? '<a class="h2h-mlink" href="/userHome?user=' + esc(id) + '">' + inner + '</a>' : inner; }
    function teamLink(id, inner) { return id != null ? '<a class="h2h-tlink" href="/team?team=' + esc(id) + '">' + inner + '</a>' : inner; }

    // Kickoffs render in Central, the way every other date in the app does —
    // the payload carries the instant (ISO), not a rendered string. `dated`
    // adds the calendar date, for a week whose games don't all sit on one
    // weekend (see spansWeekends): "Sat 2:00 PM" can't tell Aug 29 from Sep 5.
    var CT = 'America/Chicago';
    function fmtKick(iso, dated) {
        if (!iso) return 'TBD';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return 'TBD';
        var day = d.toLocaleDateString('en-US', dated
            ? { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: CT }
            : { weekday: 'short', timeZone: CT });
        return day + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CT });
    }
    // Does this matchup's slate straddle more than one weekend? Only then is the
    // date worth the width. A team playing twice in an API week is exactly the
    // case that needs it.
    function spansWeekends(teams) {
        var ts = (teams || []).map(function (t) { return t.kickoff ? Date.parse(t.kickoff) : NaN; })
            .filter(function (n) { return !isNaN(n); });
        if (ts.length < 2) return false;
        return (Math.max.apply(null, ts) - Math.min.apply(null, ts)) > 3 * 864e5;
    }
    // A team's value: final points, LIVE, or kickoff time.
    function teamVal(t, dated) {
        return t.status === 'live' ? '<span class="h2h-tv live">LIVE</span>'
            : t.status === 'scheduled' ? '<span class="h2h-tv sched">' + esc(fmtKick(t.kickoff, dated)) + '</span>'
            : '<span class="h2h-tv">' + (t.score != null ? t.score : 0) + '</span>';
    }
    // One team row; the right column mirrors (value → name → logo) so both teams'
    // scores hug the center divider, like a Sleeper matchup.
    function teamRow(t, right, dated) {
        var img = teamLink(t.teamId, '<img class="h2h-tlogo" src="' + esc(t.logo) + '" alt="">');
        // Captain doubles this team's points — mark it so the inflated score reads.
        var cap = t.captain ? '<span class="h2h-capx" title="Captain — points doubled">★2×</span>' : '';
        var tnm = teamLink(t.teamId, '<span class="h2h-tnm"><span class="tnm-full">' + esc(t.school) + '</span><span class="tnm-abbr">' + esc(t.abbr || t.school) + '</span></span>');
        var nm = '<span class="h2h-tnmline">' + tnm + cap + '</span>';
        var sub = t.opp
            ? '<span class="h2h-tsub">' + esc(t.ha) + ' ' + esc(t.opp) + (t.status === 'final' && t.gameScore ? ' · ' + esc(t.gameScore) : '') + '</span>'
            : '';
        var idcol = '<span class="h2h-tid">' + nm + sub + '</span>';
        return right ? '<div class="h2h-trow">' + teamVal(t, dated) + idcol + img + '</div>'
            : '<div class="h2h-trow">' + img + idcol + teamVal(t, dated) + '</div>';
    }
    // Final weeks show only teams that scored; an unplayed week (live or still
    // to come) shows every team with a game, so in-progress and upcoming ones
    // are visible with their kickoff times instead of being mistaken for 0.
    function teamList(teams, unplayed, right, dated) {
        var list = unplayed ? (teams || []) : (teams || []).filter(function (t) { return t.score > 0; });
        return list.length ? list.map(function (t) { return teamRow(t, right, dated); }).join('')
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
            final: g.final, upcoming: g.upcoming
        };
    }

    function matchupCard(game, opts) {
        opts = opts || {};
        var g = orient(game, opts.youId);
        var byId = opts.byId || {};
        var A = byId[g.aId], B = byId[g.bId];
        var youLeft = opts.youId && g.aId === opts.youId;
        // Callers viewing someone else's profile pass youLabel (that manager's
        // name); default keeps the first-person "You" for the viewer's own pages.
        var aName = youLeft ? (opts.youLabel || 'You') : nameOf(A);
        var bName = nameOf(B);
        // Three states, not two: a week that hasn't kicked off yet is neither
        // final nor live. It shows the same per-team view as a live week (so
        // kickoff times are visible) but reads as a preview — no LIVE badge, and
        // no 0-0 scoreline pretending the matchup is already under way.
        var upcoming = !!g.upcoming;
        var live = g.final === false && !upcoming;
        var unplayed = live || upcoming;
        var score = function (v) { return upcoming ? '&ndash;' : v; };
        var both = (g.aTeams || []).concat(g.bTeams || []);
        var dated = spansWeekends(both);
        var remaining = both.filter(function (t) { return t.status && t.status !== 'final'; }).length;
        var sep = live ? '<span class="h2h-mlive">LIVE</span>' : (g.winner === 'tie' ? 'T' : 'vs');
        var wk = opts.week != null ? '<span class="h2h-mwk">Wk ' + opts.week + '</span>' : '';
        return '<div class="h2h-mcard' + (live ? ' live' : '') + (upcoming ? ' upcoming' : '') + (opts.open ? ' open' : '') + '">'
            + '<div class="h2h-msum" role="button" tabindex="0" aria-expanded="' + (opts.open ? 'true' : 'false') + '">'
            + wk
            + '<div class="h2h-mside' + (g.winner === 'a' ? ' win' : '') + '">' + manLink(g.aId, avatar(A) + '<span class="h2h-mnm">' + aName + '</span>') + '<span class="h2h-msc">' + score(g.aScore) + '</span></div>'
            + '<span class="h2h-msep">' + sep + '</span>'
            + '<div class="h2h-mside r' + (g.winner === 'b' ? ' win' : '') + '"><span class="h2h-msc">' + score(g.bScore) + '</span>' + manLink(g.bId, '<span class="h2h-mnm">' + bName + '</span>' + avatar(B)) + '</div>'
            + '<i class="fa-solid fa-chevron-down h2h-mcaret" aria-hidden="true"></i>'
            + '</div>'
            + winBar(g)
            + '<div class="h2h-mdetail">'
            + '<div class="h2h-mdcol"><span class="h2h-mdcap">' + aName + '</span>' + teamList(g.aTeams, unplayed, false, dated) + '</div>'
            + '<div class="h2h-mdcol right"><span class="h2h-mdcap">' + bName + '</span>' + teamList(g.bTeams, unplayed, true, dated) + '</div>'
            + pregameLine(g, aName, bName)
            + (live ? '<div class="h2h-mfoot">In progress · ' + remaining + ' game' + (remaining === 1 ? '' : 's') + ' to play · scores update as they finish</div>' : '')
            + (upcoming ? '<div class="h2h-mfoot">Not started · ' + remaining + ' game' + (remaining === 1 ? '' : 's') + ' scheduled · odds are projected</div>' : '')
            + '</div></div>';
    }

    function wire(container) {
        if (!container) return;
        container.querySelectorAll('.h2h-msum').forEach(function (sum) {
            if (sum.dataset.wired) return;
            sum.dataset.wired = '1';
            var toggle = function (e) {
                // Let clicks/keys on an inner link (manager / team) navigate
                // instead of toggling the card.
                if (e && e.target && e.target.closest && e.target.closest('a')) return;
                var open = sum.closest('.h2h-mcard').classList.toggle('open');
                sum.setAttribute('aria-expanded', String(open));
            };
            sum.addEventListener('click', toggle);
            sum.addEventListener('keydown', function (e) { if (e.target && e.target.closest && e.target.closest('a')) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } });
        });
    }

    window.ccH2H = { matchupCard: matchupCard, wire: wire, avatar: avatar, nameOf: nameOf };
})();
