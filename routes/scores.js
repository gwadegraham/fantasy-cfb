const express = require('express');
const franchiseRepo = require('../modules/franchise-repo');
const { activeSeason, sportForLeague } = require('../modules/active-season');
const router = express.Router();
const scoringModule = require('../modules/scoring.js');
const Game = require('../models/game');
const ScoringConfig = require('../models/scoringConfig');
const Team = require('../models/team');
const { FBS_ONLY } = require('../modules/team-scope');
const Draft = require('../models/draft');
const League = require('../models/league');
const { computeAdminStatus, pendingRegularWeek } = require('../modules/admin-status');
const { computeSeasonReadiness } = require('../modules/season-readiness');
const { engagementForSeason } = require('../modules/scoring-defaults');
const leagueCatalog = require('../modules/league-catalog');
const { canManageLeague } = require('../modules/league-access');
const { H2H_MAX_WEEK, seasonEntry, computeH2HAwards, pinnedH2HIds } = require('../modules/h2h');
const { bankLeague } = require('../modules/h2h-settle');

// Read-only status summary for the admin console: how far scoring/games have
// progressed and whether any completed results are still unscored. Derived from
// existing data — no new job instrumentation.
router.get('/status/:season', async (req, res) => {
    try {
        const season = req.params.season;
        const users = await franchiseRepo.bySeason(season, { projectSeason: false });
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
        const users = await franchiseRepo.bySeason(season,
            { projectSeason: false, fields: ['seasons.season', 'seasons.teams.id'] });
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
        const members = await franchiseRepo.bySeason(season, { projectSeason: false, fields: ['league'] });
        const memberCount = {};
        members.forEach(m => { memberCount[m.league] = (memberCount[m.league] || 0) + 1; });
        const drafts = await Draft.find({ season: seasonNum }).lean();
        const configs = await ScoringConfig.find({}, { league: 1, engagementBySeason: 1 }).lean();
        const names = await League.find({}, { code: 1, name: 1, _id: 0 }).lean();
        const nameByCode = {};
        names.forEach(n => { nameByCode[n.code] = n.name; });

        // From the catalog: enumerating the hardcoded array silently omitted
        // a database-only league from the readiness panel, so an Admin read
        // "ready to score" as a complete answer when a whole league was not
        // in it.
        const visible = (await leagueCatalog.catalog(req)).filter(l => canManageLeague(req, l.code));
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

// Is this a season we can actually query for?
//
// Shared by both routes that reach applyH2HBonuses, so the two cannot drift.
// Number(null) is 0 and finite, which is why this is not isFinite alone.
function isRealSeason(season) {
    const n = Number(season);
    return Number.isFinite(n) && n > 0;
}

// The managers of one league, carrying ONLY what the H2H pass reads, moved to
// modules/franchise-repo.js as h2hManagers (#313 phase 2), along with the
// measurements that justify the pipeline and the number-vs-string season trap
// that makes it fail silently. isRealSeason above is what makes that trap loud;
// the guard inside applyH2HBonuses says why.

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
    // Both forms are needed, and which one goes where is not arbitrary:
    //   seasonNum — every QUERY, without exception. The aggregate REQUIRES it
    //               (a pipeline gets no Mongoose casting — see h2hManagers in
    //               modules/franchise-repo.js), and find/distinct/update cast
    //               either way, so there is no reason
    //               for them to disagree with it and one good reason not to.
    //   seasonStr — object KEYS, which are strings in Mongo:
    //               engagementBySeason[season] and h2hScheduleBySeason[season].
    //               Also what computeH2HAwards/seasonEntry take, though those
    //               stringify internally and would accept either.
    // A new query added here wants seasonNum. A new keyed lookup wants seasonStr.
    const seasonStr = String(season);
    const seasonNum = Number(season);

    // Guard, not decoration. franchiseRepo.h2hManagers $matches on seasonNum,
    // and an aggregate gets no Mongoose casting — so a season that is not a real
    // number silently matches nothing, and this pass reports "0 manager(s)
    // updated" for every league while awarding nothing. The comment on
    // h2hManagers explains the trap; this is what makes hitting it loud instead
    // of quiet.
    //
    // Number(null) is 0 and finite, which is why this is not just isFinite.
    if (!isRealSeason(season)) {
        throw new Error(`applyH2HBonuses needs a real season, got ${JSON.stringify(season)}`);
    }

    const leagues = await franchiseRepo.leaguesWithSeason(seasonNum);
    const summary = [];

    // isRealSeason only rejects things that are not numbers. A well-formed
    // season nobody has played — a typo'd 1999, or a rollover that ran early —
    // gets past it, finds no managers, and returns an empty summary that reads
    // exactly like a successful no-op. Say so.
    if (!leagues.length) {
        console.error(`H2H bonus: no managers found for season ${seasonStr} — nothing was applied`);
    }

    // No `if (!league) continue;` here any more: leaguesWithSeason filters falsy
    // leagues out itself, and says so, because a guard in both places reads like
    // neither is load-bearing.
    for (const league of leagues) {
        // FOOTBALL leagues only. Every league with a manager in this season
        // comes back from leaguesWithSeason, and a basketball league's season
        // is a different year only until football rolls over to it — 2027
        // football and 2026-27 basketball are both "2027". Its matchups are
        // decided from basketball games by modules/hoops-h2h.js; reading
        // them from football's `games` here would re-decide every settled
        // basketball week against the wrong sport (130 team ids collide).
        if (sportForLeague(league) === 'basketball') continue;
        const users = await franchiseRepo.h2hManagers(league, seasonNum);
        if (!users.length) continue;

        const cfgDoc = await ScoringConfig.findOne({ league }).lean();
        const eng = engagementForSeason(cfgDoc && cfgDoc.engagementBySeason, seasonStr);
        // The frozen manager list for this season, if one has been stored. Passed
        // through so a membership change can never re-pair an already-settled
        // week (see modules/h2h.js h2hRoster).
        const pinnedIds = pinnedH2HIds(cfgDoc, seasonStr);

        // Only load games when there's a chance of awarding. With H2H off the
        // award map stays empty, which still strips any previously-stored bonus.
        let computed = null;
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
        }

        const banked = await bankLeague({ league, seasonNum, seasonStr, users, eng, pinnedIds, computed, maxWeek: H2H_MAX_WEEK });
        const updated = banked.managersUpdated, awarded = banked.bonusAwarded, pinned = banked.rosterPinned;
        summary.push({ league, enabled: !!eng.h2hEnabled, managersUpdated: updated, bonusAwarded: awarded, rosterPinned: pinned });
        console.log(`H2H bonus · ${league}: ${eng.h2hEnabled ? 'on' : 'off'}, ${updated} manager(s) updated`);
    }

    return summary;
}

// Exposed so the scoring jobs can run the pass over the internal API, matching
// how every other scoring step reaches the DB (see modules/scoring.js).
router.post('/h2h-bonus', async (req, res) => {
    try {
        const season = (req.body && req.body.season) || activeSeason('football');
        // Checked here too, not just on /update. This is the route the NIGHTLY
        // path uses (modules/scoring.js applyH2HBonuses -> here), so a season
        // that cannot be matched should say so in the same words from either
        // entry point rather than arriving as a bare throw from two layers down.
        //
        // Nothing has written by this point on this route — it only runs the H2H
        // pass — so unlike /update there is no partial state at stake here.
        // 400, not 500: the season arrives in the request body, so a bad one is
        // the caller's mistake. /update's is a 500 because there the season comes
        // from server state. Both still fail in the same words.
        if (!isRealSeason(season)) {
            return res.status(400).json({ message: `No active football season to score (got ${JSON.stringify(season)})` });
        }
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

        // Resolved and checked BEFORE anything writes.
        //
        // applyH2HBonuses throws on a season it cannot match (see the guard
        // there). Letting that fire mid-pipeline would be worse than the silent
        // no-op it replaced: updateScores has already rewritten this week's
        // weekly rows by then, so a throw skips updateCumulativeScores and
        // strands cumulativeScore holding a bonus the weekly rows no longer
        // carry. That is the 14 Sep 2026 drift exactly — the standings read model
        // adds the win a second time while the weekly recap renders it missing,
        // two screens disagreeing with no error anywhere. There is a test for it
        // in tests/H2HBonusPersistence.spec.js.
        //
        // Failing here instead costs nothing: no pass has run, so there is no
        // partial state to reconcile.
        //
        // This ordering matters for THIS route specifically, because it is the
        // one that writes before reaching H2H. POST /h2h-bonus carries the same
        // check for a consistent message, but has nothing to strand.
        //
        // Note this is a full stop, not a degrade, which is deliberately the
        // opposite of the principle in modules/score-update.js:341. That one is
        // about a failed INGEST, where the games are already stored and still
        // scoreable, so carrying on loses nothing. With no resolvable season
        // there is nothing to carry on WITH: updateScores would resolve the same
        // missing season, fetch /users/season/null, find no managers and score
        // everyone zero. Refusing is the degraded behaviour here.
        const h2hSeason = activeSeason('football');
        if (!isRealSeason(h2hSeason)) {
            return res.status(500).json({ message: `No active football season to score (got ${JSON.stringify(h2hSeason)})` });
        }

        await scoringModule.updateScores(seasonType, weekNumber);
        // Before cumulative totals: the bonus is folded into the weekly scores
        // that updateCumulativeScores then sums.
        await applyH2HBonuses(h2hSeason);
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