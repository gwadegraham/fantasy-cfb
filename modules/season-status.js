const User = require('../models/user');

// True once at least one drafted-team game has been scored in `season` for this
// league — the "season is underway" signal. Used to lock destructive edits
// (scoring config, season roster) for League Managers mid-season; only an admin
// (who can run a rescore) may change them once scoring has started.
async function hasScoredGames(league, season) {
    const hit = await User.exists({
        league,
        seasons: { $elemMatch: { season: Number(season), 'weeklyScore.scoreByTeam.0': { $exists: true } } }
    });
    return !!hit;
}

module.exports = { hasScoredGames };
