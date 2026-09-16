// Build and restore point-in-time copies of the team inputs the projection
// engine reads (SP+, expected wins, CFP futures, conference). Pure — no I/O, so
// the routes own the reads and writes and this stays unit-testable.
//
// See models/marketSnapshot.js for why these exist.

// Every field modules/draft-projection.js resolves through seasonVal(), plus the
// name fields buildRankingProxy() and the odds matcher need.
function snapshotTeam(team, season, opts = {}) {
    const s = ((team.seasons || []).find(x => Number(x.season) === season)) || {};
    let spRating = s.spRating, spRank = s.spRank;

    // Reconstruct the ratings as of a specific SP+ week. The enrichment job
    // overwrites spRating in place but appends a row to spHistory each week, so
    // a past week is recoverable — which is the only way to build a truthful
    // draft-time baseline after the season has already started.
    if (opts.spWeek != null) {
        const h = (s.spHistory || []).find(x => Number(x.week) === Number(opts.spWeek));
        if (h) { spRating = h.rating; spRank = h.rank != null ? h.rank : spRank; }
        else if (opts.requireSpWeek) { spRating = undefined; spRank = undefined; }
    }

    return {
        id: team.id,
        school: team.school,
        alternateNames: team.alternateNames || [],
        conference: s.conference || team.conference || null,
        spRating, spRank,
        expectedWins: s.expectedWins,
        cfpMakeOdds: s.cfpMakeOdds,
        cfpChampOdds: s.cfpChampOdds
    };
}

// teams: lean Team docs. Returns the `teams` array for a MarketSnapshot.
// Teams carrying no value for the season at all are dropped — a snapshot of
// nothing is just weight, and the projection treats a missing team the same way.
function buildSnapshotTeams(teams, season, opts = {}) {
    const out = [];
    (teams || []).forEach(t => {
        if (t == null || t.id == null) return;
        const row = snapshotTeam(t, season, opts);
        const hasAny = row.spRating != null || row.expectedWins != null
            || row.cfpMakeOdds != null || row.cfpChampOdds != null;
        if (hasAny) out.push(row);
    });
    return out;
}

// Turn a snapshot back into the `teamsById` shape the projection engine expects,
// so a frozen grade runs through exactly the same code as a live one.
function teamsByIdFromSnapshot(snapshot, season) {
    const byId = {};
    ((snapshot && snapshot.teams) || []).forEach(t => {
        byId[String(t.id)] = {
            id: t.id,
            school: t.school,
            alternateNames: t.alternateNames || [],
            conference: t.conference,
            seasons: [{
                season,
                conference: t.conference,
                spRating: t.spRating,
                spRank: t.spRank,
                expectedWins: t.expectedWins,
                cfpMakeOdds: t.cfpMakeOdds,
                cfpChampOdds: t.cfpChampOdds
            }]
        };
    });
    return byId;
}

module.exports = { snapshotTeam, buildSnapshotTeams, teamsByIdFromSnapshot };
