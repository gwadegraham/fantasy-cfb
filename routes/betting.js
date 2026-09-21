const express = require('express');
const { activeSeason } = require('../modules/active-season');
const mongoose = require('mongoose');
const router = express.Router();
const Parlay = require('../models/parlay');
const Game = require('../models/game');
const Team = require('../models/team');
const BettingLine = require('../models/bettingLine');
const Ranking = require('../models/ranking');
const requireBettingGroupMember = require('../modules/require-betting-group');
const requireAdmin = require('../modules/require-admin');
const { effectiveRoles } = require('../modules/dev-role');
const { combinedAmericanOdds, settledPayout } = require('../modules/parlay-calc');
const { deriveParlayStatus } = require('../modules/parlay-resolve');
const { contributorStats, superlatives } = require('../modules/parlay-stats');

// Maintenance endpoint, called by the weekly enrichment job — not a member
// action. It re-grades stat legs whose box scores weren't available when the
// game finished, across every parlay, so it needs no betting-group context.
//
// Mounted ABOVE the member gate on purpose. That gate identifies the caller
// from its Auth0 session, and the job has no session — it's the server calling
// itself with the internal token — so every run this route has ever had was
// turned away with a 403 before reaching the handler. requireAdmin is the
// shared guard that accepts EITHER the internal token or an Admin session,
// which is what every other job-invoked route in the app already uses.
//
// The 403 was silent: it isn't a thrown error, so the job logged one line and
// still reported success.
router.post('/retry-stat-legs', requireAdmin, async (req, res) => {
    try {
        const season = Number(req.body.season || activeSeason('football'));
        const { retryPendingStatLegs } = require('../modules/parlay-resolve');
        const result = await retryPendingStatLegs(season);
        res.json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Everything below is a member action and needs the caller's betting group.
router.use(requireBettingGroupMember);

// Widest alternate spread the board offers, and the ceiling the API enforces.
// The real board tops out around 40 points; 75 leaves room above every line
// CFBD has ever carried while still rejecting a fat-fingered 750.
const MAX_SPREAD = 75;

function isAdmin(req) {
    return effectiveRoles(req).includes('Admin');
}

router.get('/list', async (req, res) => {
    try {
        const season = req.query.season || activeSeason('football');
        const parlays = await Parlay.find({
            group: req.bettingGroup._id,
            season: Number(season)
        }).sort({ week: -1 }).populate('placedBy', 'firstName lastName').lean();
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

// Per-member breakdown for the "Bettors" board. The group's own record
// (/season-summary above) says nothing about WHO is picking well: a slip is one
// per group per week, but each leg carries its own contributor and result.
//
// Members come from the group rather than from the legs, so someone who hasn't
// had a leg settle yet still appears — in a six-person group a missing name
// reads as a bug. Names are left to the client, which already holds them from
// /betting-groups for the leg rows.
router.get('/contributor-stats/:season', async (req, res) => {
    try {
        const parlays = await Parlay.find({
            group: req.bettingGroup._id,
            season: Number(req.params.season)
        }, { week: 1, status: 1, 'legs.contributor': 1, 'legs.result': 1, 'legs.odds': 1, _id: 0 }).lean();

        const members = (req.bettingGroup.members || []).map(id => ({ id: String(id) }));
        const rows = contributorStats(parlays, members);

        res.json({
            season: Number(req.params.season),
            rows,
            superlatives: superlatives(rows),
            slips: parlays.length
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

        // Week 0 = early games from CFBD week 1 (before the main slate)
        const dbWeek = week === 0 ? 1 : week;

        // PROJECT. An unprojected Game.find here read every field of every game
        // in the week — including wpSnapshots, which the live poller appends one
        // row to per tick, and livePlays (~50KB a game once the gamecast has
        // run). Measured against production data:
        //
        //   week 1:  99 games, 1890KB, 21135ms  (wpSnapshots 1333KB)
        //   week 2:  86 games, 3165KB, 33453ms  (wpSnapshots 2338KB)
        //   week 3:  75 games,   52KB,   523ms  (not played yet)
        //
        // It is worst for weeks already played, and it GROWS every game weekend
        // — PR #423 cut the poller to 10s on 12 Sep, tripling the snapshot rate,
        // and week 2 was the first weekend polled at that cadence. That is why
        // stepping back a week on the betting page took 22 seconds in prod.
        //
        // The route returns a shaped object (see `merged` below); none of the
        // weight was ever sent to the client, only read. This projection is
        // exactly the set `merged` reads, plus the fields the week-0/1 split
        // needs. 21135ms -> 513ms.
        const GAME_FIELDS = {
            id: 1, homeTeam: 1, awayTeam: 1, homeId: 1, awayId: 1,
            startDate: 1, completed: 1, homePoints: 1, awayPoints: 1, _id: 0
        };

        const teamIds = new Set();
        const [games, lines, ranking] = await Promise.all([
            Game.find({ season, week: dbWeek, seasonType }, GAME_FIELDS).sort({ startDate: 1 }).lean(),
            BettingLine.find({ season, week: dbWeek, seasonType }).lean(),
            Ranking.findOne({ season, week: dbWeek, seasonType }).lean()
        ]);

        const rankMap = new Map();
        if (ranking && ranking.polls) {
            const ap = ranking.polls.find(p => p.poll === 'AP Top 25');
            if (ap && ap.ranks) {
                ap.ranks.forEach(r => rankMap.set(r.school, r.rank));
            }
        }

        games.forEach(g => { teamIds.add(g.homeId); teamIds.add(g.awayId); });
        const teams = await Team.find({ id: { $in: [...teamIds] } }, 'id logos abbreviation').lean();
        const logoMap = new Map(teams.map(t => [t.id, t.logos]));
        const abbrMap = new Map(teams.map(t => [t.id, t.abbreviation]));
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
                homeAbbr: abbrMap.get(game.homeId) || null,
                awayAbbr: abbrMap.get(game.awayId) || null,
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

        // Week 0/1 split: find the gap between early games and the main slate
        if (week === 0 || (week === 1 && dbWeek === 1)) {
            const dates = merged.map(g => new Date(g.startDate).getTime()).sort((a, b) => a - b);
            let cutoff = null;
            for (let i = 1; i < dates.length; i++) {
                const gap = (dates[i] - dates[i - 1]) / (1000 * 60 * 60);
                if (gap >= 72) { cutoff = dates[i]; break; }
            }
            if (cutoff && week === 0) {
                return res.json(merged.filter(g => new Date(g.startDate).getTime() < cutoff));
            }
            if (cutoff && week === 1) {
                return res.json(merged.filter(g => new Date(g.startDate).getTime() >= cutoff));
            }
        }

        res.json(merged);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Catch-all: it sits below every named /betting route, so anything unmatched
// lands here as a parlay id. A non-id (public/team.js used to ask this router
// for a SEASON) made Mongoose throw a CastError that surfaced as a 500 — a
// server fault for what is a bad request. Reject the shape up front.
router.get('/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid parlay id' });
        }
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
        const s = Number(season || activeSeason('football'));
        const w = Number(week);
        const st = seasonType || 'regular';

        if (w == null || isNaN(w)) return res.status(400).json({ message: 'Week is required' });

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
            placedBy: req.bettingUserId,
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

        const { contributor, gameId, betType, selection, line, odds, teamSide, statCategory, statTeamSide } = req.body;
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
        if (odds != null) {
            const n = Number(odds);
            // No board quotes American odds between -100 and +100.
            if (isNaN(n) || Math.abs(n) < 100) {
                return res.status(400).json({ message: 'Odds must be +100 or higher, or -100 or lower' });
            }
            leg.odds = n;
        }
        if (teamSide !== undefined) leg.teamSide = teamSide;
        if (statCategory !== undefined) leg.statCategory = statCategory;
        if (statTeamSide !== undefined) leg.statTeamSide = statTeamSide;

        // Only the pick decides how a leg grades. Correcting the odds to the
        // price actually filled is now a one-tap edit, and blanket-resetting
        // the result on it un-graded a settled leg — after which nothing
        // recomputed parlay.status, so the ticket sat pending forever.
        const regradingFields = ['gameId', 'betType', 'selection', 'line', 'teamSide', 'statCategory', 'statTeamSide'];
        if (regradingFields.some(f => req.body[f] !== undefined)) {
            leg.result = 'pending';
            leg.resolvedAt = null;
        }

        // Spread legs are graded arithmetically off `line` and `teamSide`, so a
        // leg missing either — or carrying a quarter-point the board can't have
        // produced — would sit pending forever and land back on an admin. Refuse
        // it at the door instead. Checked against the leg AFTER the patch is
        // applied, because the client may be sending only the odds.
        if (leg.betType === 'spread') {
            const n = Number(leg.line);
            if (leg.line == null || isNaN(n) || Math.abs(n) > MAX_SPREAD || (n * 2) % 1 !== 0) {
                return res.status(400).json({ message: 'Spread must be a half-point number within ' + MAX_SPREAD });
            }
            if (leg.teamSide !== 'home' && leg.teamSide !== 'away') {
                return res.status(400).json({ message: 'Spread legs need a team side' });
            }
            leg.line = n;
        }

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

        // Every one of these used to be gated on `!= null`, which made them
        // write-once from the UI: emptying a box sent null and the route
        // quietly kept the old number, so a mistyped boost couldn't be undone.
        // Presence in the body is the signal now; empty means unset.
        const numericFields = ['wager', 'parlayOdds', 'boostPct', 'boostedOdds', 'boostCap', 'totalPayout'];
        for (const field of numericFields) {
            if (req.body[field] === undefined) continue;
            const raw = req.body[field];
            if (raw === null || raw === '') {
                parlay[field] = null;
                continue;
            }
            const n = Number(raw);
            // Booleans and arrays coerce to numbers without complaint, and a
            // negative wager or boost is not a thing — refuse rather than
            // quietly storing a figure that lands in the season's net.
            if (typeof raw === 'boolean' || Array.isArray(raw) || isNaN(n) || n < 0) {
                return res.status(400).json({ message: field + ' must be a number of 0 or more' });
            }
            parlay[field] = n;
        }
        if (req.body.seasonType != null) parlay.seasonType = req.body.seasonType;
        if (req.body.placedBy != null) parlay.placedBy = req.body.placedBy || null;
        parlay.updatedAt = new Date();
        await parlay.save();
        res.json(parlay);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.patch('/:id/legs/:contributor/resolve', async (req, res) => {
    try {
        if (!isAdmin(req)) {
            return res.status(403).json({ message: 'Admin only' });
        }

        const { result } = req.body;
        if (!['win', 'loss', 'push'].includes(result)) {
            return res.status(400).json({ message: 'Result must be win, loss, or push' });
        }

        const parlay = await Parlay.findById(req.params.id);
        if (!parlay) return res.status(404).json({ message: 'Parlay not found' });

        const leg = parlay.legs.find(l => l.contributor && l.contributor.toString() === req.params.contributor);
        if (!leg) return res.status(404).json({ message: 'Leg not found' });

        leg.result = result;
        leg.resolvedAt = new Date();

        parlay.status = deriveParlayStatus(parlay.legs);
        if (parlay.status === 'won' && parlay.wager) {
            parlay.payout = settledPayout(parlay);
        } else if (parlay.status === 'lost') {
            parlay.payout = 0;
        } else if (parlay.status === 'push') {
            parlay.payout = parlay.wager || 0;
        } else if (parlay.status === 'won') {
            // Won but no wager recorded — there is no payout to claim, and a
            // stale one would count as winnings against $0 staked.
            parlay.payout = null;
        }

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
