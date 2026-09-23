// Shared "what week is it" (ccCurrentWeek).
//
// Three pages needed a default week and each invented its own answer, so once
// week 1 finished the app disagreed with itself: Betting hardcoded week 0, My
// Team defaulted to the latest SCORED week, and Standings only ever set a week
// when nothing was stored. The scoreboard endpoint already resolves the league's
// current week off the stored calendar — no CFBD call — and the scoreboard UI
// anchors on it, so that is the one answer everything else reads.
//
// PINNING. A viewer who picks a week from a dropdown must keep it; a week the
// app chose for them must not survive the calendar moving on. Storage couldn't
// tell those apart — the auto-seeded value was written to the same key the
// "did the user choose?" test read, so one visit to My Team froze that browser
// on week 1 for the rest of the season. `weekPinned` is set ONLY by a real
// pick, which is what makes the distinction honest.
(function () {
    var cache = {};

    function leagueCode() {
        try { return (window.ccLeague && window.ccLeague.code()) || ''; } catch (e) { return ''; }
    }
    function ls(fn, fallback) {
        try { return fn(window.localStorage); } catch (e) { return fallback; }
    }

    function pinned() { return ls(function (s) { return s.getItem('weekPinned') === '1'; }, false); }
    function pin() { ls(function (s) { s.setItem('weekPinned', '1'); }); }
    function unpin() { ls(function (s) { s.removeItem('weekPinned'); }); }

    // The league's current week, plus `liveNow` — the slate being PLAYED right
    // now as { week, seasonType }, or null between slates. Resolves to
    // { week: null, liveNow: null } when it can't be answered. Cached per
    // league+season: several tiles on one page ask, and they must not race.
    function state(season) {
        var league = leagueCode();
        if (!league || !season) return Promise.resolve({ week: null, liveNow: null });
        var key = league + '/' + season;
        if (!cache[key]) {
            // /games/current-week, not /games/scoreboard. This used to read the
            // number off the full scoreboard payload — measured at 4.3s against
            // the M0 tier — for one integer. Every caller paid it, and the
            // betting page pays it BEFORE it can fetch anything, because the
            // week decides which games to ask for.
            cache[key] = fetch('/games/current-week/' + encodeURIComponent(season),
                               { headers: { Accept: 'application/json' } })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (d) {
                    var ln = d && d.liveNow;
                    return {
                        week: d && typeof d.week === 'number' ? d.week : null,
                        liveNow: (ln && typeof ln.week === 'number')
                            ? { week: ln.week, seasonType: ln.seasonType || 'regular' }
                            : null
                    };
                })
                .catch(function () { return { week: null, liveNow: null }; });
        }
        return cache[key];
    }

    // Just the week number — what almost every caller wants. `live` matters
    // only to a surface reporting on a FINISHED week (see the standings
    // highlights), so it reads state() instead.
    function get(season) {
        return state(season).then(function (s) { return s.week; });
    }

    // Bring the stored week picker up to the current week, unless the viewer
    // pinned one. Resolves to the week code now in storage, or null if we
    // couldn't answer and the caller should fall back to its own default.
    // 'week-17' is the app's postseason sentinel (see displaySchedule). The
    // calendar answers in regular-season weeks, so syncing over a postseason
    // selection would drag a reader out of the bowls and back into November.
    function isPostseason(code) { return code === 'week-17'; }

    function sync(season) {
        var stored = ls(function (s) { return s.getItem('weekCode'); }, null);
        if (pinned() || isPostseason(stored)) return Promise.resolve(stored);
        return get(season).then(function (wk) {
            if (!wk) return null;
            var code = 'week-' + wk;
            ls(function (s) { s.setItem('weekCode', code); s.setItem('week', 'Week ' + wk); });
            return code;
        });
    }

    window.ccCurrentWeek = { get: get, state: state, sync: sync, pinned: pinned, pin: pin, unpin: unpin };
})();
