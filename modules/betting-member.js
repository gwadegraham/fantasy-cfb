// Betting group membership flag for the navbar and My Team links. HTML GETs
// only, so API calls and static assets skip the query.
//
// Betting is football-only: parlay legs are built from football games,
// spreads and moneylines. On a basketball league the flag is false, so the
// nav entry and the My Team tile disappear and /betting redirects home,
// instead of showing the football league's parlays under the basketball
// league's name (#491). Runs after the middleware that sets viewerSport.

const BettingGroup = require('../models/bettingGroup');

function bettingMember() {
    return async (req, res, next) => {
        res.locals.isBettingGroupMember = false;
        try {
            if (req.method === 'GET'
                && (req.headers.accept || '').includes('text/html')
                && res.locals.viewerSport !== 'basketball'
                && req.oidc && req.oidc.isAuthenticated()) {
                const innerMeta = (req.oidc.user.user_metadata && req.oidc.user.user_metadata.metadata) || {};
                if (innerMeta.userId) {
                    const group = await BettingGroup.findOne({ active: true, members: innerMeta.userId }).lean();
                    res.locals.isBettingGroupMember = !!group;
                }
            }
        } catch (e) { /* non-fatal */ }
        next();
    };
}

module.exports = { bettingMember };
