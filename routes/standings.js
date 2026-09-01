const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Team = require('../models/team');
const Record = require('../models/record');
const Game = require('../models/game');
const Betting = require('../models/bettingLine');
const Draft = require('../models/draft');
const Ranking = require('../models/ranking');
const ScoringConfig = require('../models/scoringConfig');
const JobRun = require('../models/jobRun');
const { resolveConfig, engagementForSeason, overridesFromDoc } = require('../modules/scoring-defaults');
const { buildRankingProxy, buildPoolContext, projectTeamPoints } = require('../modules/draft-projection');
const { buildProjections, simulateTitleOdds } = require('../modules/standings-projection');
const { buildAdvancedHighlights } = require('../modules/standings-highlights');
const { buildWeeklyRecaps, indexUpsets } = require('../modules/weekly-recap');
// Shared with the classic standings table and My Team, so a tied placement reads
// the same everywhere.
const { competitionRanks } = require('../public/league-rank.js');
const { gameStatus, matchupWinProb, H2H_MAX_WEEK, baseWeekScore, persistedBonus,
        h2hRoster, pinnedH2HIds, computeH2HAwards } = require('../modules/h2h');
const { findPoll } = require('../modules/scoring-detectors');
const { pickLogo } = require('../public/logo.js');
const { resolveCaptain } = require('../modules/captain');

// The poll the PROJECTIONS should value a hypothetical ranked win against: the
// most recent regular-season poll on file.
//
// Draft grades and the draft board (routes/draft.js) deliberately do the
// opposite — they read week 1 and stay there — because a grade is a preseason
// judgment about a preseason roster and must not drift as the top 25 reshuffles.
// A projection is the opposite kind of claim: it forecasts what the REMAINING
// schedule is worth, so a team that climbed into the top 10 in October should
// have its wins valued at October's rank, not August's.
//
// Uses the engine's own findPoll rather than plucking 'AP Top 25' directly, so
// the projection prefers the Playoff Committee Rankings exactly when scoring
// does. Picking AP by hand meant that from the committee's first release onward,
// a projected "beat a ranked team" bonus could be worth something different than
// the same win actually banked. Returns null when no poll is stored, which
// buildRankingProxy answers with its SP+-derived stand-in.
async function projectionPoll(season) {
    const doc = await Ranking.findOne({ season, seasonType: 'regular' }).sort({ week: -1 }).lean();
    return findPoll(doc);
}

// The scoring jobs that actually refresh standings data (see modules/score-job.js
// and modules/live-poll.js). 'live-scores' is the game-day live poller, so the
// "data as of" time advances during live play too.
const SCORING_JOBS = ['daily-scores', 'saturday-scores', 'sunday-scores', 'live-scores'];

// The honest "data as of" time for the standings: the most recent SUCCESSFUL
// scoring run. Unlike user.lastUpdated — which is bumped by unrelated writes
// (roster toggles, draft/season assignment, new managers) and isn't gated on job
// success — this only moves when a scoring job actually completed. Returns the
// run record, or null if no scoring job has ever succeeded.
router.get('/last-updated', async (req, res) => {
    try {
        const run = await JobRun.findOne(
            { jobName: { $in: SCORING_JOBS }, status: 'success' },
            { finishedAt: 1, startedAt: 1, jobName: 1, week: 1, seasonType: 1, season: 1 },
            { sort: { finishedAt: -1 } }
        ).lean();
        res.json(run || null);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Lightweight "is H2H on for this league/season?" — reads ONLY the config doc,
// not the heavy /h2h payload (schedule + win-prob compute). The client uses this
// to pick the standings layout before first paint, so an H2H league doesn't
// flash the classic table while the full payload loads.
router.get('/h2h/:league/:season/enabled', async (req, res) => {
    try {
        const cfg = await ScoringConfig.findOne({ league: req.params.league }).lean();
        const eng = engagementForSeason(cfg && cfg.engagementBySeason, req.params.season);
        res.json({ enabled: !!eng.h2hEnabled });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Advanced league highlights that need data the Standings payload doesn't carry
// (records/xWins, games+rankings, draft order). Read-only; returns cards in the
// same shape the client's buildHighlightsHtml renders.
router.get('/highlights/:league/:season', async (req, res) => {
    try {
        const league = req.params.league;
        const season = req.params.season;          // users store season as a string
        const seasonNum = Number(season);
        const scoreKey = league === 'graham-league' ? 'cumulativeScoreV2' : 'cumulativeScoreV1';

        // Drafted teams across the league's rosters.
        const users = await User.find({ league: league, 'seasons.season': season });
        const draftedIds = new Set();
        const draftedNames = new Set();
        const metaById = {};
        const metaByName = {};
        users.forEach(u => {
            const s = (u.seasons || []).find(x => String(x.season) === String(season));
            ((s && s.teams) || []).forEach(t => {
                draftedIds.add(Number(t.id));
                draftedNames.add(t.school);
                const meta = { id: t.id, mascot: t.mascot, school: t.school, logos: t.logos };
                metaById[t.id] = meta;
                metaByName[t.school] = meta;
            });
        });

        // Fantasy points each owner banked from a team in a given game, keyed
        // gameId -> { teamName -> points } (for the Biggest Upset detail line).
        const fantasyByGameId = {};
        users.forEach(u => {
            const s = (u.seasons || []).find(x => String(x.season) === String(season));
            ((s && s.weeklyScore) || []).forEach(wk => {
                (wk.scoreByTeam || []).forEach(st => {
                    if (st.gameId == null || st.team == null) return;
                    (fantasyByGameId[st.gameId] || (fantasyByGameId[st.gameId] = {}))[st.team] = st.score || 0;
                });
            });
        });
        const idList = [...draftedIds];
        if (!idList.length) return res.json([]);

        // Per-team season score in this league's model (for Draft Steal).
        const teams = await Team.find({ id: { $in: idList } }, { id: 1, seasons: 1 });
        const scoreById = {};
        teams.forEach(t => {
            const s = (t.seasons || []).find(x => Number(x.season) === seasonNum);
            if (s) scoreById[t.id] = s[scoreKey] || 0;
        });

        // Records (actual wins + expected wins) for drafted teams.
        const records = (await Record.find({ year: seasonNum, teamId: { $in: idList } }))
            .map(r => ({ teamId: r.teamId, team: r.team, expectedWins: r.expectedWins, total: r.total }));

        // Draft pick order (for Draft Steal).
        const draft = await Draft.findOne({ league: league, season: seasonNum });
        const picks = (draft && draft.picks) || [];

        // Regular-season games involving drafted teams + betting spreads by game
        // (for Biggest Upset).
        const games = await Game.find(
            { season: seasonNum, seasonType: 'regular', $or: [{ homeId: { $in: idList } }, { awayId: { $in: idList } }] },
            { id: 1, week: 1, homeTeam: 1, awayTeam: 1, homePoints: 1, awayPoints: 1, completed: 1, _id: 0 }
        );
        const betting = await Betting.find({ season: seasonNum, seasonType: 'regular' }, { id: 1, lines: 1, _id: 0 });
        const spreadByGameId = {};
        betting.forEach(b => {
            const lines = b.lines || [];
            const line = lines.find(l => l.provider === 'DraftKings') || lines[0];
            if (line && typeof line.spread === 'number') spreadByGameId[b.id] = line.spread;
        });

        res.json(buildAdvancedHighlights({ records, metaById, picks, scoreById, games, spreadByGameId, draftedNames, metaByName, fantasyByGameId }));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Forward-looking analytics: projected final points + Monte-Carlo title odds
// per manager for a league + season. Reuses the draft-grade projection engine
// on each rostered team's REMAINING schedule. Read-only.
router.get('/projections/:league/:season', async (req, res) => {
    try {
        const league = req.params.league;
        const season = Number(req.params.season);

        const users = await User.find(
            { league, 'seasons.season': season },
            { firstName: 1, lastName: 1, avatarUrl: 1, color: 1, seasons: { $elemMatch: { season } } }
        ).lean();
        if (!users.length) return res.json({ league, season, managers: [] });

        const teams = await Team.find({}, { id: 1, school: 1, alternateNames: 1, seasons: 1 }).lean();
        const teamsById = {};
        teams.forEach(t => { teamsById[String(t.id)] = t; });

        const games = await Game.find({ season, seasonType: 'regular' },
            { id: 1, season: 1, seasonType: 1, week: 1, neutralSite: 1, conferenceGame: 1, notes: 1,
              completed: 1, homeId: 1, homeTeam: 1, homeConference: 1, homePoints: 1,
              awayId: 1, awayTeam: 1, awayConference: 1, awayPoints: 1 }).lean();
        const gamesByTeam = {};
        games.forEach(g => {
            const h = String(g.homeId), a = String(g.awayId);
            if (teamsById[h]) (gamesByTeam[h] = gamesByTeam[h] || []).push(g);
            if (teamsById[a]) (gamesByTeam[a] = gamesByTeam[a] || []).push(g);
        });

        const cfgDoc = await ScoringConfig.findOne({ league }).lean();
        const cfg = resolveConfig(league, overridesFromDoc(cfgDoc));
        const rankings = buildRankingProxy(season, teamsById, await projectionPoll(season));
        const poolCtx = buildPoolContext(teamsById, season);
        const managers = buildProjections(users, teamsById, gamesByTeam, cfg, rankings, poolCtx, season);
        // Forward-looking only: if the regular season has no games left (season
        // complete / not yet scheduled), the "projection" would just be actuals
        // plus a stray postseason term — hide it. Client renders nothing.
        if (!managers.length || !managers.some(m => m.remainingCount > 0)) {
            return res.json({ league, season, managers: [] });
        }

        const odds = simulateTitleOdds(managers, 5000);
        const ranked = managers.slice().sort((a, b) => b.projectedFinal - a.projectedFinal);
        const payload = ranked.map((m, i) => ({
            userId: m.userId, name: m.name, franchise: m.franchise,
            avatarUrl: m.avatarUrl, initials: m.initials, color: m.color,
            banked: m.banked, projectedFinal: m.projectedFinal,
            titleOdds: Math.round(odds[m.userId] * 1000) / 10,   // percent, 0.1 precision
            projectedRank: i + 1
        }));

        res.json({ league, season, managers: payload });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Per-manager Weekly Recap: one "here's your week" card per played week for a
// single manager — score, rank + movement, vs league average, MVP team, and a
// one-line narrative. Same math as League Highlights, scoped to one user, plus
// a layered upset narrative when a rostered team won as a betting underdog.
// Read-only. The compute lives in modules/weekly-recap.js so a future recap
// EMAIL can reuse it unchanged.
router.get('/recap/:league/:season/:userId', async (req, res) => {
    try {
        const league = req.params.league;
        const userId = req.params.userId;

        // `latest` (used by the weekly popup) resolves to the ACTIVE season only
        // (process.env.YEAR) — never a fallback to the most recent scored season,
        // which used to surface last year's finish during the new preseason.
        //
        // Whether that season has anything to recap is buildWeeklyRecaps' call: it
        // only counts weeks the league has actually played, so the preseason
        // returns an empty list and the popup stays silent until week one is in the
        // books. Checking "the active season has a weeklyScore entry" here instead
        // fired too early — the nightly job seeds a zero-point entry for every
        // manager as soon as a week's games exist.
        let season = req.params.season;
        if (season === 'latest') season = String(process.env.YEAR);
        const seasonNum = Number(season);

        // Whole league for the target season (need nested teams + weeklyScore
        // for rank/average, so no projection).
        const users = await User.find({ league: league, 'seasons.season': season });
        const user = users.find(u => String(u._id) === String(userId));
        if (!user) return res.json({ league, season: seasonNum, userId, recaps: [] });

        // Upset index: drafted teams' completed regular-season games + spreads,
        // so a rostered underdog win can flavor that week's narrative.
        const draftedIds = new Set();
        users.forEach(u => {
            const s = (u.seasons || []).find(x => String(x.season) === String(season));
            ((s && s.teams) || []).forEach(t => draftedIds.add(Number(t.id)));
        });
        const idList = [...draftedIds];
        let upsetByGameId = {};
        let weatherByGameId = {};
        let completeWeeks = null;
        if (idList.length) {
            const allGames = await Game.find(
                { season: seasonNum, $or: [{ homeId: { $in: idList } }, { awayId: { $in: idList } }] },
                { id: 1, week: 1, seasonType: 1, startDate: 1, homeTeam: 1, awayTeam: 1, homePoints: 1, awayPoints: 1, completed: 1, homeId: 1, awayId: 1, weather: 1, _id: 0 }
            );
            const games = allGames.filter(g => g.completed && g.seasonType === 'regular');

            // A week is "complete" for recap purposes once every drafted-team
            // game in that week has kicked off — i.e. the current time is past
            // the last game's start. This keeps the popup from firing mid-week
            // when early games (Thursday/Friday) finish before the Saturday
            // slate even starts.
            const now = new Date();
            const weekLastStart = {};
            allGames.forEach(g => {
                const ew = (g.seasonType === 'postseason' || g.week > 16) ? 17 : g.week;
                const sd = g.startDate ? new Date(g.startDate) : null;
                if (sd && (!weekLastStart[ew] || sd > weekLastStart[ew])) weekLastStart[ew] = sd;
            });
            completeWeeks = new Set();
            for (const w in weekLastStart) {
                if (now >= weekLastStart[w]) completeWeeks.add(Number(w));
            }
            const betting = await Betting.find({ season: seasonNum, seasonType: 'regular' }, { id: 1, lines: 1, _id: 0 });
            const spreadByGameId = {};
            betting.forEach(b => {
                const lines = b.lines || [];
                const line = lines.find(l => l.provider === 'DraftKings') || lines[0];
                if (line && typeof line.spread === 'number') spreadByGameId[b.id] = line.spread;
            });

            // AP Top 25 by week, so the upset narrative can name the beaten
            // team's rank ("upset of #3 Georgia"). Each Ranking doc is one week.
            const rankByWeek = {};
            const rankings = await Ranking.find({ season: seasonNum, seasonType: 'regular' }, { week: 1, polls: 1, _id: 0 });
            rankings.forEach(rk => {
                const ap = (rk.polls || []).find(p => p.poll === 'AP Top 25');
                if (!ap) return;
                const byTeam = (rankByWeek[rk.week] = rankByWeek[rk.week] || {});
                (ap.ranks || []).forEach(r => { if (r.school != null && r.rank != null) byTeam[r.school] = r.rank; });
            });

            upsetByGameId = indexUpsets(games, spreadByGameId, rankByWeek);

            allGames.forEach(g => {
                if (g.weather && g.weather.emoji) weatherByGameId[g.id] = g.weather;
            });
        }

        const recap = buildWeeklyRecaps({ user, leagueUsers: users, season, upsetByGameId, completeWeeks, weatherByGameId });
        const name = `${user.firstName || ''} ${user.lastName ? user.lastName[0] + '.' : ''}`.trim();
        res.json({ league, ...recap, name });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Head-to-head weekly win-bonus view (GitHub #230), per-league opt-in. A
// round-robin schedule pairs managers each regular week; the higher weekly
// total wins a flat bonus that folds into the season total. Read-only and
// computed from the stored weeklyScore, so it works on historical seasons too
// (for proposing the format to a league). `enabled` reflects the league config;
// the data is returned regardless so it can be previewed before turning on.
router.get('/h2h/:league/:season', async (req, res) => {
    try {
        const league = req.params.league;
        const season = req.params.season;
        const seasonNum = Number(season);

        // Standings-only mode returns just the ranked managers, skipping the
        // matchup win-prob work (all-teams + all-games loads + projections +
        // schedule build). The client fetches the full payload separately for
        // the matchup cards, so the standings table paints without waiting on it.
        // The default (no param) response is unchanged — My Team also consumes it.
        const standingsOnly = req.query.standingsOnly === '1' || req.query.standingsOnly === 'true';

        const cfgDoc = await ScoringConfig.findOne({ league }).lean();
        // Engagement is per-season: resolve H2H on/off + win bonus for THIS season
        // (a season with no entry is off), so one season's setting never leaks.
        const eng = engagementForSeason(cfgDoc && cfgDoc.engagementBySeason, season);
        const winBonus = eng.h2hWinBonus;
        const tieBonus = eng.h2hTieBonus;

        // .lean(): the handler only reads plain fields (no doc methods/virtuals),
        // so skip Mongoose hydration of these heavy weeklyScore docs.
        const users = await User.find({ league, 'seasons.season': season }).lean();
        const isRegular = w => w.season !== 'postseason' && w.week <= 16;
        const round = v => Math.round(v * 10) / 10;
        // Deterministic manager ordering — the pairing schedule is positional, so
        // this must match what the scoring-time pass used (modules/h2h.js). Once
        // a week has settled that pass PINS the list, and reading the same pin
        // here is what keeps the rendered matchups identical to the banked ones
        // after any membership change.
        const pinnedIds = pinnedH2HIds(cfgDoc, season);
        const ids = h2hRoster(users, season, pinnedIds);
        const idSet = new Set(ids);
        const meta = {}, totals = {}, teamDetail = {}, caps = {}, banked = {}, seasonById = {};
        // teamDetail is keyed per (team, game) so a doubleheader keeps both
        // results apart. scoreByTeam only started carrying gameId in 2024, so
        // older entries key on the team alone — one row per team, as before.
        const detailKey = (teamId, gameId) => gameId == null ? String(teamId) : teamId + ':' + gameId;
        const draftedSet = new Set();
        users.forEach(u => {
            const s = (u.seasons || []).find(x => String(x.season) === String(season));
            if (!s || !(s.weeklyScore || []).length) return;
            const id = String(u._id);
            if (!idSet.has(id)) return;
            // How much H2H bonus is ALREADY folded into cumulativeScore. Subtracted
            // from the bonus computed below so the total reads the same whether or
            // not the scoring job has persisted the current values yet — which also
            // keeps this route honest when previewing H2H on a historical season
            // that was never scored with it.
            banked[id] = persistedBonus(s);
            const logoBy = {}, abbrBy = {};
            const roster = (s.teams || []).map(t => { const logo = pickLogo(t.logos) || null; logoBy[t.id] = logo; abbrBy[t.id] = t.abbreviation || null; draftedSet.add(t.id); return { id: t.id, school: t.school, abbr: t.abbreviation || null, logo }; });
            meta[id] = {
                userId: id,
                name: `${u.firstName || ''} ${u.lastName ? u.lastName[0] + '.' : ''}`.trim(),
                franchise: s.franchiseName || null,
                avatarUrl: u.avatarUrl || null, color: u.color || null,
                initials: (((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '')).toUpperCase(),
                cumulative: s.cumulativeScore || 0,
                teams: roster
            };
            const tw = {}, twTeams = {};
            (s.weeklyScore || []).forEach(e => {
                if (!isRegular(e) || e.week > H2H_MAX_WEEK) return;
                const w = e.week;
                // BASE total (score minus any bonus already banked into it), so a
                // week's own bonus never feeds back into deciding that week.
                tw[w] = (tw[w] || 0) + baseWeekScore(e);
                // Keyed per GAME, because a team can play twice in one API
                // week — CFBD has no week 0, it folds the opening weekend into
                // week 1 (12 draftable teams in 2026, 8 in 2025). Summing those
                // into one row produced a two-game total labelled with one
                // game's opponent. Entries from before scoreByTeam carried a
                // gameId still aggregate per team, the way they always have.
                const byGame = twTeams[w] || (twTeams[w] = {});
                (e.scoreByTeam || []).forEach(st => {
                    const k = detailKey(st.teamId, st.gameId);
                    if (!byGame[k]) byGame[k] = { teamId: st.teamId, gameId: st.gameId == null ? null : st.gameId, school: st.team, abbr: abbrBy[st.teamId] || null, logo: logoBy[st.teamId] || null, score: 0 };
                    byGame[k].score += (st.score || 0);
                });
            });
            totals[id] = tw;
            teamDetail[id] = twTeams;
            caps[id] = {};
            (s.captains || []).forEach(c => { if (c && c.week != null) caps[id][c.week] = c.teamId; });
            seasonById[id] = s;
        });
        if (!ids.length) return res.json({ league, season: seasonNum, enabled: eng.h2hEnabled, winBonus, tieBonus, weeks: [], managers: [], schedule: [] });

        // Game status for in-progress weeks: whether each rostered team's game is
        // final / live / upcoming, and which weeks are fully complete. Pairings
        // are computed over the FIXED regular-season range so a week's matchup is
        // stable whether or not it's been scored yet.
        const draftedIds = [...draftedSet];
        const games = draftedIds.length ? await Game.find(
            { season: seasonNum, seasonType: 'regular', week: { $lte: H2H_MAX_WEEK }, $or: [{ homeId: { $in: draftedIds } }, { awayId: { $in: draftedIds } }] },
            { id: 1, week: 1, startDate: 1, startTimeTbd: 1, completed: 1, homeId: 1, homeTeam: 1, homePoints: 1, awayId: 1, awayTeam: 1, awayPoints: 1, liveHomeWinProb: 1, weather: 1, _id: 0 }
        ).lean() : [];
        // Opponent rankings, read from the SAME poll the scorer reads (the
        // Playoff Committee's, else AP — see scoring-detectors findPoll). So a
        // rank on a card means that win pays the ranked bonus, and a week with
        // only a Coaches Poll stored shows no ranks at all rather than numbers
        // that won't match what the week actually scores. Keyed by team NAME,
        // the same join rankValue makes.
        const pollDoc = standingsOnly ? null : await projectionPoll(seasonNum);
        const rankByName = {};
        ((pollDoc && pollDoc.ranks) || []).forEach(r => { if (r && r.school) rankByName[r.school] = r.rank; });
        // Opponent abbreviations (opponents aren't always rostered, so look them
        // up from the Team collection).
        const oppAbbrById = {};
        const gameTeamIds = [...new Set(games.flatMap(g => [g.homeId, g.awayId]).filter(x => x != null))];
        if (!standingsOnly && gameTeamIds.length) {
            const tdocs = await Team.find({ id: { $in: gameTeamIds } }, { id: 1, abbreviation: 1, _id: 0 }).lean();
            tdocs.forEach(td => { oppAbbrById[td.id] = td.abbreviation || null; });
        }
        // Projected pre-game win probability per matchup, from the same SP+ model
        // the draft-grade / standings projections use. For finished weeks it's a
        // retrospective "what were the odds"; for the in-progress week it drives
        // the live win-probability bar. Only drafted teams are projected, but all
        // teams load so opponents' SP+ is available for the pool context.
        const projByWeek = {};
        if (!standingsOnly && draftedIds.length) {
            const allTeams = await Team.find({}, { id: 1, school: 1, alternateNames: 1, seasons: 1 }).lean();
            const teamsById = {};
            allTeams.forEach(t => { teamsById[String(t.id)] = t; });
            // Only drafted teams' games feed the projections (gamesByTeam below
            // keeps just those), so filter in the query instead of loading the
            // whole season and discarding most of it — same resulting set.
            const regGames = await Game.find(
                { season: seasonNum, seasonType: 'regular', $or: [{ homeId: { $in: draftedIds } }, { awayId: { $in: draftedIds } }] },
                { id: 1, season: 1, seasonType: 1, week: 1, neutralSite: 1, conferenceGame: 1, notes: 1,
                  completed: 1, homeId: 1, homeTeam: 1, homeConference: 1, homePoints: 1,
                  awayId: 1, awayTeam: 1, awayConference: 1, awayPoints: 1,
                  pregameWinProb: 1 }).lean();
            const gamesByTeam = {};
            regGames.forEach(g => {
                [g.homeId, g.awayId].forEach(tid => {
                    if (draftedSet.has(tid)) (gamesByTeam[tid] = gamesByTeam[tid] || []).push(g);
                });
            });
            const cfg = resolveConfig(league, overridesFromDoc(cfgDoc));
            // Latest poll, same as the standings projection. The H2H win probs
            // for ALREADY-PLAYED weeks are retrospective, so strictly they'd want
            // that week's own poll — but they're a "what were the odds" garnish,
            // and the live bar on the in-progress week is what this actually
            // drives. One poll read beats one per week.
            const rankings = buildRankingProxy(seasonNum, teamsById, pollDoc);
            const poolCtx = buildPoolContext(teamsById, seasonNum);
            draftedIds.forEach(tid => {
                const team = teamsById[String(tid)];
                if (!team) return;
                const proj = projectTeamPoints(team, gamesByTeam[tid] || [], poolCtx, rankings, cfg, seasonNum, { perGame: true });
                // { [week]: { [teamId]: { [gameId]: proj } } } — nested by game
                // rather than flat by team. Keying by team alone meant a team's
                // second game in an API week silently overwrote its first, so
                // half of that team's week never reached the odds.
                (proj.perGame || []).forEach(pg => {
                    if (pg.week == null || pg.gameId == null) return;
                    const byTeam = projByWeek[pg.week] = projByWeek[pg.week] || {};
                    (byTeam[tid] = byTeam[tid] || {})[pg.gameId] = { winProb: pg.winProb, pointsIfWin: pg.pointsIfWin };
                });
            });
        }

        // EVERY game a rostered team plays that week, in kickoff order. This
        // used to keep one game per team per week, which silently dropped the
        // other half of a doubleheader — and picked the survivor by document
        // order, so which game showed was effectively arbitrary.
        const gameTW = {};
        games.forEach(g => {
            [g.homeId, g.awayId].forEach(tid => {
                if (!draftedSet.has(tid)) return;
                const m = gameTW[tid] || (gameTW[tid] = {});
                (m[g.week] = m[g.week] || []).push(g);
            });
        });
        Object.values(gameTW).forEach(byWeek => Object.values(byWeek).forEach(list =>
            list.sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))));
        const gamesOf = (teamId, w) => (gameTW[teamId] && gameTW[teamId][w]) || [];
        const gameById = {};
        games.forEach(g => { gameById[g.id] = g; });

        // The captain doubles a team for the week, and that doubling is already
        // folded into the weekly total the card shows — so the win bar has to
        // count it too, or the number and the bar tell different stories.
        //
        // Resolved with resolveCaptain, NOT the raw `captains` array: a manager
        // who never picks still gets an auto-captain at scoring time (their best
        // team, or the first rostered one in week 1). Reading only explicit picks
        // would leave the bar disagreeing with the score for everyone who didn't
        // set one.
        const capEnabled = !!eng.captainEnabled;
        const capMult = eng.captainMultiplier || 2;
        const capCache = {};
        const captainOf = (id, w) => {
            if (!capEnabled) return null;
            const key = id + ':' + w;
            if (key in capCache) return capCache[key];
            const s = seasonById[id];
            if (!s) return (capCache[key] = null);
            const prior = (s.weeklyScore || []).filter(e => e.season !== 'postseason' && Number(e.week) < Number(w));
            return (capCache[key] = resolveCaptain(s.captains, w, s.teams, prior));
        };
        const isCaptain = (id, w, teamId) => {
            const c = captainOf(id, w);
            return c != null && Number(c) === Number(teamId);
        };
        // A projection entry with the captain's multiplier applied to its points.
        const capped = (id, w, teamId, e) => (e && isCaptain(id, w, teamId))
            ? { winProb: e.winProb, pointsIfWin: e.pointsIfWin * capMult } : e;
        // A team's scored points for ONE game. The legacy per-team fallback is
        // only safe when that team played once that week — otherwise it would
        // report the same two-game total against each of the two rows.
        const scoredFor = (id, w, teamId, gameId) => {
            const detail = (teamDetail[id] && teamDetail[id][w]) || {};
            return detail[detailKey(teamId, gameId)]
                || (gamesOf(teamId, w).length === 1 ? detail[String(teamId)] : null)
                || null;
        };
        const now = Date.now();

        // Which weeks have settled, the pairings, and each manager's result —
        // from the SAME function the scoring job uses to bank the bonus, so the
        // table and cumulativeScore can never tell different stories.
        const { awards, weeks: h2hWeeks, weekFinal, finalWeeks, currentWeek, schedule: scheduleAll } = computeH2HAwards({
            users, games, season, winBonus, tieBonus, maxWeek: H2H_MAX_WEEK, pinnedIds
        });

        // Records + win bonus count FINAL weeks only (an in-progress week has no
        // decided winner yet).
        const rec = {};
        ids.forEach(id => {
            const a = { wins: 0, losses: 0, ties: 0, bonus: 0, pointsFor: 0, pointsAgainst: 0 };
            Object.values(awards[id] || {}).forEach(x => {
                if (x.result === 'W') a.wins++; else if (x.result === 'L') a.losses++; else a.ties++;
                a.bonus += x.bonus; a.pointsFor += x.for; a.pointsAgainst += x.against;
            });
            rec[id] = a;
        });
        const managers = ids.filter(id => meta[id]).map(id => ({
            ...meta[id],
            wins: rec[id].wins, losses: rec[id].losses, ties: rec[id].ties,
            record: `${rec[id].wins}-${rec[id].losses}-${rec[id].ties}`,
            h2hBonus: rec[id].bonus,
            pointsFor: round(rec[id].pointsFor), pointsAgainst: round(rec[id].pointsAgainst),
            // cumulative already includes weeks 15+/postseason AND whatever bonus
            // the scoring job has banked so far; add only the not-yet-banked part.
            adjustedTotal: round(meta[id].cumulative + rec[id].bonus - (banked[id] || 0))
        })).sort((a, b) => b.adjustedTotal - a.adjustedTotal);
        // Competition ranking, so managers level on points share a placement (and
        // the client can render "T-2") instead of being split by array position —
        // which before kickoff, with everyone on 0, is just the DB's document
        // order. The sort above still sets display order.
        competitionRanks(managers, m => m.adjustedTotal)
            .forEach((r, i) => Object.assign(managers[i], { rank: r.rank, tie: r.tie }));

        // Standings-only: the ranked table is ready; return before the matchup
        // win-prob build (which needs the projections skipped above).
        if (standingsOnly) return res.json({ league, season: seasonNum, enabled: eng.h2hEnabled, winBonus, tieBonus, managers });

        // Schedule payload: final weeks + the current in-progress week. Final
        // weeks show scored contributing teams; the current week shows each
        // rostered team's live game status (final / live / kickoff time).
        const teamsFinal = (id, w) => Object.values((teamDetail[id] && teamDetail[id][w]) || {})
            .map(t => {
                // Opponent + final CFB score for the retrospective sub-line (same
                // source the live week uses), so past matchup rows aren't bare.
                // The row knows its own game; only legacy rows (no gameId) fall
                // back to the team's single game that week.
                const g = t.gameId != null ? gameById[t.gameId] : gamesOf(t.teamId, w)[0];
                let opp = '', ha = 'vs', gameScore = null, oppRank = null;
                if (g) {
                    const isHome = g.homeId === t.teamId;
                    const oppName = isHome ? g.awayTeam : g.homeTeam;
                    opp = oppAbbrById[isHome ? g.awayId : g.homeId] || oppName || '';
                    oppRank = rankByName[oppName] || null;
                    ha = isHome ? 'vs' : '@';
                    if (g.completed && g.homePoints != null && g.awayPoints != null) {
                        gameScore = `${isHome ? g.homePoints : g.awayPoints}–${isHome ? g.awayPoints : g.homePoints}`;
                    }
                }
                return { teamId: t.teamId, school: t.school, abbr: t.abbr, logo: t.logo, score: round(t.score), status: 'final', captain: isCaptain(id, w, t.teamId), opp, ha, oppRank, gameScore, gameId: g ? g.id : null };
            })
            .sort((a, b) => b.score - a.score);
        // The kickoff INSTANT, not a rendered string. This used to format here
        // with no timeZone, so it came out in the dyno's zone (UTC) — every
        // kickoff five hours late, and night games landing on the wrong weekday
        // entirely. Every other date in the app renders in Central; the client
        // now does that for these too, off the ISO. null = time not yet firm.
        const kickAt = (g) => (!g || !g.startDate || g.startTimeTbd) ? null : g.startDate;
        const statusOrder = { final: 0, live: 1, scheduled: 2 };
        // flatMap, not map: a team with two games that week gets a row for each,
        // so neither is hidden and the footer's game count is honest. A team with
        // no game contributes nothing (a bye).
        const teamsLive = (id, w) => (meta[id].teams || []).flatMap(t => gamesOf(t.id, w).map(g => {
            const st = gameStatus(g, now);
            const scored = scoredFor(id, w, t.id, g.id);
            const isHome = g.homeId === t.id;
            const oppId = isHome ? g.awayId : g.homeId;
            const oppName = isHome ? g.awayTeam : g.homeTeam;
            const opp = oppAbbrById[oppId] || oppName || '';
            let gameScore = null;
            if (g.homePoints != null && g.awayPoints != null) {
                gameScore = `${isHome ? g.homePoints : g.awayPoints}–${isHome ? g.awayPoints : g.homePoints}`;
            }
            return { teamId: t.id, school: t.school, abbr: t.abbr, logo: t.logo, score: scored ? round(scored.score) : null, status: st, kickoff: st === 'scheduled' ? kickAt(g) : null, opp, ha: isHome ? 'vs' : '@', oppRank: rankByName[oppName] || null, gameScore, gameId: g.id, captain: isCaptain(id, w, t.id) };
        })).sort((a, b) => (statusOrder[a.status] - statusOrder[b.status]) || ((b.score || 0) - (a.score || 0)));

        // Projected pre-game odds for a matchup: each manager's teams that play
        // that week, run through the win-probability model. Integer percents that
        // sum to 100 (or null when neither side has a projectable game).
        const entriesFor = (id, w) => (meta[id].teams || [])
            .flatMap(t => Object.values((projByWeek[w] && projByWeek[w][t.id]) || {}).map(e => capped(id, w, t.id, e)));
        // Live odds recompute as the week plays out: a team whose game is already
        // FINAL contributes its actual scored points as a certainty; a LIVE game
        // with in-progress scores uses the current fantasy points (from the
        // scoreboard poller) as near-certainty; teams still to play keep their
        // projected win-prob × points-if-win. The bar shifts as games unfold.
        const liveEntriesFor = (id, w) => (meta[id].teams || []).flatMap(t => gamesOf(t.id, w).map(g => {
            const st = gameStatus(g, now);
            if (st === 'final') {
                const s = scoredFor(id, w, t.id, g.id);
                return capped(id, w, t.id, { winProb: 1, pointsIfWin: s ? s.score : 0 });
            }
            if (st === 'live') {
                if (g.liveHomeWinProb != null) {
                    const isHome = g.homeId === t.id;
                    const wp = isHome ? g.liveHomeWinProb : 1 - g.liveHomeWinProb;
                    const p = projByWeek[w] && projByWeek[w][t.id] && projByWeek[w][t.id][g.id];
                    const ptsIfWin = p ? p.pointsIfWin : 0;
                    return capped(id, w, t.id, { winProb: Math.max(0.001, Math.min(0.999, wp)), pointsIfWin: ptsIfWin });
                }
                const s = scoredFor(id, w, t.id, g.id);
                if (s && s.score != null) {
                    return capped(id, w, t.id, { winProb: 0.95, pointsIfWin: s.score });
                }
            }
            const p = projByWeek[w] && projByWeek[w][t.id] && projByWeek[w][t.id][g.id];
            return p ? capped(id, w, t.id, { winProb: p.winProb, pointsIfWin: p.pointsIfWin }) : null;
        })).filter(Boolean);
        const oddsFrom = (ea, eb) => {
            const r = matchupWinProb(ea, eb);
            if (!r) return null;
            const pa = Math.round(r.a * 100);
            return { a: pa, b: 100 - pa };
        };
        const oddsFor = (a, b, w) => oddsFrom(entriesFor(a, w), entriesFor(b, w));
        const liveOddsFor = (a, b, w) => oddsFrom(liveEntriesFor(a, w), liveEntriesFor(b, w));
        // `unplayed` covers both the in-progress week and the weeks still to
        // come: neither has a decided winner, and both want the per-team view
        // that shows kickoff times rather than the scored-teams-only one.
        const gameFor = (a, b, w, unplayed, upcoming) => {
            const sa = round((totals[a] || {})[w] || 0), sb = round((totals[b] || {})[w] || 0);
            return {
                aId: a, aScore: sa, aTeams: unplayed ? teamsLive(a, w) : teamsFinal(a, w),
                bId: b, bScore: sb, bTeams: unplayed ? teamsLive(b, w) : teamsFinal(b, w),
                winner: unplayed ? null : (sa > sb ? 'a' : (sb > sa ? 'b' : 'tie')),
                winP: unplayed ? liveOddsFor(a, b, w) : oddsFor(a, b, w),
                final: !unplayed,
                upcoming: !!upcoming
            };
        };
        // EVERY derived H2H week, not just the played ones. The pairings are
        // deterministic (positional round-robin over the pinned roster), so a
        // week that hasn't happened yet is fully knowable: opponent, kickoff
        // times, and pre-game odds. Emitting only final-plus-current is what
        // left My Team's "Full schedule" drawer empty in week 1 — there was
        // nothing to list once the featured week was pulled out — and limited
        // the Standings week picker to weeks already behind you.
        const schedWeeks = h2hWeeks.slice().sort((a, b) => a - b);
        // Has a ball actually been kicked off in this week yet? `currentWeek` only
        // means "the first week that hasn't settled", which is true of week 1 all
        // preseason — so on its own it marked every matchup LIVE with an "In
        // progress · N games to play" footer weeks before anyone played. The
        // per-game status was always right (rows showed kickoff times, not LIVE);
        // it was the week-level flag that never asked.
        //
        // A TBD kickoff reads as 'scheduled' and so can never start a week by
        // itself, which is correct — nobody knows when it begins.
        const startedByWeek = {};
        games.forEach(g => {
            if (g.week == null) return;
            if (gameStatus(g, now) !== 'scheduled') startedByWeek[g.week] = true;
        });
        const schedule = schedWeeks.map(w => {
            const live = (w === currentWeek) && !weekFinal[w] && !!startedByWeek[w];
            const upcoming = !weekFinal[w] && !live;
            return { week: w, final: !!weekFinal[w], upcoming, games: (scheduleAll[w] || []).filter(([a, b]) => meta[a] && meta[b]).map(([a, b]) => gameFor(a, b, w, live || upcoming, upcoming)) };
        });
        let featuredWeek = currentWeek || (finalWeeks.length ? finalWeeks[finalWeeks.length - 1] : (schedWeeks[schedWeeks.length - 1] || null));
        let currentWeekOut = currentWeek;

        // Dev-only preview of the in-progress states (non-production). Doctors the
        // latest week so the pre-kickoff and mixed live views can be seen on a
        // finished season: ?h2hSim=pregame (nothing started) | mixed (some final,
        // some live, some upcoming).
        if (req.query.h2hSim && process.env.NODE_ENV !== 'production' && schedule.length) {
            const mode = String(req.query.h2hSim);
            const w = schedule.find(x => x.week === featuredWeek) || schedule[schedule.length - 1];
            w.final = false;
            const doctor = (arr) => (arr || []).map((t, j) => {
                const status = mode === 'pregame' ? 'scheduled' : (j === 0 ? 'final' : (j === 1 ? 'live' : 'scheduled'));
                return { teamId: t.teamId, school: t.school, abbr: t.abbr, logo: t.logo, status, score: status === 'final' ? t.score : null, kickoff: status === 'scheduled' ? new Date(Date.now() + 864e5).toISOString() : null, opp: j % 2 ? 'UGA' : 'ARK', ha: j % 2 ? '@' : 'vs', gameScore: status === 'final' ? '31–20' : null, captain: j === 0 };
            });
            // Live odds from the doctored slate: final games lock their actual
            // points, everything else is a neutral coin-flip projection — so the
            // bar reflects the same live computation the real current week uses.
            const liveEnt = (teams) => (teams || []).map(t => t.status === 'final'
                ? { winProb: 1, pointsIfWin: t.score || 0 }
                : { winProb: 0.5, pointsIfWin: 18 });
            w.games.forEach(g => {
                g.final = false; g.winner = null;
                g.aTeams = doctor(g.aTeams); g.bTeams = doctor(g.bTeams);
                const sum = (teams) => round(teams.filter(t => t.status === 'final').reduce((s, t) => s + (t.score || 0), 0));
                g.aScore = sum(g.aTeams); g.bScore = sum(g.bTeams);
                g.winP = mode === 'pregame' ? g.winP : oddsFrom(liveEnt(g.aTeams), liveEnt(g.bTeams));
            });
            featuredWeek = w.week; currentWeekOut = w.week;
        }

        // No H2H week is left to play. The client uses this to bring the lower
        // Rivalry Games section back for the postseason — it stays hidden while
        // matchups are live so the two senses of "head to head" never share the
        // page. Derived AFTER the sim block, so ?h2hSim (which fakes a live
        // week) still reads as mid-season.
        const scheduleComplete = !!(schedWeeks.length && !currentWeekOut);

        res.json({ league, season: seasonNum, enabled: eng.h2hEnabled, winBonus, tieBonus, weeks: schedWeeks, featuredWeek, currentWeek: currentWeekOut, scheduleComplete, managers, schedule });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
