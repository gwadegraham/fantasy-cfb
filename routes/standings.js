const express = require('express');
const router = express.Router();
const User = require('../models/user');
const Team = require('../models/team');
const Record = require('../models/record');
const Game = require('../models/game');
const Betting = require('../models/bettingLine');
const Draft = require('../models/draft');
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

module.exports = router;
