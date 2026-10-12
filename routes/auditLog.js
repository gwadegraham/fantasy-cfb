const express = require('express');
const router = express.Router();
const AuditLog = require('../models/auditLog');
const { toRow, MANAGER_ACTIONS } = require('../modules/audit-log');
const { canManageLeague } = require('../modules/league-access');
const leagueCatalog = require('../modules/league-catalog');

// Recent activity, newest first.
//
// `kind` splits the one collection into the two audiences it serves:
//   commissioner (default) — league-data changes. Captain rows are EXCLUDED,
//     because a game week writes one per manager and would push every
//     scoring-config or roster change off a 25-row panel.
//   captain — the manager picks and the rejected post-lock attempts.
//   all — both.
//
// Scoped to what the caller may manage — an Admin sees every league, a League
// Manager only their own. Entries with no league (nothing does that today, but
// the field is optional) are treated as platform-wide and shown to Admins only.
// Read-only: entries are written server-side by the handlers that make the
// change, never by a client.
router.get('/', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 25, 100);
        const all = await leagueCatalog.codes(req);
        const visible = all.filter(code => canManageLeague(req, code));
        if (!visible.length) return res.json({ entries: [], scope: [] });

        // ?league= narrows to ONE league the caller may manage — the
        // basketball admin page's Activity shows its own league, not the
        // football leagues' changes (#518). Narrows only: a league outside
        // `visible` is refused rather than widening anything.
        const only = req.query.league ? String(req.query.league) : null;
        if (only && !visible.includes(only)) return res.status(403).json({ message: 'Forbidden: not your league' });

        // An Admin (every league visible) also sees league-less entries.
        const seesAll = !only && visible.length === all.length;
        const query = only ? { league: only }
            : seesAll ? {}
            : { league: { $in: visible } };

        const kind = String(req.query.kind || 'commissioner');
        const manager = [...MANAGER_ACTIONS];
        if (kind === 'captain') query.action = { $in: manager };
        else if (kind !== 'all') query.action = { $nin: manager };

        const docs = await AuditLog.find(query, null, { sort: { createdAt: -1 }, limit }).lean();
        res.json({ entries: docs.map(toRow), scope: only ? [only] : visible, kind });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
