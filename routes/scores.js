const express = require('express');
const { activeSeason } = require('../modules/active-season');
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

// Is this a season we can actually query for?
//
// Shared by both routes that reach applyH2HBonuses, so the two cannot drift.
// Number(null) is 0 and finite, which is why this is not isFinite alone.
function isRealSeason(season) {
    const n = Number(season);
    return Number.isFinite(n) && n > 0;
}

// The managers of one league, carrying ONLY what the H2H pass reads.
//
// This was User.find({ league, 'seasons.season' }) with no projection, which
// answered every field of every season a manager has ever played. Measured
// against a dev copy of prod, for the two leagues:
//
//   unprojected                         1059KB, 11325ms
//   projected to teams.id + weeklyScore  435KB,  4192ms
//   this aggregate                         40KB,   608ms
//
// A plain projection cannot get there, though NOT for the reason it looks like.
// A nested projection DOES slim subdocuments — {'seasons.teams.id': 1} really
// does return teams as [{id}], and routes/scores.js relies on that elsewhere.
// That is what takes 1059KB to 435KB.
//
// What a projection cannot do is drop array ELEMENTS. It slims fields across
// ALL FOUR of a manager's seasons, and the 435KB that remains is the three
// seasons this pass is not scoring — mostly their weeklyScore. $elemMatch and
// the positional projection can pick the one element, but they return it WHOLE
// and cannot be combined with a nested field projection, so the full team
// objects come back. $filter picks the element and $map slims it, which is why
// this is an aggregate.
//
// weeklyScore is kept WHOLE on purpose. Trimming it to the six fields the
// computation reads gets this to 4KB/117ms, but the caller writes the array back,
// so a trimmed read would silently drop scoreByTeam and the Captain fields off
// every entry. 0.5s is not worth that.
//
// SEASON IS A NUMBER HERE, deliberately. models/user.js declares
// seasonSchema.season as Number, and the other queries in this function pass the
// string — which works only because Mongoose casts it against the schema. An
// aggregate pipeline gets NO casting: $match with '2026' matches nothing, returns
// zero managers, and this pass then skips the league and applies no bonuses at
// all, with a clean log line saying "0 manager(s) updated".
async function h2hUsers(league, seasonNum) {
    return User.aggregate([
        { $match: { league, 'seasons.season': seasonNum } },
        { $project: {
            seasons: {
                $map: {
                    input: {
                        $filter: {
                            input: { $ifNull: ['$seasons', []] },
                            as: 's',
                            cond: { $eq: ['$$s.season', seasonNum] }
                        }
                    },
                    as: 's',
                    in: {
                        season: '$$s.season',
                        // Only the id is read, to build the drafted-team set.
                        teams: {
                            $map: {
                                input: { $ifNull: ['$$s.teams', []] },
                                as: 't',
                                in: { id: '$$t.id' }
                            }
                        },
                        weeklyScore: { $ifNull: ['$$s.weeklyScore', []] }
                    }
                }
            }
        } }
    ]);
}

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
    //   seasonNum — anything the AGGREGATE touches, because a pipeline gets no
    //               Mongoose casting (see h2hUsers). Safe for find/update
    //               filters too, which cast either way.
    //   seasonStr — object KEYS, which are strings in Mongo:
    //               engagementBySeason[season] and h2hScheduleBySeason[season].
    //               Also what computeH2HAwards/seasonEntry take, though those
    //               stringify internally and would accept either.
    // A new query added here wants seasonNum. A new keyed lookup wants seasonStr.
    const seasonStr = String(season);
    const seasonNum = Number(season);

    // Guard, not decoration. h2hUsers below $matches on seasonNum, and an
    // aggregate gets no Mongoose casting — so a season that is not a real number
    // silently matches nothing, and this pass reports "0 manager(s) updated" for
    // every league while awarding nothing. The comment on h2hUsers explains the
    // trap; this is what makes hitting it loud instead of quiet.
    //
    // Number(null) is 0 and finite, which is why this is not just isFinite.
    if (!isRealSeason(season)) {
        throw new Error(`applyH2HBonuses needs a real season, got ${JSON.stringify(season)}`);
    }

    const leagues = await User.distinct('league', { 'seasons.season': seasonStr });
    const summary = [];

    for (const league of leagues) {
        if (!league) continue;
        const users = await h2hUsers(league, seasonNum);
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
            // Write the ONE array that changed, not the whole manager.
            //
            // user.save() rewrote the entire document — 105KB, of which
            // seasons[].teams is nearly all — to persist a 3KB weeklyScore, and
            // measured 1239ms against 95ms for this. The positional $ resolves
            // against the season matched in the filter, so it can only ever touch
            // the season being scored.
            //
            // applyAwards returns the FULL entries (it copies each one and edits
            // four fields), so this is lossless: scoreByTeam, the Captain fields
            // and anything else on an entry are written back as they were read.
            // That is exactly why the read below keeps weeklyScore whole instead
            // of trimming it to the six fields the computation needs — a trimmed
            // read would make this write silently destroy the rest.
            //
            // One real difference from the save() this replaces: updateOne does
            // NOT run schema validators (update validators are off by default),
            // and weeklyScoreSchema marks week and score required. Nothing
            // reachable regresses — applyAwards always writes a numeric score
            // (round1 of baseWeekScore, which floors a missing one to 0) and
            // copies week through untouched — but an entry that was already
            // malformed now persists instead of being rejected here.
            const res = await User.updateOne(
                { _id: user._id, 'seasons.season': seasonNum },
                { $set: { 'seasons.$.weeklyScore': next.weeklyScore } }
            );
            if (!res.matchedCount) {
                // Loud: a manager whose bonus could not be written is a standings
                // row that silently disagrees with every other surface.
                console.error(`H2H bonus not written for ${user._id} (${league} ${seasonStr}): no matching season`);
                continue;
            }
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
        const season = (req.body && req.body.season) || activeSeason('football');
        // Checked here too, not just on /update. This is the route the NIGHTLY
        // path uses (modules/scoring.js applyH2HBonuses -> here), so a season
        // that cannot be matched should say so in the same words from either
        // entry point rather than arriving as a bare throw from two layers down.
        //
        // Nothing has written by this point on this route — it only runs the H2H
        // pass — so unlike /update there is no partial state at stake here.
        if (!isRealSeason(season)) {
            return res.status(500).json({ message: `No active football season to score (got ${JSON.stringify(season)})` });
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