const express = require('express');
const router = express.Router();
const BettingGroup = require('../models/bettingGroup');
const Parlay = require('../models/parlay');
const User = require('../models/user');

router.get('/', async (req, res) => {
    try {
        const group = await BettingGroup.findOne({ active: true }).lean();
        if (!group) return res.json(null);

        const season = Number(process.env.YEAR);
        const members = await User.find(
            { _id: { $in: group.members } },
            { firstName: 1, league: 1, seasons: 1, avatarUrl: 1 }
        ).lean();

        const memberDetails = members.map(m => {
            const s = (m.seasons || []).find(s => s.season === season);
            return {
                _id: m._id,
                firstName: m.firstName,
                league: m.league,
                avatarUrl: m.avatarUrl,
                franchiseName: s ? s.franchiseName : null
            };
        });

        res.json({ ...group, memberDetails });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.post('/', async (req, res) => {
    try {
        const { name, members } = req.body;
        if (!members || !members.length) {
            return res.status(400).json({ message: 'Members are required' });
        }

        await BettingGroup.updateMany({ active: true }, { active: false });

        const group = new BettingGroup({
            name: name || 'Betting Group',
            members,
            season: Number(process.env.YEAR),
            active: true
        });
        await group.save();
        res.status(201).json(group);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const updates = {};
        if (req.body.name != null) updates.name = req.body.name;
        if (req.body.members != null) updates.members = req.body.members;
        updates.updatedAt = new Date();

        const group = await BettingGroup.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true }
        );
        if (!group) return res.status(404).json({ message: 'Group not found' });

        if (req.body.members) {
            const newMembers = req.body.members.map(m => m.toString());
            const pendingParlays = await Parlay.find({ group: group._id, status: 'pending' });
            for (const parlay of pendingParlays) {
                const existingIds = parlay.legs.map(l => l.contributor.toString());
                for (const mid of newMembers) {
                    if (!existingIds.includes(mid)) {
                        parlay.legs.push({ contributor: mid });
                    }
                }
                parlay.legs = parlay.legs.filter(l => {
                    const cid = l.contributor.toString();
                    if (newMembers.includes(cid)) return true;
                    return !!l.selection;
                });
                parlay.updatedAt = new Date();
                await parlay.save();
            }
        }

        res.json(group);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
