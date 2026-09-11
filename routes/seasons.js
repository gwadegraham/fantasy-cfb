const express = require('express');
const router = express.Router();
const audit = require('../modules/audit-log');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');
const { effectiveRoles } = require('../modules/dev-role');

// Reading and rolling over a sport's season.
//
// This exists because #312 took the season out of process.env.YEAR, and the
// runbook's old pivot — set the config var, restart — is now inert: the boot
// seed deliberately never overwrites a stored season, so without a real write
// path there would be NO way to roll the season over. A rollover that silently
// does nothing is worse than an env var, because the app keeps scoring last
// season and nothing says so.
//
// See docs/season-flip-runbook.md step 7, and `npm run season:set`.

const SPORTS = ['football', 'basketball'];
const STATUSES = ['preseason', 'in-season', 'complete'];

function isAdmin(req) {
    return effectiveRoles(req).includes('Admin');
}

// What season each sport is in, and where in the year it is. Readable by any
// signed-in caller (and by the internal token, which is how the standalone
// ingest jobs ask — they have no Mongo connection of their own).
router.get('/', async (req, res) => {
    try {
        const rows = await SportSeason.find({}, { sport: 1, season: 1, status: 1, _id: 0 })
            .sort({ sport: 1 }).lean();
        res.json(rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// One sport's active season. The shape the jobs consume.
router.get('/:sport', async (req, res) => {
    const sport = req.params.sport;
    if (!SPORTS.includes(sport)) {
        return res.status(400).json({ message: `Unknown sport "${sport}"` });
    }
    try {
        const row = await SportSeason.findOne({ sport }, { sport: 1, season: 1, status: 1, _id: 0 }).lean();
        if (!row) return res.status(404).json({ message: `No season stored for ${sport}` });
        res.json(row);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Roll a sport over to a new season (or set its status). Admin only — this is
// the single most consequential switch in the app: it decides which season the
// nightly scoring writes into.
router.put('/:sport', async (req, res) => {
    const sport = req.params.sport;
    if (!SPORTS.includes(sport)) {
        return res.status(400).json({ message: `Unknown sport "${sport}"` });
    }
    // Inside a try: effectiveRoles reads req.oidc.isAuthenticated(), and a
    // throw here is an unhandled rejection in an async Express 4 handler —
    // which HANGS the request rather than erroring. Found by a spec that hung
    // for 20s per test instead of failing.
    try {
        if (!isAdmin(req)) {
            return res.status(403).json({ message: 'Forbidden: admin only' });
        }
    } catch (err) {
        return res.status(500).json({ message: `Could not resolve caller roles: ${err.message}` });
    }

    const body = req.body || {};
    const hasSeason = body.season != null;
    const season = Number(body.season);
    if (hasSeason && (!Number.isInteger(season) || season < 2000 || season > 2100)) {
        return res.status(400).json({ message: `season must be a year, got ${JSON.stringify(body.season)}` });
    }
    if (body.status != null && !STATUSES.includes(body.status)) {
        return res.status(400).json({ message: `status must be one of ${STATUSES.join(', ')}` });
    }
    if (!hasSeason && body.status == null) {
        return res.status(400).json({ message: 'Nothing to change: send season and/or status' });
    }

    try {
        const before = await SportSeason.findOne({ sport }).lean();

        // Refuse a rollover that would move the season BACKWARDS unless the
        // caller says so explicitly. Going back means the nightly job starts
        // rewriting a finished season's scores, which is the most destructive
        // thing this endpoint can do, and a typo is far likelier than intent.
        if (hasSeason && before && season < Number(before.season) && body.force !== true) {
            return res.status(409).json({
                message: `Refusing to move ${sport} back from ${before.season} to ${season}. ` +
                         `Scoring would start overwriting a completed season. Resend with force: true if you mean it.`
            });
        }

        await activeSeason.setActiveSeason(sport, hasSeason ? season : before.season, body.status);
        const after = await SportSeason.findOne({ sport }, { sport: 1, season: 1, status: 1, _id: 0 }).lean();

        await audit.record(req, {
            action: 'season.set',
            summary: `${sport} season set to ${after.season} (${after.status})`,
            meta: { sport, from: before ? { season: before.season, status: before.status } : null, to: after }
        });

        // setActiveSeason re-primes THIS dyno; others pick it up on their own
        // refresh interval (modules/active-season.js startRefresh).
        res.json(after);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
