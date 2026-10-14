// Banking a league's head-to-head results into its weekly rows.
//
// Moved out of routes/scores.js applyH2HBonuses so football and basketball
// (modules/hoops-h2h.js) bank through ONE write path. The two sports differ in
// how a week's matchups are DECIDED — which games gate a week, which weeks
// count — and that stays with each caller, which hands in the result of
// modules/h2h.js computeH2HAwards. What happens next is identical, and is the
// part with history: a lossless one-array write, a loud miss, and the roster
// pin that keeps a membership change from re-deciding a settled week.

const ScoringConfig = require('../models/scoringConfig');
const franchiseRepo = require('./franchise-repo');
const { seasonEntry, applyAwards, H2H_MAX_WEEK } = require('./h2h');

// `computed` is computeH2HAwards' result, or null when H2H is off — an empty
// award map, which strips any bonus a previous pass stored. `maxWeek` bounds
// the weeks applyAwards may award (football's is H2H_MAX_WEEK).
async function bankLeague({ league, seasonNum, seasonStr, users, eng, pinnedIds, computed, maxWeek = H2H_MAX_WEEK }) {
    const awards = computed ? computed.awards : {};
    let updated = 0, awarded = 0;
    for (const user of users) {
        const s = seasonEntry(user, seasonStr);
        if (!s) continue;
        const plain = (s.weeklyScore || []).map(e => (e.toObject ? e.toObject() : e));
        const next = applyAwards(plain, awards[String(user._id)], maxWeek);
        if (!next.changed) continue;
        // Write the ONE array that changed, not the whole manager.
        //
        // user.save() rewrote the entire document — 105KB, of which
        // seasons[].teams is nearly all — to persist a 3KB weeklyScore, and
        // measured 1239ms against 95ms for this. The positional $ resolves
        // against the season matched in the filter, so it can only ever touch
        // the season being scored.
        //
        // applyAwards returns the FULL entries (it copies each one and edits
        // four fields), so this is lossless: scoreByTeam, the Captain fields
        // and anything else on an entry are written back as they were read.
        // That is exactly why the read below keeps weeklyScore whole instead
        // of trimming it to the six fields the computation needs — a trimmed
        // read would make this write silently destroy the rest.
        //
        // One real difference from the save() this replaces: updateOne does
        // NOT run schema validators (update validators are off by default),
        // and weeklyScoreSchema marks week and score required. Nothing
        // reachable regresses — applyAwards always writes a numeric score
        // (round1 of baseWeekScore, which floors a missing one to 0) and
        // copies week through untouched — but an entry that was already
        // malformed now persists instead of being rejected here.
        // The season condition stays in the FILTER, not the update: the
        // positional $ resolves against the array element the filter
        // matched. Without it the operator matches nothing, the bonus is
        // silently not stored, and the only sign is the matchedCount check
        // below.
        const res = await franchiseRepo.updateFranchise(
            user._id,
            { $set: { 'seasons.$.weeklyScore': next.weeklyScore } },
            { league, filter: { 'seasons.season': seasonNum } }
        );
        if (!res.matchedCount) {
            // Loud: a manager whose bonus could not be written is a standings
            // row that silently disagrees with every other surface.
            console.error(`H2H bonus not written for ${user._id} (${league} ${seasonStr}): no matching season`);
            continue;
        }
        updated++;
        awarded += next.weeklyScore.reduce((sum, e) => sum + (e.h2hBonus || 0), 0);
    }
    // Freeze the manager list the moment the first week settles. Everything
    // before that is unbanked, so the list stays live and preseason roster
    // churn costs nothing; from here on, no membership change can re-decide a
    // week that has already paid out.
    let pinned = false;
    if (eng.h2hEnabled && !pinnedIds && computed && computed.finalWeeks.length && computed.ids.length) {
        await ScoringConfig.updateOne(
            { league },
            { $set: { ['h2hScheduleBySeason.' + seasonStr]: { ids: computed.ids, pinnedAt: new Date() } } },
            { upsert: true }
        );
        pinned = true;
        console.log(`H2H roster pinned · ${league} ${seasonStr}: ${computed.ids.length} manager(s)`);
    }


    return { managersUpdated: updated, bonusAwarded: awarded, rosterPinned: pinned };
}

module.exports = { bankLeague };
