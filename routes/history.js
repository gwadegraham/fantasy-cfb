const express = require('express');
const router = express.Router();
const User = require('../models/user');

// Hall of Fame / league history aggregation. Walks every user's seasons and
// derives, per league: the champion of each completed season, an all-time
// manager leaderboard (titles, total points, best/worst, avg finish), and each
// manager's year-by-year record. Read-only; no new data — cumulativeScore,
// draftPosition and franchiseName already live on user.seasons.
//
// A season counts as "completed" once at least one manager has a
// cumulativeScore (excludes the in-progress current season, which has none).
router.get('/:league', async (req, res) => {
    try {
        const league = req.params.league;
        const users = await User.find({ league },
            { firstName: 1, lastName: 1, avatarUrl: 1, color: 1, seasons: 1 }).lean();

        const fullName = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim();
        const initials = (u) => (((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '')).toUpperCase();
        // Most recent franchise name the manager used (flavor; may be unset).
        const latestFranchise = (u) => {
            const named = (u.seasons || []).filter(s => s.franchiseName)
                .sort((a, b) => Number(b.season) - Number(a.season));
            return named.length ? named[0].franchiseName : null;
        };

        // Group scored (userId, season) entries by season.
        const bySeason = {};
        users.forEach(u => {
            (u.seasons || []).forEach(s => {
                if (s.cumulativeScore == null) return;      // in-progress / never scored
                (bySeason[s.season] = bySeason[s.season] || []).push({
                    userId: String(u._id), name: fullName(u),
                    franchise: s.franchiseName || null,
                    avatarUrl: u.avatarUrl || null, initials: initials(u), color: u.color || null,
                    score: s.cumulativeScore
                });
            });
        });

        // Per-season standings (ranked) + champion. Newest season first.
        const seasons = Object.keys(bySeason)
            .map(Number).sort((a, b) => b - a)
            .map(season => {
                const ranked = bySeason[season].slice().sort((a, b) => b.score - a.score);
                const of = ranked.length;
                ranked.forEach((r, i) => { r.rank = i + 1; r.of = of; });
                return { season, champion: ranked[0], standings: ranked };
            });

        // Per-manager all-time rollup.
        const mgr = {};
        seasons.forEach(({ season, standings }) => {
            standings.forEach(r => {
                const m = mgr[r.userId] || (mgr[r.userId] = {
                    userId: r.userId, name: r.name, avatarUrl: r.avatarUrl,
                    initials: r.initials, color: r.color,
                    titles: 0, titleSeasons: [], totalPoints: 0, seasonsPlayed: 0,
                    finishes: [], bestSeason: null, worstSeason: null, history: []
                });
                m.seasonsPlayed++;
                m.totalPoints += r.score;
                m.finishes.push(r.rank);
                if (r.rank === 1) { m.titles++; m.titleSeasons.push(season); }
                if (!m.bestSeason || r.score > m.bestSeason.score) m.bestSeason = { season, score: r.score };
                if (!m.worstSeason || r.score < m.worstSeason.score) m.worstSeason = { season, score: r.score };
                m.history.push({ season, score: r.score, rank: r.rank, of: r.of, franchise: r.franchise, champion: r.rank === 1 });
            });
        });

        const managers = Object.values(mgr).map(m => {
            const u = users.find(x => String(x._id) === m.userId);
            return {
                userId: m.userId, name: m.name, franchise: u ? latestFranchise(u) : null,
                avatarUrl: m.avatarUrl, initials: m.initials, color: m.color,
                titles: m.titles, titleSeasons: m.titleSeasons,
                totalPoints: Math.round(m.totalPoints), seasonsPlayed: m.seasonsPlayed,
                avgFinish: Math.round((m.finishes.reduce((a, b) => a + b, 0) / m.finishes.length) * 10) / 10,
                bestSeason: m.bestSeason, worstSeason: m.worstSeason,
                history: m.history.sort((a, b) => b.season - a.season)
            };
        }).sort((a, b) => b.titles - a.titles || b.totalPoints - a.totalPoints);

        res.json({ league, seasons, managers });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
