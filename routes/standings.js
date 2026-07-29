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
const { resolveConfig } = require('../modules/scoring-defaults');
const { buildRankingProxy, buildPoolContext } = require('../modules/draft-projection');
const { buildProjections, simulateTitleOdds } = require('../modules/standings-projection');
const { buildAdvancedHighlights } = require('../modules/standings-highlights');
const { buildWeeklyRecaps, indexUpsets } = require('../modules/weekly-recap');
const { scheduleForWeeks, resolveWeek, gameStatus, isWeekFinal } = require('../modules/h2h');

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
            model: cfgDoc.model, values: cfgDoc.values, combineMode: cfgDoc.combineMode, disabled: cfgDoc.disabled
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

        // `latest` (used by the weekly popup) resolves to the most recent season
        // the manager actually has weekly scores for — so the popup works during
        // the season and shows last season's finish in the offseason.
        let season = req.params.season;
        if (season === 'latest') {
            const target = await User.findById(userId);
            const played = ((target && target.seasons) || [])
                .filter(s => (s.weeklyScore || []).length > 0)
                .sort((a, b) => Number(b.season) - Number(a.season));
            if (!played.length) return res.json({ league, season: null, userId, recaps: [] });
            season = String(played[0].season);
        }
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

        const cfgDoc = await ScoringConfig.findOne({ league }).lean();
        const eng = resolveConfig(league, cfgDoc || null).engagement;
        const winBonus = eng.h2hWinBonus;

        // H2H matchups run the fantasy regular season only. Weeks 15+ (conf
        // championships, Army/Navy) and the postseason still count toward season
        // totals, but their thin slates make for unfair matchups — so no H2H past
        // this cap. Named for easy adjustment.
        const H2H_LAST_WEEK = 14;

        const users = await User.find({ league, 'seasons.season': season });
        const isRegular = w => w.season !== 'postseason' && w.week <= 16;
        const round = v => Math.round(v * 10) / 10;
        const ids = [], meta = {}, totals = {}, teamDetail = {};
        const draftedSet = new Set();
        users.forEach(u => {
            const s = (u.seasons || []).find(x => String(x.season) === String(season));
            if (!s || !(s.weeklyScore || []).length) return;
            const id = String(u._id);
            ids.push(id);
            const logoBy = {}, abbrBy = {};
            const roster = (s.teams || []).map(t => { const logo = (t.logos || []).slice(-1)[0] || null; logoBy[t.id] = logo; abbrBy[t.id] = t.abbreviation || null; draftedSet.add(t.id); return { id: t.id, school: t.school, abbr: t.abbreviation || null, logo }; });
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
                if (!isRegular(e) || e.week > H2H_LAST_WEEK) return;
                const w = e.week;
                tw[w] = (tw[w] || 0) + (e.score || 0);
                const byTeam = twTeams[w] || (twTeams[w] = {});
                (e.scoreByTeam || []).forEach(st => {
                    const k = st.teamId;
                    if (!byTeam[k]) byTeam[k] = { teamId: st.teamId, school: st.team, abbr: abbrBy[st.teamId] || null, logo: logoBy[st.teamId] || null, score: 0 };
                    byTeam[k].score += (st.score || 0);
                });
            });
            totals[id] = tw;
            teamDetail[id] = twTeams;
        });
        if (!ids.length) return res.json({ league, season: seasonNum, enabled: eng.h2hEnabled, winBonus, weeks: [], managers: [], schedule: [] });

        // Game status for in-progress weeks: whether each rostered team's game is
        // final / live / upcoming, and which weeks are fully complete. Pairings
        // are computed over the FIXED regular-season range so a week's matchup is
        // stable whether or not it's been scored yet.
        const allWeeks = Array.from({ length: H2H_LAST_WEEK }, (_, i) => i + 1);
        const draftedIds = [...draftedSet];
        const games = draftedIds.length ? await Game.find(
            { season: seasonNum, seasonType: 'regular', week: { $lte: H2H_LAST_WEEK }, $or: [{ homeId: { $in: draftedIds } }, { awayId: { $in: draftedIds } }] },
            { id: 1, week: 1, startDate: 1, startTimeTbd: 1, completed: 1, homeId: 1, homeTeam: 1, homePoints: 1, awayId: 1, awayTeam: 1, awayPoints: 1, _id: 0 }
        ).lean() : [];
        // Opponent abbreviations (opponents aren't always rostered, so look them
        // up from the Team collection).
        const oppAbbrById = {};
        const gameTeamIds = [...new Set(games.flatMap(g => [g.homeId, g.awayId]).filter(x => x != null))];
        if (gameTeamIds.length) {
            const tdocs = await Team.find({ id: { $in: gameTeamIds } }, { id: 1, abbreviation: 1, _id: 0 }).lean();
            tdocs.forEach(td => { oppAbbrById[td.id] = td.abbreviation || null; });
        }
        const gamesByWeek = {}, gameTW = {};
        games.forEach(g => {
            (gamesByWeek[g.week] = gamesByWeek[g.week] || []).push(g);
            [g.homeId, g.awayId].forEach(tid => {
                if (!draftedSet.has(tid)) return;
                const m = gameTW[tid] || (gameTW[tid] = {});
                if (!m[g.week] || (m[g.week].completed && !g.completed)) m[g.week] = g;   // prefer the unfinished game
            });
        });
        const now = Date.now();
        const scoredSet = new Set(ids.flatMap(id => Object.keys(totals[id]).map(Number)));
        const weekFinal = {};
        allWeeks.forEach(w => { weekFinal[w] = isWeekFinal(gamesByWeek[w]) && scoredSet.has(w); });
        let currentWeek = null;
        for (const w of allWeeks) { if ((gamesByWeek[w] || []).length && !weekFinal[w]) { currentWeek = w; break; } }

        // Records + win bonus count FINAL weeks only (an in-progress week has no
        // decided winner yet). Stable pairings over all 14 weeks.
        const scheduleAll = scheduleForWeeks(ids, allWeeks);
        const finalWeeks = allWeeks.filter(w => weekFinal[w]);
        const rec = {}; ids.forEach(id => { rec[id] = { wins: 0, losses: 0, ties: 0, bonus: 0, pointsFor: 0, pointsAgainst: 0 }; });
        finalWeeks.forEach(w => {
            const wt = {}; ids.forEach(id => { wt[id] = totals[id][w] || 0; });
            const r = resolveWeek(scheduleAll[w] || [], wt, winBonus);
            Object.keys(r).forEach(id => {
                const a = rec[id], x = r[id];
                if (x.result === 'W') a.wins++; else if (x.result === 'L') a.losses++; else a.ties++;
                a.bonus += x.bonus; a.pointsFor += x.for; a.pointsAgainst += x.against;
            });
        });
        const managers = ids.map(id => ({
            ...meta[id],
            wins: rec[id].wins, losses: rec[id].losses, ties: rec[id].ties,
            record: `${rec[id].wins}-${rec[id].losses}-${rec[id].ties}`,
            h2hBonus: rec[id].bonus,
            pointsFor: round(rec[id].pointsFor), pointsAgainst: round(rec[id].pointsAgainst),
            adjustedTotal: round(meta[id].cumulative + rec[id].bonus)   // cumulative already includes weeks 15+/postseason
        })).sort((a, b) => b.adjustedTotal - a.adjustedTotal).map((m, i) => ({ rank: i + 1, ...m }));

        // Schedule payload: final weeks + the current in-progress week. Final
        // weeks show scored contributing teams; the current week shows each
        // rostered team's live game status (final / live / kickoff time).
        const teamsFinal = (id, w) => Object.values((teamDetail[id] && teamDetail[id][w]) || {})
            .map(t => ({ school: t.school, abbr: t.abbr, logo: t.logo, score: round(t.score), status: 'final' }))
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
            return { school: t.school, abbr: t.abbr, logo: t.logo, score: scored ? round(scored.score) : null, status: st, kickoff: st === 'scheduled' ? fmtKick(g) : null, opp, ha: isHome ? 'vs' : '@', gameScore };
        }).filter(Boolean).sort((a, b) => (statusOrder[a.status] - statusOrder[b.status]) || ((b.score || 0) - (a.score || 0)));

        const gameFor = (a, b, w, live) => {
            const sa = round(totals[a][w] || 0), sb = round(totals[b][w] || 0);
            return {
                aId: a, aScore: sa, aTeams: live ? teamsLive(a, w) : teamsFinal(a, w),
                bId: b, bScore: sb, bTeams: live ? teamsLive(b, w) : teamsFinal(b, w),
                winner: live ? null : (sa > sb ? 'a' : (sb > sa ? 'b' : 'tie')),
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
                return { school: t.school, abbr: t.abbr, logo: t.logo, status, score: status === 'final' ? t.score : null, kickoff: status === 'scheduled' ? 'Sat 3:30' : null, opp: j % 2 ? 'UGA' : 'ARK', ha: j % 2 ? '@' : 'vs', gameScore: status === 'final' ? '31–20' : null };
            });
            w.games.forEach(g => {
                g.final = false; g.winner = null;
                g.aTeams = doctor(g.aTeams); g.bTeams = doctor(g.bTeams);
                const sum = (teams) => round(teams.filter(t => t.status === 'final').reduce((s, t) => s + (t.score || 0), 0));
                g.aScore = sum(g.aTeams); g.bScore = sum(g.bTeams);
            });
            featuredWeek = w.week; currentWeekOut = w.week;
        }

        res.json({ league, season: seasonNum, enabled: eng.h2hEnabled, winBonus, weeks: schedWeeks, featuredWeek, currentWeek: currentWeekOut, managers, schedule });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
