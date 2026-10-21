// What the draft room's team pool shows, per sport (#320).
//
// UMD so the tests can load it: public/draftRoom.js is a browser global with no
// exports, and the pool table is the part of it worth pinning — it was five
// hardcoded football assumptions (the column list, each cell, the mobile card,
// the sort, the xWins bar) and basketball shares none of them.
//
// Football's columns are ported here VERBATIM, field names and fallbacks
// included, so the refactor can be shown to change nothing. Its draft is the
// one that has actually run.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccDraftPool = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    // The two sports rank teams on entirely different things, so the columns
    // are per sport rather than a shared vocabulary that would fit neither.
    //
    // `num` right-aligns and marks it sortable-as-a-number; `sort` is how a
    // missing value orders, which differs per column — a team with no SP+
    // belongs at the bottom, a team with no recruiting rank belongs after the
    // ranked ones, and they are not the same sentinel.
    var COLUMNS = {
        football: [
            { key: 'name', label: 'Team' },
            { key: 'conf', label: 'Conference' },
            { key: 'sp', label: 'SP+', num: true },
            { key: 'rank', label: 'Recruiting', num: true },
            { key: 'score', label: 'Last Season', num: true },
            { key: 'xwins', label: 'xWins', num: true },
            // `num` on the ACTION column too. It carries no number, but
            // .pool-table tbody td.num is what right-aligns it, and dropping
            // the flag moved every Draft button and Drafted chip to the left
            // edge of its cell. Caught by a jsdom diff against the old
            // rendering, not by any of the data tests.
            { key: 'draft', label: '', num: true }
        ],
        basketball: [
            { key: 'name', label: 'Team' },
            { key: 'conf', label: 'Conference' },
            { key: 'rank', label: 'T-Rank', num: true },
            { key: 'barthag', label: 'Power', num: true },
            { key: 'adjOE', label: 'Offense', num: true },
            { key: 'adjDE', label: 'Defense', num: true },
            { key: 'proj', label: 'Proj.' },
            { key: 'draft', label: '', num: true }
        ]
    };

    function columnsFor(sport) {
        return COLUMNS[sport] || COLUMNS.football;
    }

    // Ordering for one column. Returns a comparable; the caller applies the
    // direction.
    //
    // The missing-value sentinels are per column and deliberate: -1 sinks a
    // team with no score below one that scored zero, 999 sinks an unranked
    // recruiting class below #300, and -Infinity sinks a team with no SP+
    // below the worst rating. A shared sentinel would reorder all three.
    function sortValue(p, k) {
        if (k === 'name') return String(p.name || '').toLowerCase();
        if (k === 'conf') return String(p.conf || '').toLowerCase();
        if (k === 'rank') return p.rank == null ? 999 : p.rank;
        if (k === 'score') return p.score == null ? -1 : p.score;
        if (k === 'xwins') return p.xwins == null ? -1 : p.xwins;
        if (k === 'sp') return p.sp == null ? -Infinity : p.sp;
        // Basketball. adjDE is the one column where LOWER is better, and it is
        // sorted ascending for that reason — the table's default direction is
        // applied on top, so this only has to be consistent.
        if (k === 'barthag') return p.barthag == null ? -1 : p.barthag;
        if (k === 'adjOE') return p.adjOE == null ? -1 : p.adjOE;
        if (k === 'adjDE') return p.adjDE == null ? 999 : p.adjDE;
        // The projected record is a "W-L" string, and sorted as text 25-7
        // came above 25-6 and 9-23 above 28-4. Wins first, then fewer losses;
        // not win %, which would put a 20-2 above a 28-4 that banks more wins.
        if (k === 'proj') {
            var m = /^(\d+)-(\d+)/.exec(p.projectedRecord || '');
            return m ? Number(m[1]) * 1000 - Number(m[2]) : -Infinity;
        }
        return 0;
    }

    // Which column the table opens on, and which way.
    //
    // Football defers to SP+ only once the enrichment job has populated it —
    // before that the ratings are all null and the sort is meaningless, so it
    // stays on the recruiting rank it has always used. Basketball always has a
    // T-Rank, because the pool is BUILT from it.
    function defaultSort(sport, pool) {
        if (sport === 'basketball') return { key: 'rank', dir: 1 };
        if (pool.some(function (p) { return p.sp != null; })) return { key: 'sp', dir: -1 };
        // xWins, which is where the table has always opened before the
        // enrichment job publishes ratings. The first version of this returned
        // the recruiting rank and described that as the existing behaviour —
        // it was not, and the test asserting it was pinning the change rather
        // than catching it.
        return { key: 'xwins', dir: -1 };
    }

    // One row per draftable team.
    //
    // `logo` is left to the caller: picking one is ccLogo's job and that is a
    // browser global this module must not depend on, or it stops being
    // loadable by a test.
    function buildPool(sport, teams, recruiting, season, leagueVersion) {
        if (sport === 'basketball') return teams.map(hoopsRow);
        return teams.map(function (t) { return footballRow(t, recruiting, season, leagueVersion); });
    }

    function hoopsRow(t) {
        return {
            id: t.id,
            name: t.school,
            conf: t.conference || '-',
            logos: t.logos || [],
            rank: t.rank == null ? null : t.rank,
            barthag: t.barthag == null ? null : t.barthag,
            adjOE: t.adjOE == null ? null : t.adjOE,
            adjDE: t.adjDE == null ? null : t.adjDE,
            projectedRecord: t.projectedRecord || null,
            tags: Array.isArray(t.tags) ? t.tags : [],
            turnover: t.turnover || null
        };
    }

    // Style tags (#542) as chips: "3-point heavy", "Slow pace". The detail —
    // "Top 4% in pace: 71.2 possessions a game" — is the tooltip. `esc` is
    // the page's own escaper, passed in so this file stays loadable by a test.
    function tagsHtml(tags, esc) {
        if (!tags || !tags.length) return '';
        return '<span class="dp-tags">' + tags.map(function (t) {
            return '<span class="dp-tag" data-tag="' + esc(t.key) + '"'
                + (t.detail ? ' title="' + esc(t.detail) + '"' : '') + '>' + esc(t.label) + '</span>';
        }).join('') + '</span>';
    }

    // The line above the board saying where the tags came from. Said out
    // loud in preseason, when they describe LAST season's team — the draft
    // is in October, so that is the case every manager sees.
    function stylesNote(styles) {
        if (!styles || !styles.label) return '';
        return styles.lastSeason
            ? 'Style tags are from last season (' + styles.label + ') until this season has a few games played.'
            : 'Style tags are from this season (' + styles.label + '), updated daily.';
    }

    // Roster turnover (#541): "Portal +4 / −3 · Class #12". The minus is a
    // real minus sign, so it lines up with the plus. The tooltip spells out
    // the star counts the line has no room for.
    function turnoverLine(tv) {
        if (!tv) return '';
        return 'Portal +' + tv.in + ' / \u2212' + tv.out + (tv.classRank != null ? ' \u00b7 Class #' + tv.classRank : '');
    }

    function turnoverHtml(tv, esc) {
        if (!tv) return '';
        var tip = tv.in + ' transfer' + (tv.in === 1 ? '' : 's') + ' in'
            + (tv.inTop ? ' (' + tv.inTop + ' four-star+)' : '')
            + ', ' + tv.out + ' out' + (tv.outTop ? ' (' + tv.outTop + ' four-star+)' : '')
            + (tv.classRank != null ? '; recruiting class #' + tv.classRank : '; class not ranked');
        return '<span class="dp-turnover" title="' + esc(tip) + '">' + esc(turnoverLine(tv)) + '</span>';
    }

    // Which offseason the line describes: the spring before the season, which
    // CBBD files a year earlier than the season's own label.
    function turnoverNote(src) {
        if (!src || src.fromYear == null || src.season == null) return '';
        return 'Portal and Class are the spring ' + src.fromYear + ' transfer window and recruiting class: the moves into '
            + (src.season - 1) + '\u2013' + String(src.season).slice(-2) + '.';
    }

    // Ported unchanged from public/draftRoom.js, including the preseason
    // fallback and the per-league scoring version. Any difference here is a
    // football regression, which is why it reads like a transcription.
    function footballRow(t, recruiting, yr, leagueVersion) {
        var conf = '-', score = null, xwins = 0, sp = null, spRank = null, prev = null;
        if (t.seasons && t.seasons.length) {
            prev = t.seasons.find(function (s) { return s.season == (yr - 1); });
            var cur = t.seasons.find(function (s) { return s.season == yr; });
            conf = t.seasons[t.seasons.length - 1].conference;
            if (prev) score = (leagueVersion == 'V1') ? prev.cumulativeScoreV1 : prev.cumulativeScoreV2;
            if (cur) {
                xwins = cur.expectedWins || 0;
                if (cur.spRating != null) sp = cur.spRating;
                if (cur.spRank != null) spRank = cur.spRank;
            }
            // Preseason fallback: before the upcoming season's ratings
            // publish, use last season's final SP+ as the draft signal.
            if (sp == null && prev) {
                if (prev.spRating != null) sp = prev.spRating;
                if (prev.spRank != null) spRank = prev.spRank;
            }
        }
        var rank = null;
        if (recruiting && recruiting.length) {
            var r = recruiting.filter(function (o) {
                return o.team == t.school || (t.alternateNames || []).indexOf(o.team) > -1;
            })[0];
            if (r) rank = r.rank;
        }
        return {
            id: t.id, name: t.school, logos: t.logos || [], conf: conf,
            score: score, xwins: xwins, rank: rank, sp: sp, spRank: spRank,
            scoreYear: prev ? prev.season : null
        };
    }

    return {
        COLUMNS: COLUMNS,
        columnsFor: columnsFor,
        sortValue: sortValue,
        defaultSort: defaultSort,
        buildPool: buildPool,
        tagsHtml: tagsHtml,
        stylesNote: stylesNote,
        turnoverLine: turnoverLine,
        turnoverHtml: turnoverHtml,
        turnoverNote: turnoverNote
    };
}));
