// Decides whether a stored week's poll doc must be re-pulled from CFBD because
// the Playoff Committee ranking has probably published since it was saved.
//
// Why this exists: the poll doc for week N is created the first time scoring
// runs in week N, which is Monday night (the AP/Coaches polls are out Sunday).
// The committee releases its ranking on TUESDAY evening, into that same week-N
// doc on CFBD's side. Before this check, "the doc exists" meant "done", so the
// committee ranking never reached us: Nov 2026 weeks 11 and 12 were stored with
// AP only, and every page and every scoring rule fell back to AP (South Carolina
// showed unranked while the committee had them #21).
//
// So: from the week the committee could have started publishing, a doc with no
// committee poll is re-pulled — throttled, because the live poller runs this
// every 30 seconds and each pull is a billable CFBD call. Once the committee
// poll is in the doc it is final for that week and nothing is re-pulled.

const CFP_POLL = 'Playoff Committee Rankings';

// The committee's first release has landed in weeks 10-11 (2024-2026). 9 leaves
// margin for an earlier calendar; a few weeks of throttled pulls is the cost.
const FIRST_POSSIBLE_CFP_WEEK = 9;

// At most one re-pull per doc per window. Tuesday release to Saturday kickoff is
// ~4 days, so this costs ~8 calls per week until the ranking shows up.
const REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000;

// When the doc was last pulled: fetchedAt (written by every pull since this
// fix), else the creation time baked into its ObjectId (older docs).
function fetchedAtMs(doc) {
    if (doc.fetchedAt) {
        const t = Date.parse(doc.fetchedAt);
        if (Number.isFinite(t)) return t;
    }
    const id = doc._id && String(doc._id);
    if (id && /^[0-9a-f]{24}$/i.test(id)) return parseInt(id.slice(0, 8), 16) * 1000;
    return NaN;
}

function needsCfpRefresh(doc, week, now = Date.now()) {
    if (!doc || !Array.isArray(doc.polls)) return false;
    if (!(Number(week) >= FIRST_POSSIBLE_CFP_WEEK)) return false;
    if (doc.polls.some(p => p && p.poll === CFP_POLL)) return false;
    const fetched = fetchedAtMs(doc);
    if (!Number.isFinite(fetched)) return true;
    return now - fetched >= REFRESH_INTERVAL_MS;
}

module.exports = { needsCfpRefresh, CFP_POLL, FIRST_POSSIBLE_CFP_WEEK, REFRESH_INTERVAL_MS };
