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
const { resolveConfig, engagementForSeason } = require('../modules/scoring-defaults');
const { buildRankingProxy, buildPoolContext, projectTeamPoints } = require('../modules/draft-projection');
const { buildProjections, simulateTitleOdds } = require('../modules/standings-projection');
const { buildAdvancedHighlights } = require('../modules/standings-highlights');
const { buildWeeklyRecaps, indexUpsets } = require('../modules/weekly-recap');
const { gameStatus, matchupWinProb, H2H_MAX_WEEK, baseWeekScore, persistedBonus,
        h2hManagerIds, computeH2HAwards } = require('../modules/h2h');
const { pickLogo } = require('../public/logo.js');

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
        const cfg = resolveConfig(league, cfgDoc ? {
            model: cfgDoc.model, values: cfgDoc.values, combineMode: cfgDoc.combineMode, disabled: cfgDoc.disabled, enabled: cfgDoc.enabled
        } : null);
        const apDoc = await Ranking.findOne({ season, seasonType: 'regular' }).sort({ week: 1 }).lean();
        const apPoll = apDoc && Array.isArray(apDoc.polls) ? apDoc.polls.find(p => p.poll === 'AP Top 25') : null;

        const rankings = buildRankingProxy(season, teamsById, apPoll);
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
        if (idList.length) {
            const games = await Game.find(
                { season: seasonNum, seasonType: 'regular', completed: true, $or: [{ homeId: { $in: idList } }, { awayId: { $in: idList } }] },
                { id: 1, week: 1, homeTeam: 1, awayTeam: 1, homePoints: 1, awayPoints: 1, completed: 1, _id: 0 }
            );
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
        }

        const recap = buildWeeklyRecaps({ user, leagueUsers: users, season, upsetByGameId });
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
        // this must match what the scoring-time pass used (modules/h2h.js).
        const ids = h2hManagerIds(users, season);
        const idSet = new Set(ids);
        const meta = {}, totals = {}, teamDetail = {}, caps = {}, banked = {};
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
                const byTeam = twTeams[w] || (twTeams[w] = {});
                (e.scoreByTeam || []).forEach(st => {
                    const k = st.teamId;
                    if (!byTeam[k]) byTeam[k] = { teamId: st.teamId, school: st.team, abbr: abbrBy[st.teamId] || null, logo: logoBy[st.teamId] || null, score: 0 };
                    byTeam[k].score += (st.score || 0);
                });
            });
            totals[id] = tw;
            teamDetail[id] = twTeams;
            caps[id] = {};
            (s.captains || []).forEach(c => { if (c && c.week != null) caps[id][c.week] = c.teamId; });
        });
        if (!ids.length) return res.json({ league, season: seasonNum, enabled: eng.h2hEnabled, winBonus, tieBonus, weeks: [], managers: [], schedule: [] });

        // Game status for in-progress weeks: whether each rostered team's game is
        // final / live / upcoming, and which weeks are fully complete. Pairings
        // are computed over the FIXED regular-season range so a week's matchup is
        // stable whether or not it's been scored yet.
        const draftedIds = [...draftedSet];
        const games = draftedIds.length ? await Game.find(
            { season: seasonNum, seasonType: 'regular', week: { $lte: H2H_MAX_WEEK }, $or: [{ homeId: { $in: draftedIds } }, { awayId: { $in: draftedIds } }] },
            { id: 1, week: 1, startDate: 1, startTimeTbd: 1, completed: 1, homeId: 1, homeTeam: 1, homePoints: 1, awayId: 1, awayTeam: 1, awayPoints: 1, _id: 0 }
        ).lean() : [];
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
                  awayId: 1, awayTeam: 1, awayConference: 1, awayPoints: 1 }).lean();
            const gamesByTeam = {};
            regGames.forEach(g => {
                [g.homeId, g.awayId].forEach(tid => {
                    if (draftedSet.has(tid)) (gamesByTeam[tid] = gamesByTeam[tid] || []).push(g);
                });
            });
            const cfg = resolveConfig(league, cfgDoc ? {
                model: cfgDoc.model, values: cfgDoc.values, combineMode: cfgDoc.combineMode, disabled: cfgDoc.disabled
            } : null);
            const apDoc = await Ranking.findOne({ season: seasonNum, seasonType: 'regular' }).sort({ week: 1 }).lean();
            const apPoll = apDoc && Array.isArray(apDoc.polls) ? apDoc.polls.find(p => p.poll === 'AP Top 25') : null;
            const rankings = buildRankingProxy(seasonNum, teamsById, apPoll);
            const poolCtx = buildPoolContext(teamsById, seasonNum);
            draftedIds.forEach(tid => {
                const team = teamsById[String(tid)];
                if (!team) return;
                const proj = projectTeamPoints(team, gamesByTeam[tid] || [], poolCtx, rankings, cfg, seasonNum, { perGame: true });
                (proj.perGame || []).forEach(pg => {
                    if (pg.week == null) return;
                    (projByWeek[pg.week] = projByWeek[pg.week] || {})[tid] = { winProb: pg.winProb, pointsIfWin: pg.pointsIfWin };
                });
            });
        }

        const gameTW = {};
        games.forEach(g => {
            [g.homeId, g.awayId].forEach(tid => {
                if (!draftedSet.has(tid)) return;
                const m = gameTW[tid] || (gameTW[tid] = {});
                if (!m[g.week] || (m[g.week].completed && !g.completed)) m[g.week] = g;   // prefer the unfinished game
            });
        });
        const now = Date.now();

        // Which weeks have settled, the pairings, and each manager's result —
        // from the SAME function the scoring job uses to bank the bonus, so the
        // table and cumulativeScore can never tell different stories.
        const { awards, weekFinal, finalWeeks, currentWeek, schedule: scheduleAll } = computeH2HAwards({
            users, games, season, winBonus, tieBonus, maxWeek: H2H_MAX_WEEK
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
        const managers = ids.map(id => ({
            ...meta[id],
            wins: rec[id].wins, losses: rec[id].losses, ties: rec[id].ties,
            record: `${rec[id].wins}-${rec[id].losses}-${rec[id].ties}`,
            h2hBonus: rec[id].bonus,
            pointsFor: round(rec[id].pointsFor), pointsAgainst: round(rec[id].pointsAgainst),
            // cumulative already includes weeks 15+/postseason AND whatever bonus
            // the scoring job has banked so far; add only the not-yet-banked part.
            adjustedTotal: round(meta[id].cumulative + rec[id].bonus - (banked[id] || 0))
        })).sort((a, b) => b.adjustedTotal - a.adjustedTotal).map((m, i) => ({ rank: i + 1, ...m }));

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
                const g = gameTW[t.teamId] && gameTW[t.teamId][w];
                let opp = '', ha = 'vs', gameScore = null;
                if (g) {
                    const isHome = g.homeId === t.teamId;
                    opp = oppAbbrById[isHome ? g.awayId : g.homeId] || (isHome ? g.awayTeam : g.homeTeam) || '';
                    ha = isHome ? 'vs' : '@';
                    if (g.completed && g.homePoints != null && g.awayPoints != null) {
                        gameScore = `${isHome ? g.homePoints : g.awayPoints}–${isHome ? g.awayPoints : g.homePoints}`;
                    }
                }
                return { teamId: t.teamId, school: t.school, abbr: t.abbr, logo: t.logo, score: round(t.score), status: 'final', captain: !!(caps[id] && caps[id][w] === t.teamId), opp, ha, gameScore };
            })
            .sort((a, b) => b.score - a.score);
        const fmtKick = (g) => {
            if (!g || !g.startDate || g.startTimeTbd) return 'TBD';
            const d = new Date(g.startDate); if (isNaN(d.getTime())) return 'TBD';
            return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        };
        const statusOrder = { final: 0, live: 1, scheduled: 2 };
        const teamsLive = (id, w) => (meta[id].teams || []).map(t => {
            const g = gameTW[t.id] && gameTW[t.id][w];
            if (!g) return null;   // bye / no game this week
            const st = gameStatus(g, now);
            const scored = teamDetail[id] && teamDetail[id][w] && teamDetail[id][w][t.id];
            const isHome = g.homeId === t.id;
            const oppId = isHome ? g.awayId : g.homeId;
            const opp = oppAbbrById[oppId] || (isHome ? g.awayTeam : g.homeTeam) || '';
            let gameScore = null;
            if (g.completed && g.homePoints != null && g.awayPoints != null) {
                gameScore = `${isHome ? g.homePoints : g.awayPoints}–${isHome ? g.awayPoints : g.homePoints}`;
            }
            return { teamId: t.id, school: t.school, abbr: t.abbr, logo: t.logo, score: scored ? round(scored.score) : null, status: st, kickoff: st === 'scheduled' ? fmtKick(g) : null, opp, ha: isHome ? 'vs' : '@', gameScore, captain: !!(caps[id] && caps[id][w] === t.id) };
        }).filter(Boolean).sort((a, b) => (statusOrder[a.status] - statusOrder[b.status]) || ((b.score || 0) - (a.score || 0)));

        // Projected pre-game odds for a matchup: each manager's teams that play
        // that week, run through the win-probability model. Integer percents that
        // sum to 100 (or null when neither side has a projectable game).
        const entriesFor = (id, w) => (meta[id].teams || [])
            .map(t => projByWeek[w] && projByWeek[w][t.id])
            .filter(Boolean);
        // Live odds recompute as the week plays out: a team whose game is already
        // FINAL contributes its actual scored points as a certainty; teams still
        // to play (live/upcoming) keep their projected win-prob × points-if-win.
        // So the bar shifts toward whoever's banked results are stronger, and by
        // the time every game is final it reads as the settled 100/0.
        const liveEntriesFor = (id, w) => (meta[id].teams || []).map(t => {
            const g = gameTW[t.id] && gameTW[t.id][w];
            if (!g) return null;                                  // bye — no game this week
            if (gameStatus(g, now) === 'final') {
                const s = teamDetail[id] && teamDetail[id][w] && teamDetail[id][w][t.id];
                return { winProb: 1, pointsIfWin: s ? s.score : 0 };   // result locked in
            }
            const p = projByWeek[w] && projByWeek[w][t.id];
            return p ? { winProb: p.winProb, pointsIfWin: p.pointsIfWin } : null;
        }).filter(Boolean);
        const oddsFrom = (ea, eb) => {
            const r = matchupWinProb(ea, eb);
            if (!r) return null;
            const pa = Math.round(r.a * 100);
            return { a: pa, b: 100 - pa };
        };
        const oddsFor = (a, b, w) => oddsFrom(entriesFor(a, w), entriesFor(b, w));
        const liveOddsFor = (a, b, w) => oddsFrom(liveEntriesFor(a, w), liveEntriesFor(b, w));
        const gameFor = (a, b, w, live) => {
            const sa = round(totals[a][w] || 0), sb = round(totals[b][w] || 0);
            return {
                aId: a, aScore: sa, aTeams: live ? teamsLive(a, w) : teamsFinal(a, w),
                bId: b, bScore: sb, bTeams: live ? teamsLive(b, w) : teamsFinal(b, w),
                winner: live ? null : (sa > sb ? 'a' : (sb > sa ? 'b' : 'tie')),
                winP: live ? liveOddsFor(a, b, w) : oddsFor(a, b, w),
                final: !live
            };
        };
        const schedWeeks = finalWeeks.slice();
        if (currentWeek && !schedWeeks.includes(currentWeek)) schedWeeks.push(currentWeek);
        schedWeeks.sort((a, b) => a - b);
        const schedule = schedWeeks.map(w => {
            const live = (w === currentWeek) && !weekFinal[w];
            return { week: w, final: !live, games: (scheduleAll[w] || []).map(([a, b]) => gameFor(a, b, w, live)) };
        });
        let featuredWeek = currentWeek || (finalWeeks.length ? finalWeeks[finalWeeks.length - 1] : (schedWeeks[schedWeeks.length - 1] || null));
        let currentWeekOut = currentWeek;

        // Dev-only preview of the in-progress states (non-production). Doctors the
        // latest week so the pre-kickoff and mixed live views can be seen on a
        // finished season: ?h2hSim=pregame (nothing started) | mixed (some final,
        // some live, some upcoming).
        if (req.query.h2hSim && process.env.NODE_ENV !== 'production' && schedule.length) {
            const mode = String(req.query.h2hSim);
            const w = schedule[schedule.length - 1];
            w.final = false;
            const doctor = (arr) => (arr || []).map((t, j) => {
                const status = mode === 'pregame' ? 'scheduled' : (j === 0 ? 'final' : (j === 1 ? 'live' : 'scheduled'));
                return { teamId: t.teamId, school: t.school, abbr: t.abbr, logo: t.logo, status, score: status === 'final' ? t.score : null, kickoff: status === 'scheduled' ? 'Sat 3:30' : null, opp: j % 2 ? 'UGA' : 'ARK', ha: j % 2 ? '@' : 'vs', gameScore: status === 'final' ? '31–20' : null, captain: j === 0 };
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

        res.json({ league, season: seasonNum, enabled: eng.h2hEnabled, winBonus, tieBonus, weeks: schedWeeks, featuredWeek, currentWeek: currentWeekOut, managers, schedule });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
