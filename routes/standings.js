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

module.exports = router;
