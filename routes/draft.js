const express = require('express');
const router = express.Router();
const Draft = require('../models/draft');
const User = require('../models/user');
const Team = require('../models/team');
const Game = require('../models/game');
const Ranking = require('../models/ranking');
const ScoringConfig = require('../models/scoringConfig');
const { resolveConfig } = require('../modules/scoring-defaults');
const { computeGrades } = require('../modules/draft-grades');

// Post-draft grades for a league + season — immediate preseason feedback. Each
// roster is projected to EXPECTED FANTASY POINTS under that league's own scoring
// config (schedule + SP+ win probs + market CFP odds), graded on absolute
// per-league bands. Read-only; available as soon as the draft is complete.
router.get('/grades/:league/:season', async (req, res) => {
    try {
        const league = req.params.league;
        const season = Number(req.params.season);
        const draft = await Draft.findOne({ league, season }).lean();
        if (!draft || !Array.isArray(draft.picks) || draft.picks.length === 0) {
            return res.json({ league, season, managers: [] });
        }
        const users = await User.find({ league },
            { firstName: 1, lastName: 1, league: 1, avatarUrl: 1, seasons: 1 }).lean();
        const usersById = {};
        users.forEach(u => { usersById[String(u._id)] = u; });

        // SP+ / expected wins / CFP odds / conference live on the Team docs.
        const teams = await Team.find({}, { id: 1, school: 1, alternateNames: 1, seasons: 1 }).lean();
        const teamsById = {};
        teams.forEach(t => { teamsById[String(t.id)] = t; });

        // Inputs the projection needs: the season's regular schedule, the
        // league's resolved scoring config, and a preseason AP poll if ingested
        // (else the projection synthesizes one from SP+).
        const games = await Game.find({ season, seasonType: 'regular' },
            { id: 1, season: 1, seasonType: 1, week: 1, neutralSite: 1, conferenceGame: 1,
              notes: 1, homeId: 1, homeTeam: 1, homeConference: 1,
              awayId: 1, awayTeam: 1, awayConference: 1 }).lean();

        const cfgDoc = await ScoringConfig.findOne({ league }).lean();
        const config = resolveConfig(league, cfgDoc ? {
            model: cfgDoc.model, values: cfgDoc.values,
            combineMode: cfgDoc.combineMode, disabled: cfgDoc.disabled
        } : null);

        const apDoc = await Ranking.findOne({ season, seasonType: 'regular' }).sort({ week: 1 }).lean();
        const apPoll = apDoc && Array.isArray(apDoc.polls)
            ? apDoc.polls.find(p => p.poll === 'AP Top 25') : null;

        const managers = computeGrades(draft, usersById, teamsById, { games, config, apPoll });
        res.json({ league, season, managers });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Average draft position per team, aggregated across every historical draft
// (both leagues, 2023–2025) — the "where does this team usually go" signal for
// the draft-room cheat sheet. Returns { adp: { [teamId]: { adp, n } } }.
// Static path, so it's declared before the /:league/:season param route.
router.get('/adp', async (req, res) => {
    try {
        const drafts = await Draft.find(
            { season: { $gte: 2023, $lte: 2025 }, 'picks.0': { $exists: true } },
            { picks: 1 }
        ).lean();

        const agg = {}; // teamId -> { sum, n }
        for (const d of drafts) {
            for (const p of (d.picks || [])) {
                const id = p && p.team && p.team.id;
                if (id == null || p.overall == null) continue;
                const key = String(id);
                if (!agg[key]) agg[key] = { sum: 0, n: 0 };
                agg[key].sum += p.overall;
                agg[key].n += 1;
            }
        }

        const adp = {};
        for (const [id, v] of Object.entries(agg)) {
            adp[id] = { adp: Math.round((v.sum / v.n) * 10) / 10, n: v.n };
        }
        res.json({ adp });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get the draft for a league + season (returns null if none configured yet).
router.get('/:league/:season', async (req, res) => {
    try {
        const draft = await Draft.findOne({ league: req.params.league, season: req.params.season });
        res.json(draft);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create or update a draft's configuration (upsert on league+season).
// Settings are locked once the draft is active or complete.
router.post('/', async (req, res) => {
    try {
        const { league, season } = req.body;
        if (!league || season == null) {
            return res.status(400).json({ message: 'league and season are required' });
        }

        const existing = await Draft.findOne({ league, season });
        if (existing && (existing.status === 'active' || existing.status === 'complete')) {
            return res.status(409).json({ message: `Draft is ${existing.status}; settings are locked` });
        }

        const update = {
            league,
            season,
            scheduledAt: req.body.scheduledAt || null,
            autoOpen: !!req.body.autoOpen,
            snake: req.body.snake !== false,
            totalRounds: req.body.totalRounds || 10,
            orderMethod: req.body.orderMethod || 'manual',
            draftOrder: Array.isArray(req.body.draftOrder) ? req.body.draftOrder : [],
            status: req.body.scheduledAt ? 'scheduled' : 'pending',
            updatedAt: new Date()
        };

        const draft = await Draft.findOneAndUpdate(
            { league, season },
            { $set: update, $setOnInsert: { picks: [], currentOverall: 1 } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.status(200).json(draft);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Start a draft: flip it to active so picks can be made. Requires a configured
// order of at least 2 participants.
router.post('/:id/start', async (req, res) => {
    try {
        const draft = await Draft.findById(req.params.id);
        if (draft == null) {
            return res.status(404).json({ message: 'Draft not found' });
        }
        if (draft.status === 'complete') {
            return res.status(409).json({ message: 'Draft is already complete' });
        }
        if (!Array.isArray(draft.draftOrder) || draft.draftOrder.length < 2) {
            return res.status(400).json({ message: 'Draft needs at least 2 participants' });
        }
        draft.status = 'active';
        if (!draft.currentOverall || draft.currentOverall < 1) {
            draft.currentOverall = 1;
        }
        draft.updatedAt = new Date();
        await draft.save();
        res.json(draft);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Reset a draft: clear picks and return it to pending. Used to re-run a draft
// or wipe a mistaken start.
router.post('/:id/reset', async (req, res) => {
    try {
        const draft = await Draft.findByIdAndUpdate(
            req.params.id,
            { $set: { status: 'pending', picks: [], currentOverall: 1, updatedAt: new Date() } },
            { new: true }
        );
        if (draft == null) {
            return res.status(404).json({ message: 'Draft not found' });
        }
        res.json(draft);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
