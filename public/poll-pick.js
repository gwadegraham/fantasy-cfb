// Shared football poll picker (client + server; UMD so tests can load it).
//
// Which ranks a game shows: the poll doc for the game's week (week 16, the
// final regular-season doc, for the postseason), else the newest doc on file
// for a week with none yet; and from that ONE doc, the Playoff Committee
// ranking when it has one, else AP. Same order as the scorer's findPoll
// (modules/scoring-detectors.js).
//
// The three copies this replaces (team, Standings, My Team) chose the poll NAME
// from the game's week first and only then fell back to the newest doc — so a
// game in a week with no doc yet ("Up next") read the newest doc's AP list and
// skipped its committee ranking. Nov 2026: Texas showed "as #8" (AP) for its
// next game while the committee had them #5.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccPollPick = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    var CFP = 'Playoff Committee Rankings';
    var AP = 'AP Top 25';

    function docFor(rankings, week, seasonType, season) {
        var docs = (Array.isArray(rankings) ? rankings : [])
            .filter(function (r) { return r && (season == null || r.season == season); });
        if (seasonType === 'postseason') {
            return docs.find(function (r) { return r.week == 16; }) || null;
        }
        return docs.find(function (r) { return r.week == week; })
            || docs.slice().sort(function (a, b) { return b.week - a.week; })[0]
            || null;
    }

    // The ranks array ([{ rank, school, ... }]) for one game; [] when none.
    function ranksFor(rankings, week, seasonType, season) {
        var doc = docFor(rankings, week, seasonType, season);
        var polls = (doc && Array.isArray(doc.polls)) ? doc.polls : [];
        var poll = polls.find(function (p) { return p && p.poll === CFP; })
            || polls.find(function (p) { return p && p.poll === AP; });
        return (poll && Array.isArray(poll.ranks)) ? poll.ranks : [];
    }

    return { ranksFor: ranksFor };
}));
