const express = require('express');
const router = express.Router();
const scoringModule = require('../modules/scoring.js');
const User = require('../models/user');
const Game = require('../models/game');
const ScoringConfig = require('../models/scoringConfig');
const Team = require('../models/team');
const { FBS_ONLY } = require('../modules/team-scope');
const Draft = require('../models/draft');
const League = require('../models/league');
const { computeAdminStatus, pendingRegularWeek } = require('../modules/admin-status');
const { computeSeasonReadiness } = require('../modules/season-readiness');
const { engagementForSeason, LEAGUES } = require('../modules/scoring-defaults');
const { canManageLeague } = require('../modules/league-access');
const { H2H_MAX_WEEK, seasonEntry, computeH2HAwards, applyAwards, pinnedH2HIds } = require('../modules/h2h');

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

// Does a regular-season week still need finalizing? Returns { season, week }
// with week = null when nothing is outstanding.
//
// The postseason branch of the scoring pipeline calls this because CFBD's
// postseason calendar window opens before the last regular-season game kicks off
// (see pendingRegularWeek for the 2026 Army–Navy case). Read-only, derived from
// data already on file, no CFBD calls — and it answers null the moment the
// trailing week's games are final, so the pipeline stops paying for the extra
// pull on its own.
//
// How long a game counts as outstanding is env-tunable for ops; the default
// covers the nightly + Sunday sweeps after a Saturday kickoff.
const PENDING_REGULAR_MAX_HOURS = Number(process.env.PENDING_REGULAR_MAX_HOURS) || 48;

router.get('/pending-regular/:season', async (req, res) => {
    try {
        const season = req.params.season;
        const users = await User.find(
            { 'seasons.season': season },
            { 'seasons.season': 1, 'seasons.teams.id': 1 }
        ).lean();
        const games = await Game.find(
            { season: Number(season), seasonType: 'regular', completed: { $ne: true } },
            { week: 1, seasonType: 1, completed: 1, startDate: 1, homeId: 1, awayId: 1, _id: 0 }
        ).lean();
        res.json({
            season: String(season),
            week: pendingRegularWeek(users, games, season, Date.now(), PENDING_REGULAR_MAX_HOURS)
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Preseason readiness: is this season actually ready to draft?
//
// The season-flip steps that feed draft grades and projections (schedule ingest,
// preseason enrichment, expected wins, CFP odds) all fail SILENTLY — they produce
// a plausible payload from stale or partial data rather than an error or an empty
// state. See docs/season-flip-runbook.md. This endpoint reads what's actually on
// file and reports it, so a missed step is visible before draft night instead of
// after the season is underway.
//
// Read-only, derived entirely from existing data — no writes, no CFBD calls.
// League rows are scoped to what the caller may manage (Admins: every league;
// League Managers: their own), mirroring the /rules league gate.
router.get('/readiness/:season', async (req, res) => {
    try {
        const season = req.params.season;
        const seasonNum = Number(season);

        // Only the readiness fields off each season subdoc — a bare `seasons: 1`
        // drags every team's weeklyScore array along for no reason.
        const teams = await Team.find(FBS_ONLY, {
            id: 1, 'seasons.season': 1, 'seasons.talent': 1, 'seasons.spRating': 1,
            'seasons.expectedWins': 1, 'seasons.cfpMakeOdds': 1, 'seasons.cfpChampOdds': 1,
            // coach + returningProduction aren't shown anywhere; they're carried
            // so readiness can tell an enrichment run that never happened from
            // one that ran while CFBD had no talent composite to give.
            'seasons.coach': 1, 'seasons.returningProduction': 1
        }).lean();
        const teamTotal = teams.length;
        const fbsIds = new Set(teams.map(t => t.id));
        const teamsWith = { talent: 0, spRating: 0, expectedWins: 0, cfpOdds: 0, coach: 0, returning: 0 };
        teams.forEach(t => {
            const s = (t.seasons || []).find(x => Number(x.season) === seasonNum);
            if (!s) return;
            if (s.talent != null) teamsWith.talent++;
            if (s.spRating != null) teamsWith.spRating++;
            if (s.expectedWins != null) teamsWith.expectedWins++;
            if (s.cfpMakeOdds != null || s.cfpChampOdds != null) teamsWith.cfpOdds++;
            if (s.coach != null) teamsWith.coach++;
            if (s.returningProduction != null) teamsWith.returning++;
        });

        // Schedule coverage: a full ingest reaches essentially every team, so
        // distinct teams-with-a-game separates "loaded" from "partially loaded".
        // Counted against FBS teams ONLY — the schedule is full of FCS and other
        // non-FBS opponents whose ids never appear in the Team collection, so
        // counting them raw gives more "scheduled teams" than teams that exist
        // (350 of 138 on real 2026 data) and makes the ratio meaningless.
        const games = await Game.find(
            { season: seasonNum, seasonType: 'regular' },
            { homeId: 1, awayId: 1, completed: 1, homePoints: 1, awayPoints: 1, _id: 0 }
        ).lean();
        const scheduled = new Set();
        games.forEach(g => {
            if (fbsIds.has(g.homeId)) scheduled.add(g.homeId);
            if (fbsIds.has(g.awayId)) scheduled.add(g.awayId);
        });

        // Has the season actually started? Mirrors computeAdminStatus's
        // gamesLoadedThroughWeek — a completed game with points on it. The client
        // retires the panel on this, so it doesn't depend on a second endpoint
        // (and can't be hidden by a mere weeklyScore row, which the nightly job
        // creates for everyone the moment a season roster exists).
        const seasonUnderway = games.some(g =>
            g.completed && typeof g.homePoints === 'number' && (g.homePoints || g.awayPoints));

        // Per-league setup. Only the fields needed — season rosters carry heavy
        // weeklyScore arrays we don't read here.
        const members = await User.find({ 'seasons.season': season }, { league: 1 }).lean();
        const memberCount = {};
        members.forEach(m => { memberCount[m.league] = (memberCount[m.league] || 0) + 1; });
        const drafts = await Draft.find({ season: seasonNum }).lean();
        const configs = await ScoringConfig.find({}, { league: 1, engagementBySeason: 1 }).lean();
        const names = await League.find({}, { code: 1, name: 1, _id: 0 }).lean();
        const nameByCode = {};
        names.forEach(n => { nameByCode[n.code] = n.name; });

        const visible = LEAGUES.filter(l => canManageLeague(req, l.code));
        const leagues = visible.map(l => {
            const cfg = configs.find(c => c.league === l.code);
            return {
                code: l.code,
                name: nameByCode[l.code] || l.name,
                members: memberCount[l.code] || 0,
                draft: drafts.find(d => d.league === l.code) || null,
                engagement: engagementForSeason(cfg && cfg.engagementBySeason, season)
            };
        });

        res.json(computeSeasonReadiness({
            season, teamTotal, teamsWith,
            scheduledTeams: scheduled.size, gameCount: games.length,
            leagues, seasonUnderway
        }));
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
        // The frozen manager list for this season, if one has been stored. Passed
        // through so a membership change can never re-pair an already-settled
        // week (see modules/h2h.js h2hRoster).
        const pinnedIds = pinnedH2HIds(cfgDoc, seasonStr);

        // Only load games when there's a chance of awarding. With H2H off the
        // award map stays empty, which still strips any previously-stored bonus.
        let awards = {}, computed = null;
        if (eng.h2hEnabled) {
            const drafted = new Set();
            users.forEach(u => {
                const s = seasonEntry(u, seasonStr);
                ((s && s.teams) || []).forEach(t => drafted.add(Number(t.id)));
            });
            const idList = [...drafted];
            const games = idList.length ? await Game.find(
                { season: seasonNum, seasonType: 'regular', week: { $lte: H2H_MAX_WEEK },
                  $or: [{ homeId: { $in: idList } }, { awayId: { $in: idList } }] },
                { id: 1, week: 1, seasonType: 1, completed: 1, homeId: 1, awayId: 1, _id: 0 }
            ).lean() : [];
            computed = computeH2HAwards({
                users, games, season: seasonStr, pinnedIds,
                winBonus: eng.h2hWinBonus, tieBonus: eng.h2hTieBonus
            });
            awards = computed.awards;
        }

        let updated = 0, awarded = 0;
        for (const user of users) {
            const s = seasonEntry(user, seasonStr);
            if (!s) continue;
            const plain = (s.weeklyScore || []).map(e => (e.toObject ? e.toObject() : e));
            const next = applyAwards(plain, awards[String(user._id)], H2H_MAX_WEEK);
            if (!next.changed) continue;
            s.weeklyScore = next.weeklyScore;
            user.markModified('seasons');
            await user.save();
            updated++;
            awarded += next.weeklyScore.reduce((sum, e) => sum + (e.h2hBonus || 0), 0);
        }
        // Freeze the manager list the moment the first week settles. Everything
        // before that is unbanked, so the list stays live and preseason roster
        // churn costs nothing; from here on, no membership change can re-decide a
        // week that has already paid out.
        let pinned = false;
        if (eng.h2hEnabled && !pinnedIds && computed && computed.finalWeeks.length && computed.ids.length) {
            await ScoringConfig.updateOne(
                { league },
                { $set: { ['h2hScheduleBySeason.' + seasonStr]: { ids: computed.ids, pinnedAt: new Date() } } },
                { upsert: true }
            );
            pinned = true;
            console.log(`H2H roster pinned · ${league} ${seasonStr}: ${computed.ids.length} manager(s)`);
        }

        summary.push({ league, enabled: !!eng.h2hEnabled, managersUpdated: updated, bonusAwarded: awarded, rosterPinned: pinned });
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

        try { const { resolveParlays } = require('../modules/parlay-resolve'); await resolveParlays(); } catch (_) {}

        res.status(200).json({"seasonType": seasonType, "weekNumber": weekNumber});
    } catch (err) {
        res.status(500).json({message: err.message});
    }
});

router.post('/enrichment-run', async (req, res) => {
    try {
        const enrichmentJob = require('../update-enrichment-job');
        const results = await enrichmentJob.run();
        const teamsUpdated = results.teams ? (results.teams.body.updated || 0) : 0;
        const mediaUpdated = results.media ? (results.media.body.updated || 0) : 0;
        const wpUpdated = results.pregameWP ? (results.pregameWP.body.updated || 0) : 0;
        const wxUpdated = results.weather ? (results.weather.body.updated || 0) : 0;
        const parts = [`${teamsUpdated} teams`, `${mediaUpdated} media`];
        if (wpUpdated) parts.push(`${wpUpdated} pregame WP`);
        if (wxUpdated) parts.push(`${wxUpdated} weather`);
        res.json({ summary: parts.join(' · ') });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;