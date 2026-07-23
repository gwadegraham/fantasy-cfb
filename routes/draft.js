const express = require('express');
const router = express.Router();
const Draft = require('../models/draft');
const User = require('../models/user');
const Team = require('../models/team');
const { computeGrades } = require('../modules/draft-grades');

// Post-draft grades for a league + season — immediate preseason feedback that
// blends roster strength (SP+) and draft value (SP+ quality vs. draft slot).
// Read-only; available as soon as the draft is complete.
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

        // SP+ lives on the Team docs (the draft-pick snapshots don't carry it).
        const teams = await Team.find({}, { id: 1, seasons: 1 }).lean();
        const teamsById = {};
        teams.forEach(t => { teamsById[String(t.id)] = t; });

        const managers = computeGrades(draft, usersById, teamsById);
        res.json({ league, season, managers });
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
