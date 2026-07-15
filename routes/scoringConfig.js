const express = require('express');
const router = express.Router();
const ScoringConfig = require('../models/scoringConfig');
const { resolveConfig, MODELS } = require('../modules/scoring-defaults');

// Resolved config (defaults-merged) for a league — always returns usable
// values, even if the commissioner hasn't saved a config yet. Includes the
// ordered field metadata so the admin UI can build the form.
router.get('/:league', async (req, res) => {
    try {
        const doc = await ScoringConfig.findOne({ league: req.params.league });
        const overrides = doc ? { model: doc.model, values: doc.values } : null;
        const cfg = resolveConfig(req.params.league, overrides);
        res.json(Object.assign({}, cfg, { fields: MODELS[cfg.model].fields }));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Upsert a league's scoring values (commissioner-gated via the mutation gate).
router.post('/', async (req, res) => {
    try {
        const { league, model, values } = req.body;
        if (!league) {
            return res.status(400).json({ message: 'league is required' });
        }
        const resolved = resolveConfig(league, { model, values });
        const doc = await ScoringConfig.findOneAndUpdate(
            { league },
            { $set: { league, model: resolved.model, values: resolved.values, updatedAt: new Date() } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        const cfg = resolveConfig(league, { model: doc.model, values: doc.values });
        res.json(Object.assign({}, cfg, { fields: MODELS[cfg.model].fields }));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
