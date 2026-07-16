// Pure, DB-free computation of the admin console's "current state" summary.
// Kept free of Mongoose/Express so it can be unit-tested directly; the route
// (routes/scores.js GET /status/:season) fetches the users + games and hands
// them here.
//
// Given the season's users (each with seasons[].teams and weeklyScore) and that
// season's games, it derives:
//   scoredThroughWeek      - latest regular week present in users' weeklyScore
//   gamesLoadedThroughWeek - latest regular week with a completed, scored game
//   unscoredResults        - completed games involving a drafted team whose game
//                            id isn't in any user's scoreByTeam yet (results the
//                            scheduled scoring jobs haven't picked up)
//   upToDate               - nothing outstanding to score
function computeAdminStatus(users, games, season) {
    const draftedIds = new Set();
    const scoredGameIds = new Set();
    let scoredThroughWeek = 0;

    (users || []).forEach(u => {
        const seasons = (u && u.seasons) || [];
        const s = seasons.find(x => String(x.season) === String(season)) || seasons[seasons.length - 1] || {};
        (s.teams || []).forEach(t => { if (t && t.id != null) draftedIds.add(Number(t.id)); });
        (s.weeklyScore || []).forEach(w => {
            if (w && w.season !== 'postseason' && typeof w.week === 'number' && w.week > scoredThroughWeek) {
                scoredThroughWeek = w.week;
            }
            ((w && w.scoreByTeam) || []).forEach(st => { if (st && st.gameId != null) scoredGameIds.add(Number(st.gameId)); });
        });
    });

    let gamesLoadedThroughWeek = 0;
    let unscoredResults = 0;
    (games || []).forEach(g => {
        const hasScore = typeof g.homePoints === 'number' && (g.homePoints || g.awayPoints);
        const done = g.completed && hasScore;
        if (!done) return;
        if (g.seasonType === 'regular' && typeof g.week === 'number' && g.week > gamesLoadedThroughWeek) {
            gamesLoadedThroughWeek = g.week;
        }
        const involvesDrafted = draftedIds.has(Number(g.homeId)) || draftedIds.has(Number(g.awayId));
        if (involvesDrafted && !scoredGameIds.has(Number(g.id))) unscoredResults++;
    });

    // "Up to date" is precisely: no completed drafted-team result is waiting to
    // be scored. The week fields are informational only — comparing them would
    // false-positive on non-drafted games or bye weeks.
    return {
        season: String(season),
        scoredThroughWeek,
        gamesLoadedThroughWeek,
        unscoredResults,
        upToDate: unscoredResults === 0
    };
}

module.exports = { computeAdminStatus };
