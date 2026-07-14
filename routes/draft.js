const express = require('express');
const router = express.Router();
const Draft = require('../models/draft');

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
