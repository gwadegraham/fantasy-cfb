// Projected finish and title odds for a BASKETBALL league (#310, PR 5 of the
// projection plan) — the basketball side of GET /standings/projections.
//
// Football's is modules/standings-projection.js: buildProjections (banked +
// expected remaining regular season + expected postseason per manager), then
// applyEngagement (Captain and H2H projected forward) and simulateTitleOdds.
// The last two are SHARED: this module builds managers in exactly the shape
// buildProjections does, so the same engagement and Monte Carlo code runs
// over both sports. What differs, and lives here:
//
//   the ENGINE      projectRemaining (modules/hoops-projection.js) on
//                   basketball's game shape (homeTeamId/awayTeamId, `status`
//                   rather than `completed`), not football's
//                   projectTeamPoints. It filters to the games still to play
//                   itself, and calibrates them to the preseason rate blended
//                   with the record actually played (K = 30).
//   the POSTSEASON  proj.postseason — the March estimate (conference title,
//                   conference-tournament wins, NCAA ladder, upsets) — never
//                   football's cfp + confChamp + bowl, which here would be
//                   the conference title alone.
//   what is DECIDED per team, from its own rows (hoops-postseason-state), so
//                   a conference title or an NCAA run already banked is not
//                   expected again.
//   the VARIANCE    March is sampled per team (hoops-march-sim) rather than
//                   drawn from football's 15-point normal: see that module.
//   the WEEKS       Captain and H2H cover basketball's mode weeks — 1..L,
//                   Christmas included, L = 18 in 2026-27 — not football's
//                   16-week H2H cap. The caller passes L as maxWeek (H2H) and
//                   captainMaxWeek (Captain).
//
// ---- the ratings seam (PR 6) ----
//
// Ratings today are the PRESEASON inputs (Torvik barthag + projected record)
// with the engine's own results blend on the remaining-wins target. PR 6
// (mid-November) blends an in-season rating into the rating itself. It plugs
// in at ONE place: `ratings` below — the team rows the engine reads barthag
// and projected record from, and (optionally) `marchRanks`, the rank the
// March estimate is priced at. Today the route passes the HoopsTeam rows and
// no marchRanks (the preseason rank, attachMarch's default).
//
// Pure: no database. The route owns the reads.

const { buildHoopsPoolContext, projectRemaining } = require('./hoops-projection');
const { attachMarch } = require('./hoops-march');
const { postseasonDistribution, samplePostseason } = require('./hoops-march-sim');
const { dedupeListings, groupHoopsGamesByTeam } = require('./hoops-draft-projection');
const postseasonState = require('./hoops-postseason-state');
const { overdue } = require('./hoops-stale-duplicates');

const nameOf = (u) => `${u.firstName || ''} ${u.lastName ? u.lastName[0] + '.' : ''}`.trim();
const initialsOf = (u) => (((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '')).toUpperCase();

// users      projection managers (franchise-repo projectionManagers with
//            refs), each season entry carrying `rosterIds`.
// ratings    every HoopsTeam row of the season (see the seam above).
// games      the rostered teams' HoopsGame rows of the season, EVERY
//            seasonType: regular for the remaining schedule, conference
//            tournament and NCAA rows for `decided`.
// field      hoops-postseason-state ncaaField(): the NCAA field, or null.
// ranks      { teamId: rank } — the CURRENT ranks points-if-win grade on.
// cfg        the league's resolved scoring config.
// marchRanks optional { teamId: rank } the March estimate prices at.
// log        where anomalies and per-team failures are reported.
// nowMs      "now", for dropping overdue unplayed listings.
function buildHoopsProjections({ users, ratings, games, field, ranks, cfg, season, marchRanks, log = console, nowMs = Date.now() }) {
    const ctx = attachMarch(buildHoopsPoolContext(ratings, { ranks, cfg }), ratings,
        marchRanks ? { rankById: marchRanks } : {});
    const teamById = {};
    (ratings || []).forEach(t => { teamById[String(t.id)] = t; });

    const rostered = new Set();
    (users || []).forEach(u => ((u.seasons || [])[0] || {}).rosterIds && u.seasons[0].rosterIds.forEach(id => rostered.add(String(id))));
    // Regular-season rows de-duplicated the way the draft board does
    // (rescheduled games keep a stale listing); every row, any seasonType,
    // for the decided state.
    // An unplayed game a week past its tip is not going to be played as
    // listed (a postponement, or the stale half of a rescheduled pair): the
    // H2H gate and the matchup card already drop it (hoops-h2h gateGames),
    // so the projection does too — otherwise it projects games the card,
    // and the scorer, never count.
    const regular = (games || []).filter(g => String(g.seasonType || '').toLowerCase() === 'regular' && !overdue(g, nowMs));
    const regByTeam = groupHoopsGamesByTeam(dedupeListings(regular, ratings).games, rostered);
    const allByTeam = groupHoopsGamesByTeam(games || [], rostered);

    const out = [];
    for (const u of users || []) {
        const s = (u.seasons || []).find(x => Number(x.season) === Number(season));
        const ids = (s && s.rosterIds) || [];
        if (!ids.length) continue;
        const banked = s.cumulativeScore || 0;

        let expReg = 0, expPost = 0, remainingCount = 0;
        const perGame = [], byWeek = {}, postDists = [];
        for (const rawId of ids) {
            const id = String(rawId);
            const team = teamById[id];
            if (!team) continue;
            const { decided, anomalies } = postseasonState.decidedFor(Number(id), allByTeam[id] || [], field);
            anomalies.forEach(a => log.warn(`[hoops-projection] ${season} team ${a.teamId}: ${a.kind}`));
            let proj, dist = null;
            try {
                proj = projectRemaining(team, regByTeam[id] || [], ctx, { perGame: true, decided });
                const m = ctx.march;
                if (m && m.rankById[id] !== undefined) {
                    dist = postseasonDistribution(m.model, { id: Number(id), rank: m.rankById[id] }, m.confCtx, cfg, m.basis, decided);
                }
            } catch (err) {
                // A decided state the March model refuses. hoops-postseason-
                // state cannot build one, so this is a bug — but one team's
                // bug must not 500 the page: project its regular season with
                // NO postseason (expecting less, never paying twice).
                log.error(`[hoops-projection] ${season} team ${id}: ${err.message} — postseason left out`);
                proj = projectRemaining(team, regByTeam[id] || [], ctx, { perGame: true, decided: { ncaa: 'done' } });
                proj.postseason = 0;
                dist = null;
            }
            expReg += proj.regular;
            expPost += proj.postseason;
            remainingCount += proj.remaining || 0;
            if (dist) postDists.push(dist);
            (proj.perGame || []).forEach(pg => {
                perGame.push(pg);
                const wk = (byWeek[pg.week] = byWeek[pg.week] || []);
                let slot = wk.find(x => x.teamId === Number(id));
                if (!slot) { slot = { teamId: Number(id), games: [] }; wk.push(slot); }
                slot.games.push(pg);
            });
        }

        out.push({
            userId: String(u._id), name: nameOf(u), franchise: s.franchiseName || null,
            avatarUrl: u.avatarUrl || null, initials: initialsOf(u), color: u.color || null,
            banked: Math.round(banked),
            projectedFinal: Math.round(banked + expReg + expPost),
            postExpected: banked + expPost,
            postRemaining: expPost,
            // March, sampled per team (hoops-march-sim) in place of football's
            // normal draw. Its mean is postRemaining.
            postSample: postDists.length ? (rand) => postDists.reduce((sum, d) => sum + samplePostseason(d, rand), 0) : null,
            perGame, byWeek, remainingCount,
            expCaptain: 0, expH2H: 0
        });
    }
    return out;
}

// Is there anything left to project? Football hides the panel once the
// regular season has no games left; basketball's postseason runs a month
// past that, so the panel stays while March still has points to give.
function hasForecast(managers) {
    return (managers || []).some(m => m.remainingCount > 0 || m.postRemaining > 1e-9);
}

module.exports = { buildHoopsProjections, hasForecast };
