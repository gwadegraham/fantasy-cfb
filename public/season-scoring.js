// Shared "has this season actually been played yet?" test (client + server; UMD
// so both can load this one file).
//
// The nightly scoring job seeds a zero-point weeklyScore entry for every manager
// as soon as a week's games EXIST — through the preseason with undrafted, 0-team
// rosters, and again mid-week before a single game goes final. So "a weekly entry
// exists" is a different question from "has anyone played", and every feature
// that gated on the former showed empty week-one content during the preseason:
// first the Standings highlights panel and points chart, then the Weekly Recap
// (its popup fired a "Week 1 · 0 points" story before kickoff).
//
// The honest signal is banked points. Once any manager's week is non-zero, that
// week got scored. Everything that decides whether to show season-to-date
// content routes through here so the app can't disagree with itself about when
// the season starts.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccSeasonScoring = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    // One weeklyScore entry that got scored. `score` is the BANKED number (it
    // carries the H2H win bonus — see modules/h2h.js); any non-zero value means
    // the week was played, which is all this asks.
    function entryHasScoring(entry) {
        return !!entry && (entry.score || 0) !== 0;
    }

    // The weeklyScore array for `season`. Omit `season` for the standings /
    // profile payloads, where routes/users.js $elemMatch's the active season and
    // seasons[0] is the only one present.
    function weeklyScoreFor(user, season) {
        var seasons = (user && user.seasons) || [];
        var entry = season == null
            ? seasons[0]
            : seasons.filter(function (s) { return String(s.season) === String(season); })[0];
        return (entry && entry.weeklyScore) || [];
    }

    // True once ANY manager in the league has banked points in `season`. Deliberately
    // league-wide: a manager who scored 0 in a week the league really played still
    // has a real (if quiet) week to show, so this can't be a per-manager check.
    function seasonHasScoring(users, season) {
        return (users || []).some(function (u) {
            return weeklyScoreFor(u, season).some(entryHasScoring);
        });
    }

    return { entryHasScoring: entryHasScoring, seasonHasScoring: seasonHasScoring };
}));
