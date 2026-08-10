// Shared league placement by season total (client + server; UMD so both can load
// this one file).
//
// Standard competition ranking: your rank is 1 + the managers strictly ahead of
// you, so tied managers SHARE a placement and the caller can label it "T-3rd".
// The same rule rankAt() in modules/weekly-recap.js applies to a single week —
// this one works off the stored season total.
//
// The alternative — sort the league and read off each manager's index — silently
// invents placements whenever scores tie, because Array#sort is stable and so
// leaves equal entries in whatever order the DB returned them. Every manager sits
// at 0 before the season starts, which turned that index into a confident-looking
// "1st of 6" for whoever happened to be first in the collection. Nothing here
// depends on input order, so there's no arbitrary tiebreak to leak. Gate the
// unstarted-season case with ccSeasonScoring (public/season-scoring.js) — a rank
// is meaningless before anyone has played, tie-aware or not.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccLeagueRank = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    // The season total to rank on. Reads seasons[0] — the payload shape of
    // /users/league/:league, where routes/users.js $elemMatch's the active season
    // so it's the only one present.
    function seasonTotal(user) {
        var seasons = (user && user.seasons) || [];
        return (seasons[0] && seasons[0].cumulativeScore) || 0;
    }

    // { rank, tie, total } for userId among `users`, or null if they aren't in the
    // league. `tie` means another manager holds the exact same total, so the
    // caller can prefix "T-". `total` is the league size, for "3rd of 6".
    function leagueRank(users, userId) {
        var rows = (users || []).map(function (u) {
            return { id: String(u && u._id), score: seasonTotal(u) };
        });
        var id = String(userId);
        var mine = rows.filter(function (r) { return r.id === id; })[0];
        if (!mine) return null;

        var ahead = 0, shared = 0;
        rows.forEach(function (r) {
            if (r.score > mine.score) ahead += 1;
            else if (r.score === mine.score && r.id !== id) shared += 1;
        });
        return { rank: ahead + 1, tie: shared > 0, total: rows.length };
    }

    return { leagueRank: leagueRank };
}));
