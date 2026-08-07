const express = require('express');
const router = express.Router();
const scoringModule = require('../modules/scoring.js');
const User = require('../models/user');
const Game = require('../models/game');
const ScoringConfig = require('../models/scoringConfig');
const { computeAdminStatus } = require('../modules/admin-status');
const { engagementForSeason } = require('../modules/scoring-defaults');
const { H2H_LAST_WEEK, seasonEntry, computeH2HAwards, applyAwards } = require('../modules/h2h');

// Read-only status summary for the admin console: how far scoring/games have
// progressed and whether any completed results are still unscored. Derived from
// existing data — no new job instrumentation.
router.get('/status/:season', async (req, res) => {
    try {
        const season = req.params.season;
        const users = await User.find({ "seasons.season": season });
        const games = await Game.find(
            { season: Number(season) },
            { id: 1, week: 1, seasonType: 1, completed: 1, homeId: 1, awayId: 1, homePoints: 1, awayPoints: 1, _id: 0 }
        );
        res.json(computeAdminStatus(users, games, season));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Fold each league's head-to-head win/tie bonuses into the stored weekly scores.
//
// Why this is a separate pass: a week's H2H result depends on EVERY manager's
// total for that week, so it can't be resolved inside updateScores' per-user
// loop. It runs after scoring and before updateCumulativeScores, which then sums
// the bonus into cumulativeScore for free — the same way the Captain bonus rides
// along. That is what keeps the Hall of Fame champion, the My Team rank, the
// weekly recap, and the projections agreeing with the standings table.
//
// Safe to run at any time, for any league, in any state:
//   - only weeks that have SETTLED (every drafted team's game complete) award;
//   - each entry's score is rebuilt from its base, so re-running, rescoring, or
//     changing the configured bonus converges instead of compounding;
//   - a league with H2H off has any stale bonus stripped back out.
async function applyH2HBonuses(season) {
    const seasonStr = String(season);
    const seasonNum = Number(season);
    const leagues = await User.distinct('league', { 'seasons.season': seasonStr });
    const summary = [];

    for (const league of leagues) {
        if (!league) continue;
        const users = await User.find({ league, 'seasons.season': seasonStr });
        if (!users.length) continue;

        const cfgDoc = await ScoringConfig.findOne({ league }).lean();
        const eng = engagementForSeason(cfgDoc && cfgDoc.engagementBySeason, seasonStr);

        // Only load games when there's a chance of awarding. With H2H off the
        // award map stays empty, which still strips any previously-stored bonus.
        let awards = {};
        if (eng.h2hEnabled) {
            const drafted = new Set();
            users.forEach(u => {
                const s = seasonEntry(u, seasonStr);
                ((s && s.teams) || []).forEach(t => drafted.add(Number(t.id)));
            });
            const idList = [...drafted];
            const games = idList.length ? await Game.find(
                { season: seasonNum, seasonType: 'regular', week: { $lte: H2H_LAST_WEEK },
                  $or: [{ homeId: { $in: idList } }, { awayId: { $in: idList } }] },
                { id: 1, week: 1, seasonType: 1, completed: 1, homeId: 1, awayId: 1, _id: 0 }
            ).lean() : [];
            awards = computeH2HAwards({
                users, games, season: seasonStr,
                winBonus: eng.h2hWinBonus, tieBonus: eng.h2hTieBonus
            }).awards;
        }

        let updated = 0, awarded = 0;
        for (const user of users) {
            const s = seasonEntry(user, seasonStr);
            if (!s) continue;
            const plain = (s.weeklyScore || []).map(e => (e.toObject ? e.toObject() : e));
            const next = applyAwards(plain, awards[String(user._id)], H2H_LAST_WEEK);
            if (!next.changed) continue;
            s.weeklyScore = next.weeklyScore;
            user.markModified('seasons');
            await user.save();
            updated++;
            awarded += next.weeklyScore.reduce((sum, e) => sum + (e.h2hBonus || 0), 0);
        }
        summary.push({ league, enabled: !!eng.h2hEnabled, managersUpdated: updated, bonusAwarded: awarded });
        console.log(`H2H bonus · ${league}: ${eng.h2hEnabled ? 'on' : 'off'}, ${updated} manager(s) updated`);
    }

    return summary;
}

// Exposed so the scoring jobs can run the pass over the internal API, matching
// how every other scoring step reaches the DB (see modules/scoring.js).
router.post('/h2h-bonus', async (req, res) => {
    try {
        const season = (req.body && req.body.season) || process.env.YEAR;
        const leagues = await applyH2HBonuses(season);
        res.status(200).json({ season: String(season), leagues });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Recalculating & Updating Scores
router.post('/update', async (req, res) => {
    try {
        var seasonType = req.body.seasonType;
        var weekNumber = req.body.week;

        await scoringModule.updateScores(seasonType, weekNumber);
        // Before cumulative totals: the bonus is folded into the weekly scores
        // that updateCumulativeScores then sums.
        await applyH2HBonuses(process.env.YEAR);
        await scoringModule.updateCumulativeScores();

        res.status(200).json({"seasonType": seasonType, "weekNumber": weekNumber});
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});
module.exports = router;