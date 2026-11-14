// Admin: the push delivery log, per manager and per device — the admin page's
// "Push deliveries" card (public/admin-push.js). Admin-only, because it names every
// manager's devices across every league.
//
// Answers the question the captainReminders ledger could not: for each send,
// did the push service take it, and did the phone say it ARRIVED?

const express = require('express');
const Account = require('../models/account');
const pushDelivery = require('../modules/push-delivery');

function build({ delivery = pushDelivery, accounts = Account } = {}) {
    const router = express.Router();
    router.get('/', async (req, res) => {
        const days = Math.min(30, Math.max(1, Number(req.query.days) || 14));
        try {
            // Accounts are small (a few dozen), and the subscription keys are
            // never selected.
            const people = await accounts.find({}, {
                firstName: 1, lastName: 1,
                'pushSubscriptions.endpoint': 1, 'pushSubscriptions.userAgent': 1,
                'pushSubscriptions.createdAt': 1, 'pushSubscriptions.receiptsSince': 1
            }).lean();
            const out = [];
            for (const p of people) {
                const { devices, settings } = await delivery.summarize(p._id, p.pushSubscriptions || [], { days });
                if (!devices.length && !settings.length) continue;
                out.push({ accountId: String(p._id), name: `${p.firstName || ''} ${p.lastName || ''}`.trim(), devices, settings });
            }
            // Problems first, then by name.
            // Only devices still registered count: a removed one is history.
            const rank = m => Math.min(2, ...m.devices.filter(d => d.registered).map(d =>
                d.health.status === 'silent' ? 0 : d.health.status === 'unproven' ? 1 : 2));
            out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
            res.json({ days, managers: out });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });
    return router;
}

module.exports = { build };
