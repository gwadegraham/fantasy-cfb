const express = require('express');
const router = express.Router();
const audit = require('../modules/audit-log');
const League = require('../models/league');
const leagueCatalog = require('../modules/league-catalog');
const { viewableBy } = require('../modules/league-selection');
const { canManageLeague } = require('../modules/league-access');

// List leagues with their (editable) display names, falling back to the
// hardcoded defaults for any league without a saved name.
router.get('/', async (req, res) => {
    try {
        // The catalog, so a league that exists only in the database can be
        // renamed. It was LEAGUES.map, which meant the one editable thing
        // about a new league — the name shown in the switcher — was stuck at
        // whatever its insert happened to set.
        //
        // Scoped to the caller. The commissioner gate in server.js lets every
        // GET through, so without this any logged-in member could list the
        // name and code of every league in the database — including one that
        // exists but has not been announced yet. An Admin still sees them all.
        const mine = new Set(await viewableBy(req));
        const list = (await leagueCatalog.catalog(req))
            .filter(l => mine.has(l.code))
            .map(l => ({ code: l.code, name: l.name }));
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
        const known = await leagueCatalog.codes(req);
        if (!known.includes(code)) {
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
        await audit.record(req, {
            action: 'league.rename', league: code,
            summary: `League renamed to "${doc.name}"`,
            meta: { name: doc.name }
        });
        res.json({ code: doc.code, name: doc.name });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
