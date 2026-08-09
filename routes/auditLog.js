const express = require('express');
const router = express.Router();
const AuditLog = require('../models/auditLog');
const { toRow } = require('../modules/audit-log');
const { canManageLeague } = require('../modules/league-access');
const { LEAGUES } = require('../modules/scoring-defaults');

// Recent commissioner actions, newest first.
//
// Scoped to what the caller may manage — an Admin sees every league, a League
// Manager only their own. Entries with no league (nothing does that today, but
// the field is optional) are treated as platform-wide and shown to Admins only.
// Read-only: entries are written server-side by the handlers that make the
// change, never by a client.
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 25, 100);
        const visible = LEAGUES.map(l => l.code).filter(code => canManageLeague(req, code));
        if (!visible.length) return res.json({ entries: [], scope: [] });

        // An Admin (every league visible) also sees league-less entries.
        const seesAll = visible.length === LEAGUES.length;
        const query = seesAll
            ? {}
            : { league: { $in: visible } };

        const docs = await AuditLog.find(query, null, { sort: { createdAt: -1 }, limit }).lean();
        res.json({ entries: docs.map(toRow), scope: visible });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
