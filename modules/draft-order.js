const Draft = require('../models/draft');

// A manager who joins after the draft order was saved goes LAST in it.
//
// The draft room builds every slot from draftOrder (modules/draft-engine.js),
// so someone missing from it gets no picks at all — and nothing on draft night
// says so: starting only checks the order has two people. Appending here keeps
// a late joiner in the draft without the commissioner re-saving the order.
//
// Only while the draft has not started: once picks exist, a new slot would
// reshuffle every pick after it. And only when an order was actually set — an
// empty one is filled in full by the setup screen, from everyone in the season.
//
// One atomic update, so a repeat (or a race) cannot give anyone two slots.
// Account ids, like everything else in draftOrder.
async function appendManager(league, season, accountId) {
    if (!league || season == null || !accountId) return false;
    const res = await Draft.updateOne(
        {
            league, season: Number(season),
            status: { $in: ['pending', 'scheduled'] },
            'draftOrder.0': { $exists: true },
            draftOrder: { $ne: accountId }
        },
        { $push: { draftOrder: accountId } }
    );
    return res.modifiedCount > 0;
}

module.exports = { appendManager };
