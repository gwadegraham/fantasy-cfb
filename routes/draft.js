const express = require('express');
const router = express.Router();
const Draft = require('../models/draft');
const User = require('../models/user');
const { reconstructAll } = require('../modules/draft-history');

// Trim a reconstruction result down to what the admin UI renders (drops the
// full team objects on each pick; keeps the human-readable board).
function previewShape(r) {
    return {
        league: r.league, season: r.season, orderMethod: r.orderMethod,
        ok: r.ok, errors: r.errors, integrity: r.integrity,
        order: (r.order || []).map(o => ({ name: o.name, slot: o.slot })),
        board: r.board,
        exists: r.exists, existingStatus: r.existingStatus,
        wouldWrite: r.wouldWrite, willWrite: r.willWrite, skipReason: r.skipReason
    };
}

// One-time backfill of historical drafts into the `drafts` collection, rebuilt
// from user.seasons[] (see modules/draft-history.js). Commissioner-gated by the
// /draft router. Dry-run by default — writes ONLY when commit === true, and only
// the scope-locked seasons in DRAFT_HISTORY, so it can never touch a live draft.
router.post('/backfill', async (req, res) => {
    try {
        const commit = req.body.commit === true;
        const force = req.body.force === true;

        const userDocs = await User.find({}, { firstName: 1, lastName: 1, email: 1, league: 1, seasons: 1 }).lean();
        const results = reconstructAll(userDocs);

        // Annotate each season with whether a draft already exists and whether
        // this run would write it.
        for (const r of results) {
            const existing = await Draft.findOne({ league: r.league, season: r.season });
            r.exists = !!existing;
            r.existingStatus = existing ? existing.status : null;
            r.skipReason = null;
            if (!r.ok) {
                r.skipReason = 'reconstruction errors';
            } else if (existing && existing.status === 'active') {
                // An in-progress draft is sacrosanct — never overwritten, even with force.
                r.skipReason = "existing draft is 'active' — refusing to overwrite";
            } else if (existing && !force) {
                r.skipReason = `already has a '${existing.status}' draft (check "overwrite" to replace)`;
            }
            r.wouldWrite = r.ok && !r.skipReason;   // eligible to write (force already considered)
            r.willWrite = commit && r.wouldWrite;   // actually writing on this run
        }

        if (!commit) {
            return res.json({ dryRun: true, results: results.map(previewShape) });
        }

        const written = [];
        for (const r of results) {
            if (!r.willWrite) continue;
            await Draft.findOneAndUpdate(
                { league: r.league, season: r.season },
                {
                    $set: {
                        league: r.league, season: r.season, status: 'complete', snake: true,
                        totalRounds: r.integrity.rounds, orderMethod: r.orderMethod,
                        draftOrder: r.draftOrder, picks: r.picks,
                        currentOverall: r.picks.length + 1, updatedAt: new Date()
                    },
                    $setOnInsert: { createdAt: new Date() }
                },
                { upsert: true, setDefaultsOnInsert: true }
            );
            // Populate the dormant draftPosition on each manager's season.
            for (const o of r.order) {
                await User.updateOne(
                    { _id: o.userId, 'seasons.season': r.season },
                    { $set: { 'seasons.$.draftPosition': o.slot } }
                );
            }
            written.push({ league: r.league, season: r.season, picks: r.picks.length });
        }
        return res.json({ dryRun: false, written, results: results.map(previewShape) });
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
