const express = require('express');
const router = express.Router();
const Parlay = require('../models/parlay');
const Game = require('../models/game');
const Team = require('../models/team');
const BettingLine = require('../models/bettingLine');
const Ranking = require('../models/ranking');
const requireBettingGroupMember = require('../modules/require-betting-group');
const { effectiveRoles } = require('../modules/dev-role');
const { parlayPayout, combinedAmericanOdds } = require('../modules/parlay-calc');

router.use(requireBettingGroupMember);

function isAdmin(req) {
    return effectiveRoles(req).includes('Admin');
}

router.get('/list', async (req, res) => {
    try {
        const season = req.query.season || process.env.YEAR;
        const parlays = await Parlay.find({
            group: req.bettingGroup._id,
            season: Number(season)
        }).sort({ week: -1 }).lean();
        res.json(parlays);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/season-summary/:season', async (req, res) => {
    try {
        const parlays = await Parlay.find({
            group: req.bettingGroup._id,
            season: Number(req.params.season)
        }).lean();

        const record = { wins: 0, losses: 0, pushes: 0, pending: 0 };
        let totalWagered = 0;
        let totalReturned = 0;

        for (const p of parlays) {
            totalWagered += p.wager || 0;
            totalReturned += p.payout || 0;
            if (p.status === 'won') record.wins++;
            else if (p.status === 'lost') record.losses++;
            else if (p.status === 'push') record.pushes++;
            else record.pending++;
        }

        res.json({
            record,
            totalParlays: parlays.length,
            totalWagered,
            totalReturned,
            net: totalReturned - totalWagered
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/games/:season/:week', async (req, res) => {
    try {
        const season = Number(req.params.season);
        const week = Number(req.params.week);
        const seasonType = req.query.seasonType || 'regular';

        const teamIds = new Set();
        const [games, lines, ranking] = await Promise.all([
            Game.find({ season, week, seasonType }).sort({ startDate: 1 }).lean(),
            BettingLine.find({ season, week, seasonType }).lean(),
            Ranking.findOne({ season, week, seasonType }).lean()
        ]);

        const rankMap = new Map();
        if (ranking && ranking.polls) {
            const ap = ranking.polls.find(p => p.poll === 'AP Top 25');
            if (ap && ap.ranks) {
                ap.ranks.forEach(r => rankMap.set(r.school, r.rank));
            }
        }

        games.forEach(g => { teamIds.add(g.homeId); teamIds.add(g.awayId); });
        const teams = await Team.find({ id: { $in: [...teamIds] } }, 'id logos').lean();
        const logoMap = new Map(teams.map(t => [t.id, t.logos]));
        const lineMap = new Map(lines.map(l => [l.id, l]));

        const merged = games.map(game => {
            const bl = lineMap.get(game.id);
            let dk = null;
            if (bl && bl.lines) {
                dk = bl.lines.find(l => l.provider && l.provider.toLowerCase().includes('draftkings'));
            }
            return {
                id: game.id,
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                homeId: game.homeId,
                awayId: game.awayId,
                homeLogos: logoMap.get(game.homeId) || [],
                awayLogos: logoMap.get(game.awayId) || [],
                homeRank: rankMap.get(game.homeTeam) || null,
                awayRank: rankMap.get(game.awayTeam) || null,
                startDate: game.startDate,
                completed: game.completed,
                homePoints: game.homePoints,
                awayPoints: game.awayPoints,
                dk: dk ? {
                    spread: dk.spread,
                    formattedSpread: dk.formattedSpread,
                    overUnder: dk.overUnder,
                    homeMoneyline: dk.homeMoneyline,
                    awayMoneyline: dk.awayMoneyline
                } : null
            };
        });

        res.json(merged);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const parlay = await Parlay.findById(req.params.id).lean();
        if (!parlay) return res.status(404).json({ message: 'Parlay not found' });
        res.json(parlay);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { season, seasonType, week, wager } = req.body;
        const s = Number(season || process.env.YEAR);
        const w = Number(week);
        const st = seasonType || 'regular';

        if (!w) return res.status(400).json({ message: 'Week is required' });

        const existing = await Parlay.findOne({
            group: req.bettingGroup._id, season: s, week: w
        });
        if (existing) return res.status(409).json({ message: 'Parlay already exists for this week' });

        const legs = req.bettingGroup.members.map(memberId => ({
            contributor: memberId
        }));

        const parlay = new Parlay({
            group: req.bettingGroup._id,
            season: s,
            seasonType: st,
            week: w,
            wager: wager || null,
            legs
        });
        await parlay.save();
        res.status(201).json(parlay);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.patch('/:id/legs', async (req, res) => {
    try {
        const parlay = await Parlay.findById(req.params.id);
        if (!parlay) return res.status(404).json({ message: 'Parlay not found' });
        if (parlay.status !== 'pending') {
            return res.status(400).json({ message: 'Parlay is already resolved' });
        }

        const { contributor, gameId, betType, selection, line, odds } = req.body;
        if (!contributor) return res.status(400).json({ message: 'Contributor is required' });

        const isSelf = req.bettingUserId === contributor;
        if (!isSelf && !isAdmin(req)) {
            return res.status(403).json({ message: 'You can only edit your own leg' });
        }

        const leg = parlay.legs.find(l => l.contributor && l.contributor.toString() === contributor);
        if (!leg) return res.status(404).json({ message: 'No leg found for this contributor' });

        if (gameId != null) {
            const game = await Game.findOne({ id: gameId }).lean();
            if (game && game.startDate && new Date(game.startDate) < new Date() && !isAdmin(req)) {
                return res.status(400).json({ message: 'Game has already started' });
            }
            leg.gameId = gameId;
        }
        if (betType != null) leg.betType = betType;
        if (selection != null) leg.selection = selection;
        if (line !== undefined) leg.line = line;
        if (odds != null) leg.odds = odds;
        leg.result = 'pending';
        leg.resolvedAt = null;

        parlay.updatedAt = new Date();
        await parlay.save();
        res.json(parlay);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        if (!isAdmin(req)) {
            return res.status(403).json({ message: 'Admin only' });
        }

        const parlay = await Parlay.findById(req.params.id);
        if (!parlay) return res.status(404).json({ message: 'Parlay not found' });

        if (req.body.wager != null) parlay.wager = req.body.wager;
        if (req.body.seasonType != null) parlay.seasonType = req.body.seasonType;
        parlay.updatedAt = new Date();
        await parlay.save();
        res.json(parlay);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        if (!isAdmin(req)) {
            return res.status(403).json({ message: 'Admin only' });
        }
        const parlay = await Parlay.findById(req.params.id);
        if (!parlay) return res.status(404).json({ message: 'Parlay not found' });
        if (parlay.status !== 'pending') {
            return res.status(400).json({ message: 'Cannot delete a resolved parlay' });
        }
        await Parlay.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
