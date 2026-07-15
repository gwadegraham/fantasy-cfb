const express = require('express');
const router = express.Router();
const ScoringConfig = require('../models/scoringConfig');
const { resolveConfig, fieldsForModel } = require('../modules/scoring-defaults');

// Attaches the ordered field metadata (for the admin form + rules page) to a
// resolved config. `fields` reflect the resolved `disabled` set via each
// field's `enabled` flag.
function withFields(cfg) {
    return Object.assign({}, cfg, { fields: fieldsForModel(cfg.model, cfg.disabled) });
}

// Resolved config (defaults-merged) for a league — always returns usable
// values, combine mode, disabled events, and field metadata, even if the
// commissioner hasn't saved a config yet.
router.get('/:league', async (req, res) => {
    try {
        const doc = await ScoringConfig.findOne({ league: req.params.league });
        const overrides = doc
            ? { model: doc.model, values: doc.values, combineMode: doc.combineMode, disabled: doc.disabled }
            : null;
        res.json(withFields(resolveConfig(req.params.league, overrides)));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Upsert a league's scoring config (commissioner-gated via the mutation gate).
// Accepts point `values`, a `combineMode` override, and a `disabled` list of
// postseason condition keys.
router.post('/', async (req, res) => {
    try {
        const { league, model, values, combineMode, disabled } = req.body;
        if (!league) {
            return res.status(400).json({ message: 'league is required' });
        }
        const resolved = resolveConfig(league, { model, values, combineMode, disabled });
        const doc = await ScoringConfig.findOneAndUpdate(
            { league },
            { $set: {
                league,
                model: resolved.model,
                values: resolved.values,
                combineMode: resolved.combineMode,
                disabled: resolved.disabled,
                updatedAt: new Date()
            } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        res.json(withFields(resolveConfig(league, {
            model: doc.model, values: doc.values, combineMode: doc.combineMode, disabled: doc.disabled
        })));
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
