// The one way to read a manager's entry for a given season (client + server;
// UMD so both can load this one file).
//
// Why this exists: `user.seasons[0]` was read in 35 places, and it was correct
// in every one of them — but only because the route that fetched the user had
// already narrowed the array with `$elemMatch`. On a FULL document, index 0 is
// the OLDEST season (2023 for most managers), so any of those reads was one
// changed projection away from silently scoring the wrong year. The dependency
// lived in the gap between a route's query and a module's array index, often a
// separate file and an HTTP hop apart, with nothing connecting them.
//
// So callers now say which season they mean. The lookup works on a projected
// one-element array and on a full document alike, which is the point: it is no
// longer possible to be right by accident.
//
// Note `season` is a Number in models/user.js while `process.env.YEAR` and
// route params are strings — see sameSeason below for how that is reconciled.
// The codebase previously did this four different ways (`==`, `===` on
// String(), `Number() ===`, `findIndex`).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccSeasonOf = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    // Do these name the same season?
    //
    // This has to match how Mongo matched, not merely look reasonable. Every
    // feeding query passes `process.env.YEAR` (a string) into a field declared
    // `season: Number`, and Mongoose CASTS it — so Mongo compares numerically.
    // A plain String() comparison here would be strictly narrower than the
    // query that selected the document: `YEAR="2026 "` with a stray space still
    // returns the doc and still projects the entry, but would find nothing here.
    // That is not hypothetical padding paranoia — this repo already ships
    // `CFBD_API_KEY= Bearer …` with a leading space.
    //
    // So: numeric comparison when both sides are numeric, exact-string
    // otherwise, and never treat '' as the number 0.
    function sameSeason(a, b) {
        var sa = String(a).trim(), sb = String(b).trim();
        if (sa === sb) return true;
        if (sa === '' || sb === '') return false;
        var na = Number(sa), nb = Number(sb);
        return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
    }

    // The manager's entry for `season`, or null. `season` is required — an
    // implicit "current" default is the whole class of bug this replaces.
    function seasonOf(user, season) {
        if (season == null) return null;
        var seasons = (user && user.seasons) || [];
        for (var i = 0; i < seasons.length; i++) {
            if (seasons[i] && sameSeason(seasons[i].season, season)) return seasons[i];
        }
        return null;
    }

    // Same, but never null — for the many callers that immediately read
    // `.teams` / `.weeklyScore` and already tolerated an empty shape.
    function seasonOrEmpty(user, season) {
        return seasonOf(user, season) || {};
    }

    // ---- projected payloads -------------------------------------------------
    //
    // The two functions below are the only positional reads of a MANAGER's
    // current season, and they are legitimate because they ask the inverse
    // question: not "give me season X" but "which season is this one-element
    // array?".
    //
    // That question is real. GET /users/league/:code takes an optional
    // ?season=, so a page showing a PAST season must read the season back out
    // of the payload — substituting APP_YEAR is exactly what would break
    // past-season browsing.
    //
    // (Deliberately not claiming more than that. `.at(-1)` reads on TEAM
    // documents are correct and intended — public/team.js and draftRoom.js want
    // newest-last there. And several hand-rolled season lookups remain, each
    // with its own fallback: modules/h2h.js, modules/weekly-recap.js and
    // modules/admin-status.js, plus public/userHome.js. Those are not positional
    // and not in this issue's scope, but they are why this is not yet the single
    // way the app reads a season.)
    // Note these deliberately do NOT round-trip through seasonOf(). Looking the
    // entry up by the number it just read would add a failure mode (a payload
    // whose entry omits `season`) while catching nothing: handed a full
    // document, the round trip finds the oldest season's entry — the same wrong
    // answer, more slowly. Only the calling route can guarantee the projection,
    // so these two are named and commented rather than made clever.

    // The one season entry in an $elemMatch-projected payload.
    function payloadSeasonEntry(user) {
        var seasons = (user && user.seasons) || [];
        return seasons[0] || {};
    }

    // Which season that payload is about, for callers that need the number
    // itself (building a URL, say). Takes a user or a list of them.
    function payloadSeason(users) {
        var list = Array.isArray(users) ? users : [users];
        for (var i = 0; i < list.length; i++) {
            var entry = payloadSeasonEntry(list[i]);
            if (entry.season != null) return entry.season;
        }
        return null;
    }

    return {
        sameSeason: sameSeason,
        seasonOf: seasonOf,
        seasonOrEmpty: seasonOrEmpty,
        payloadSeasonEntry: payloadSeasonEntry,
        payloadSeason: payloadSeason
    };
}));
