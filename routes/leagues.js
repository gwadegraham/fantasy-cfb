const express = require('express');
const router = express.Router();
const League = require('../models/league');
const { LEAGUES } = require('../modules/scoring-defaults');
const { canManageLeague } = require('../modules/league-access');

// List leagues with their (editable) display names, falling back to the
// hardcoded defaults for any league without a saved name.
router.get('/', async (req, res) => {
    try {
        const docs = await League.find({}, { code: 1, name: 1, _id: 0 }).lean();
        const byCode = {};
        docs.forEach(d => { byCode[d.code] = d.name; });
        const list = LEAGUES.map(l => ({ code: l.code, name: byCode[l.code] || l.name }));
        res.json(list);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Rename a league. Commissioner-gated upstream (server.js); here we enforce
// that a League Manager can only rename their OWN league (Admins: any).
router.patch('/:code', async (req, res) => {
    try {
        const code = req.params.code;
        if (!LEAGUES.some(l => l.code === code)) {
            return res.status(404).json({ message: 'Unknown league' });
        }
        if (!canManageLeague(req, code)) {
            return res.status(403).json({ message: 'Forbidden' });
        }
        const name = ((req.body && req.body.name) || '').trim();
        if (!name) return res.status(400).json({ message: 'Name is required' });
        if (name.length > 40) return res.status(400).json({ message: 'Name too long (40 characters max)' });

        const doc = await League.findOneAndUpdate(
            { code },
            { code, name },
            { new: true, upsert: true }
        );
        res.json({ code: doc.code, name: doc.name });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
