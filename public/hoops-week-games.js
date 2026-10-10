// My Team's Games tile on a basketball league (#501).
//
// Football's tile reads the football calendar and the football games
// collection, and its drawer is football's displaySchedule — betting lines,
// AP ranks, a 1–16 + Postseason picker. On a basketball league every one of
// those answered for the wrong sport: the calendar is empty for a basketball
// season, and the team ids look up FOOTBALL games (the id spaces overlap,
// #489). This is the basketball tile: its own current week (ccCurrentWeek,
// sport-aware), its own games (GET /hoops/games/teams/:season/:week), and a
// compact list in the shared sport-page game-row style.
//
// Nothing here writes football's week storage (weekCode / week / weekPinned):
// those keys carry no sport, and a basketball week stored there would move a
// football page after a league switch. The picked week lives on the page.
//
// Works in the browser (window.ccHoopsWeekGames) and under Node for tests.

(function (global) {
    function kit() { return global.ccSportPage || null; }
    function esc(s) {
        var k = kit();
        if (k && k.esc) return k.esc(s);
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function teamHref(id) { return '/hoops/team/' + encodeURIComponent(id); }
    function gameHref(id) { return '/hoops/game/' + encodeURIComponent(id); }

    // One week of some teams' games. Resolves to { week, weeks, games } or
    // null when it could not be loaded — the caller keeps its label then.
    function load(season, week, ids) {
        var list = (ids || []).filter(function (id) { return id != null; });
        var url = '/hoops/games/teams/' + encodeURIComponent(season) + '/' + encodeURIComponent(week)
            + '?ids=' + encodeURIComponent(list.join(','));
        return global.fetch(url, { headers: { Accept: 'application/json' } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    // Each rostered team's games, from that team's side: { game, us, them,
    // venue }. A game between two of your own teams appears under both.
    function byTeam(roster, games) {
        var out = {};
        (roster || []).forEach(function (t) { out[String(t.id)] = []; });
        (games || []).forEach(function (g) {
            ['home', 'away'].forEach(function (side) {
                var us = g[side], them = g[side === 'home' ? 'away' : 'home'];
                var list = us && out[String(us.id)];
                if (!list) return;
                list.push({ game: g, us: us, them: them,
                    venue: g.neutralSite ? 'neutral' : side });
            });
        });
        // In tip order — the drawer reads down a team's week.
        Object.keys(out).forEach(function (k) {
            out[k].sort(function (a, b) { return (Date.parse(a.game.startDate) || 0) - (Date.parse(b.game.startDate) || 0); });
        });
        return out;
    }

    // Points this team banked in this game, off the manager's own
    // weeklyScore — null when nothing is banked (yet).
    function pointsFor(seasonEntry, week, teamId, gameId) {
        var weeks = (seasonEntry && seasonEntry.weeklyScore) || [];
        for (var i = 0; i < weeks.length; i++) {
            if (Number(weeks[i].week) !== Number(week)) continue;
            var by = weeks[i].scoreByTeam || [];
            for (var j = 0; j < by.length; j++) {
                if (String(by[j].teamId) === String(teamId) && String(by[j].gameId) === String(gameId)) {
                    return by[j].score != null ? Number(by[j].score) : 0;
                }
            }
        }
        return null;
    }

    // Halves, then OT, 2OT — period 3 is the first overtime (as the
    // basketball scoreboard reads it).
    function periodLabel(p) {
        if (p == null) return 'Live';
        return p === 1 ? '1st' : p === 2 ? '2nd' : (p > 3 ? (p - 2) : '') + 'OT';
    }

    // The result column: W/L and the score, the live score and clock, or the
    // tip time. `tone` is w / l / live / up.
    function result(entry) {
        var g = entry.game, us = entry.us.points, them = entry.them.points;
        var hasScore = us != null && them != null;
        if (g.state === 'final' && hasScore) {
            var won = us > them;
            return { tone: won ? 'w' : 'l', text: (won ? 'W ' : 'L ') + us + '–' + them };
        }
        if (g.state === 'live') {
            var clock = periodLabel(g.period) + (g.period != null && g.clock ? ' ' + g.clock : '');
            return { tone: 'live', text: (hasScore ? us + '–' + them + ' · ' : '') + clock };
        }
        if (g.notes === 'Postponed' || g.notes === 'Canceled') return { tone: 'up', text: g.notes };
        var k = global.ccKickoff;
        var t = k && k.time ? k.time(g.startDate, g.startTimeTbd, 'compact') : '';
        return { tone: 'up', text: t || 'TBD' };
    }

    function venueMark(v) { return v === 'home' ? 'vs' : v === 'away' ? '@' : 'N'; }

    function dayCell(g) {
        var k = global.ccKickoff;
        var p = k && k.parts ? k.parts(g.startDate, g.startTimeTbd) : null;
        if (!p) return '';
        return '<b>' + esc(p.weekdayLong.slice(0, 3)) + '</b><small>' + esc(p.month + '/' + p.day) + '</small>';
    }

    // The tile's resting state: the logos of your teams that play this week.
    // opts: { roster, games, label, poss, logoOf }
    function glanceHtml(opts) {
        var grouped = byTeam(opts.roster, opts.games);
        var playing = (opts.roster || []).filter(function (t) { return (grouped[String(t.id)] || []).length; });
        var label = esc(opts.label || 'This week');
        if (!playing.length) {
            return '<span class="uh-glance-sub">No games for ' + esc(opts.poss) + ' teams · ' + label + '</span>';
        }
        var logos = playing.map(function (t) {
            return '<a href="' + teamHref(t.id) + '" style="color:inherit;text-decoration:none" title="' + esc(t.school) + '">'
                + '<img src="' + esc(opts.logoOf(t)) + '" alt=""></a>';
        }).join('');
        return '<span class="uh-games-logos">' + logos + '</span><span class="uh-glance-sub uh-games-wk">'
            + playing.length + ' of ' + esc(opts.poss) + ' teams · ' + label + '</span>';
    }

    function weekLabel(w) {
        var k = global.ccKickoff;
        // Read on the EASTERN calendar the weeks are cut on: a week whose
        // first row is a TBD tip (midnight Eastern) would otherwise start a
        // day early for anyone west of it.
        var a = k && k.parts ? k.parts(w.first, true) : null;
        var b = k && k.parts ? k.parts(w.last, true) : null;
        if (!a || !b) return 'Week ' + w.week;
        var range = a.monthShort === b.monthShort
            ? a.monthShort + ' ' + a.day + '–' + b.day
            : a.monthShort + ' ' + a.day + ' – ' + b.monthShort + ' ' + b.day;
        return 'Week ' + w.week + ' · ' + range;
    }

    // The season's actual weeks — not football's 1–16 + Postseason.
    function pickerHtml(weeks, week) {
        if (!(weeks || []).length) return '';
        return '<label class="uh-games-pick"><select uh-hg-week aria-label="Week">'
            + weeks.map(function (w) {
                return '<option value="' + w.week + '"' + (Number(w.week) === Number(week) ? ' selected' : '') + '>'
                    + esc(weekLabel(w)) + '</option>';
            }).join('') + '</select></label>';
    }

    function rowHtml(entry, seasonEntry, week) {
        var g = entry.game, them = entry.them;
        var r = result(entry);
        var pts = pointsFor(seasonEntry, week, entry.us.id, g.id);
        var ptsText = g.state === 'final' && pts != null ? (pts > 0 ? '+' + pts : String(pts)) : '';
        var href = gameHref(g.id);
        return '<a class="sp-gr uh-hg-row' + (r.tone === 'up' ? ' up' : '') + '" href="' + href + '">'
            + '<span class="d">' + dayCell(g) + '</span>'
            + '<span class="opp"><span class="nm"><span class="uh-hg-v">' + venueMark(entry.venue) + '</span>'
            + (them.logo ? '<img class="sp-ologo" src="' + esc(them.logo) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
            + esc(them.team) + '</span>'
            + (g.notes && g.notes !== r.text ? '<span class="note">' + esc(g.notes) + '</span>' : '') + '</span>'
            + '<span class="res uh-hg-' + r.tone + '">' + esc(r.text) + '</span>'
            + '<span class="p' + (pts ? '' : ' z') + '">' + ptsText + '</span></a>';
    }

    // The drawer's list: grouped under each of your teams, in roster order.
    // opts: { roster, games, seasonEntry, week, logoOf, poss }
    function listHtml(opts) {
        var grouped = byTeam(opts.roster, opts.games);
        var h = '';
        (opts.roster || []).forEach(function (t) {
            var list = grouped[String(t.id)] || [];
            if (!list.length) return;
            h += '<a class="sp-gr div uh-hg-team" href="' + teamHref(t.id) + '">'
                + '<span><img class="sp-ologo" src="' + esc(opts.logoOf(t)) + '" alt="">' + esc(t.school) + '</span></a>';
            list.forEach(function (e) { h += rowHtml(e, opts.seasonEntry, opts.week); });
        });
        if (!h) return '<div class="sp-empty">No games for ' + esc(opts.poss) + ' teams this week.</div>';
        return '<div class="sp-card sp-games">' + h + '</div>';
    }

    // Wire the tile. opts: { season, seasonEntry, roster, glanceEl, poss,
    // logoOf, setDrawer(fn(body)) }. Resolves once the glance is painted.
    function hydrate(opts) {
        var ids = (opts.roster || []).map(function (t) { return t.id; });
        // `loading` until the first answer lands; `failed` only when that
        // first answer never came. A failed week SWITCH keeps the last good
        // week rather than dropping the picker. `seq` makes the newest pick
        // win when quick changes come back out of order.
        var state = { week: null, data: null, loading: true, failed: false, note: '', seq: 0, body: null };
        var cw = global.ccCurrentWeek;
        var paintGlance = function () {
            if (!opts.glanceEl) return;
            var known = state.week && state.data && (state.data.weeks || []).length;
            var label = known ? 'Week ' + state.week : 'This week';
            opts.glanceEl.innerHTML = state.data
                ? glanceHtml({ roster: opts.roster, games: state.data.games, label: label, poss: opts.poss, logoOf: opts.logoOf })
                : '<span class="uh-glance-sub uh-games-wk">' + esc(label) + '</span>';
        };
        var paint = function () {
            var body = state.body;
            if (!body) return;
            var d = state.data;
            if (!d) {
                body.innerHTML = state.loading ? '<div class="sp-loading">Loading…</div>'
                    : '<div class="sp-error">Could not load the games.</div>';
                return;
            }
            if (!(d.weeks || []).length) { body.innerHTML = '<div class="sp-empty">No basketball schedule yet.</div>'; return; }
            body.innerHTML = '<div class="uh-hg">' + pickerHtml(d.weeks, state.week)
                + (state.note ? '<div class="sp-empty">' + esc(state.note) + '</div>' : '') + '<div uh-hg-list>'
                + listHtml({ roster: opts.roster, games: d.games, seasonEntry: opts.seasonEntry,
                    week: state.week, logoOf: opts.logoOf, poss: opts.poss }) + '</div></div>';
            var sel = body.querySelector('[uh-hg-week]');
            if (sel) sel.addEventListener('change', function () {
                var listEl = body.querySelector('[uh-hg-list]');
                if (listEl) listEl.innerHTML = '<div class="sp-loading">Loading…</div>';
                fetchWeek(Number(sel.value));
            });
        };
        var fetchWeek = function (week) {
            var mine = ++state.seq;
            return load(opts.season, week, ids).then(function (d) {
                if (mine !== state.seq) return;          // a newer pick is on its way
                state.loading = false;
                state.note = '';
                if (d) {
                    // The week list is the season's; keep it if an answer lacks it.
                    if (!(d.weeks || []).length && state.data) d.weeks = state.data.weeks;
                    state.week = week;
                    state.data = d;
                } else if (state.data) {
                    state.note = 'Could not load week ' + week + '.';
                }
                paintGlance();
                paint();
            });
        };

        opts.setDrawer(function (body) {
            state.body = body;
            paint();
        });

        return Promise.resolve(cw && cw.get ? cw.get(opts.season) : null)
            .catch(function () { return null; })
            .then(function (wk) { return fetchWeek(wk || 1); });
    }

    var api = { load: load, byTeam: byTeam, pointsFor: pointsFor, periodLabel: periodLabel, result: result,
        glanceHtml: glanceHtml, pickerHtml: pickerHtml, weekLabel: weekLabel, rowHtml: rowHtml, listHtml: listHtml, hydrate: hydrate };
    global.ccHoopsWeekGames = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
