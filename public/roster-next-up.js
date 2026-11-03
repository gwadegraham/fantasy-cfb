// My Team's Roster tile before any points are banked (#638).
//
// "Roster · top performers" has nothing to rank until a game is scored, so on
// opening day it read only "Your 10 teams". Until then the tile says what is
// coming instead: one compact row per team with a game still to play this week,
// Captain first, then in tip order —
//
//     [your logo] [2×, your Captain only] vs [their logo] · Tue 7:00PM
//
// Logos, not school names: two names per row do not fit a phone's width, and
// the drawer one tap away has them in full. The first few rows, then "+N more".
//
// Games are the basketball week payload's shape (GET /hoops/games/teams/…,
// shaped by the scoreboard): { id, state, startDate, startTimeTbd, home, away },
// each side { id, logo }. Works in the browser (window.ccRosterNextUp) and under
// Node for tests.

(function (global) {
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Each rostered team's NEXT game this week — live first, else the earliest
    // still to tip — in tip order across the roster. A team that has played out
    // its week (or has no game) has no row. A game between two of your own teams
    // is a row for each of them.
    function rows(roster, games, captainId) {
        var byStart = (games || []).slice().sort(function (a, b) {
            return (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0);
        });
        var out = [];
        (roster || []).forEach(function (t) {
            var next = null;
            for (var i = 0; i < byStart.length && !next; i++) {
                var g = byStart[i];
                if (g.state === 'final') continue;
                if (g.notes === 'Postponed' || g.notes === 'Canceled') continue;
                ['home', 'away'].forEach(function (side) {
                    if (!next && g[side] && String(g[side].id) === String(t.id)) {
                        next = { team: t, game: g, them: g[side === 'home' ? 'away' : 'home'] || {} };
                    }
                });
            }
            if (next) {
                // Never a conference-tournament game: Captain does not double those.
                next.captain = captainId != null && String(captainId) === String(t.id) && next.game.modeGame !== false;
                out.push(next);
            }
        });
        // The Captain leads — its row is the one with something to say, and it
        // must not hide behind "+N more" — then live games, then by tip.
        var rank = function (r) { return r.captain ? 0 : r.game.state === 'live' ? 1 : 2; };
        return out.sort(function (a, b) {
            return rank(a) - rank(b) || (Date.parse(a.game.startDate) || 0) - (Date.parse(b.game.startDate) || 0);
        });
    }

    // "Tue 7:00PM", "Tue TBD", or "Live". The day is there because a week of
    // basketball spans seven of them.
    function whenText(g) {
        if (g.state === 'live') return 'Live';
        var k = global.ccKickoff;
        var p = k && k.parts ? k.parts(g.startDate, g.startTimeTbd) : null;
        if (!p) return 'TBD';
        var day = p.weekdayLong ? p.weekdayLong.slice(0, 3) + ' ' : '';
        return day + (p.tbd ? 'TBD' : k.time(g.startDate, g.startTimeTbd, 'compact'));
    }

    // opts: { limit (default 4), logoOf(team), multiplier (default 2) }.
    // '' when there is nothing to show — the caller keeps its fallback then.
    function html(list, opts) {
        var o = opts || {};
        var limit = o.limit || 4;
        var mult = o.multiplier || 2;
        if (!(list || []).length) return '';
        var shown = list.slice(0, limit).map(function (r) {
            var cap = r.captain
                ? '<span class="uh-nu-cap" title="Captain this week — points count ' + esc(mult) + '×">' + esc(mult) + '×</span>'
                : '';
            var them = r.them.logo
                ? '<img class="uh-nu-logo" src="' + esc(r.them.logo) + '" alt="' + esc(r.them.team || r.them.school || '') + '" loading="lazy">'
                : '<span class="uh-nu-logo uh-nu-blank" aria-hidden="true"></span>';
            return '<span class="uh-nu-row' + (r.game.state === 'live' ? ' live' : '') + '">'
                + '<img class="uh-nu-logo" src="' + esc(o.logoOf ? o.logoOf(r.team) : '') + '" alt="' + esc(r.team.school || '') + '">'
                + cap
                + '<span class="uh-nu-vs">vs</span>'
                + them
                + '<span class="uh-nu-when">· ' + esc(whenText(r.game)) + '</span>'
                + '</span>';
        }).join('');
        var more = list.length > limit ? '<span class="uh-nu-more">+' + (list.length - limit) + ' more</span>' : '';
        return '<span class="uh-nu">' + shown + more + '</span>';
    }

    var api = { rows: rows, whenText: whenText, html: html };
    global.ccRosterNextUp = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
