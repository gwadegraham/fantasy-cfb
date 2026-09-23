const franchiseRepo = require('./franchise-repo');

// True once at least one drafted-team game has been scored in `season` for this
// league — the "season is underway" signal. Used to lock destructive edits
// (scoring config, season roster) for League Managers mid-season; only an admin
// (who can run a rescore) may change them once scoring has started.
async function hasScoredGames(league, season) {
    // Fail CLOSED if the season isn't a usable number. This gates a permission
    // (League Managers can't edit scoring once the season is underway), and
    // Number(null) is 0 — which matches no season, reads as "nothing scored
    // yet", and quietly OPENS the lock. A league whose season can't be resolved
    // is treated as underway; the caller gets the safe answer, not the empty one.
    const n = Number(season);
    if (!Number.isFinite(n) || n === 0) {
        console.error(`hasScoredGames: unusable season ${JSON.stringify(season)} for ${league} — treating as underway`);
        return true;
    }
    return franchiseRepo.anyFranchise({
        league,
        seasons: { $elemMatch: { season: n, 'weeklyScore.scoreByTeam.0': { $exists: true } } }
    });
}

module.exports = { hasScoredGames };
