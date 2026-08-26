const BettingGroup = require('../models/bettingGroup');

module.exports = async function requireBettingGroupMember(req, res, next) {
    try {
        const group = await BettingGroup.findOne({ active: true });
        if (!group) return res.status(403).json({ message: 'No active betting group' });

        const userId = req.effUser
            && req.effUser.user_metadata
            && req.effUser.user_metadata.metadata
            && req.effUser.user_metadata.metadata.userId;

        if (!userId) return res.status(403).json({ message: 'Forbidden' });

        const isMember = group.members.some(m => m.toString() === userId);
        if (!isMember) return res.status(403).json({ message: 'Forbidden' });

        req.bettingGroup = group;
        req.bettingUserId = userId;
        next();
    } catch (err) {
        return res.status(500).json({ message: 'Error checking betting group membership' });
    }
};
