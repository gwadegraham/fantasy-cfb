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

// The highest regular-season week that still has unfinished business: a game
// involving a drafted team that has kicked off but isn't marked complete. null
// when every kicked-off regular-season game is final.
//
// This exists because CFBD's postseason calendar window OPENS BEFORE the last
// regular-season game kicks off. In 2026 the week-15 window closes
// 2026-12-12T07:59Z while Army–Navy — a week-15 regular-season game — kicks off
// at 20:00Z the same day. From 2am CT that morning the pipeline resolves to the
// postseason and pulls `seasonType=postseason`, which never contains that game,
// so week 15 would keep the 0 it was seeded with. The postseason pipeline
// consults this to catch the trailing week without a calendar heuristic.
//
// Two bounds keep it from costing a CFBD call forever:
//   - drafted teams only. The Game collection also holds non-FBS rows from older
//     ingests; one of those left un-completed would pin a week open for good.
//   - `maxHours` since kickoff. A game still not final days later is stuck data,
//     not live business.
function pendingRegularWeek(users, games, season, nowMs, maxHours) {
    const windowMs = (maxHours || 48) * 3600 * 1000;

    const draftedIds = new Set();
    (users || []).forEach(u => {
        const seasons = (u && u.seasons) || [];
        const s = seasons.find(x => String(x.season) === String(season));
        ((s && s.teams) || []).forEach(t => { if (t && t.id != null) draftedIds.add(Number(t.id)); });
    });
    if (!draftedIds.size) return null;

    let pending = null;
    (games || []).forEach(g => {
        if (!g || g.seasonType !== 'regular' || typeof g.week !== 'number') return;
        if (g.completed === true) return;
        const start = Date.parse(g.startDate);
        if (Number.isNaN(start) || start > nowMs || (nowMs - start) > windowMs) return;
        if (!draftedIds.has(Number(g.homeId)) && !draftedIds.has(Number(g.awayId))) return;
        if (pending == null || g.week > pending) pending = g.week;
    });
    return pending;
}

module.exports = { computeAdminStatus, pendingRegularWeek };
