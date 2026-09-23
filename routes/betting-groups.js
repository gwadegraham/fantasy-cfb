const express = require('express');
const franchiseRepo = require('../modules/franchise-repo');
const { activeSeason } = require('../modules/active-season');
const router = express.Router();
const BettingGroup = require('../models/bettingGroup');
const Parlay = require('../models/parlay');
const User = require('../models/user');

router.get('/', async (req, res) => {
    try {
        const group = await BettingGroup.findOne({ active: true }).lean();
        if (!group) return res.json(null);

        const season = activeSeason('football');
        // `seasons: 1` here was 418KB and 4.4s against the M0 tier, to read ONE
        // field: franchiseName for the active season. A user document is ~103KB
        // across four seasons, and this fetched every season of every member.
        // Prod logs showed /betting-groups at 4.16s returning a 304 with zero
        // bytes — all of it server-side, computing a body it then didn't send.
        //
        // Subfield projection rather than $elemMatch: it keeps every season
        // element (so the .find below is unchanged) while carrying only the two
        // fields read off one. 418KB -> 1KB, 4.4s -> 75ms.
        const members = await franchiseRepo.byIds(
            group.members,
            { fields: ['firstName', 'league', 'avatarUrl', 'seasons.season', 'seasons.franchiseName'] }
        );

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
            season: activeSeason('football'),
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
