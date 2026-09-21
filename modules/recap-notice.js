// Pure helpers for the "your weekly recap is ready" push.
//
// The recap itself (modules/weekly-recap.js) already exists and is already
// surfaced two ways on My Team: an inline card and a once-a-week popup. Both
// require the manager to open the app first, which is the gap — the recap for a
// week most people care about lands on Monday morning and is read on Thursday,
// if at all.
//
// This notification is a POINTER, not a delivery, and it carries NO recap
// content at all — not the narrative, not the MVP, not the score, not the rank.
// It says the recap exists and that tapping opens it. The first cut put points
// and rank in the body as a "hook"; that is still the recap, just abridged, and
// a manager who reads it on the lock screen has been given the week's result
// without ever opening the app the recap was built for.
//
// The week number stays, in the title. It names WHICH recap is ready rather
// than telling you anything that is in it, and without it two Mondays'
// notifications are indistinguishable.
//
// DB-free so the decision and the copy are testable without a push service;
// modules/push-notify.js does the fan-out and modules/recap-notice-job.js is the
// cron entry point.

// Has this manager already been told about (season, week)?
//
// Keyed on the RECAP'S WEEK rather than on the calendar week it was sent in, so
// a run that happens late — or a retry hours after the first — cannot produce a
// second notification for the same recap. Same shape as the Captain reminder
// log; deliberately a separate array on the user rather than a shared one, so
// that adding this could not re-notify or drop a captain row that is already in
// production.
function alreadyNoticed(log, season, week) {
    return (log || []).some(r =>
        r && Number(r.season) === Number(season) && Number(r.week) === Number(week));
}

// The newest recap in a /standings/recap response, or null when the season
// hasn't produced one yet.
//
// buildWeeklyRecaps returns weeks in ascending order and only counts weeks the
// league has actually played, so "the last entry" IS "the newest thing to tell
// them about" — and an empty list is the preseason answering honestly rather
// than a failure. Picked by the highest effWeek rather than by position so a
// future change to that ordering cannot silently start announcing week 3.
function latestRecap(payload) {
    const recaps = (payload && payload.recaps) || [];
    if (!recaps.length) return null;
    return recaps.reduce((best, r) =>
        (!best || Number(r.effWeek || r.week) > Number(best.effWeek || best.week)) ? r : best, null);
}

function buildRecapNoticePayload({ userId, recap }) {
    const label = recap.label || `Week ${recap.week}`;

    return {
        type: 'recapReady',
        title: `📖 ${label} recap is ready`,
        // Fixed copy, on purpose. Nothing here is derived from the recap, so
        // there is no way for a number to leak into it as the payload changes.
        body: 'See how your week went — tap to read it.',
        // Same path the Captain reminder learned the hard way: `/` is Standings,
        // and /userHome without `?user=` renders blank because the client reads
        // the query param to decide whose profile to draw.
        url: userId ? `/userHome?user=${userId}#recap` : '/userHome',
        // One tag per week, so a retry replaces rather than stacks.
        tag: `recap-w${recap.week}`,
        week: recap.week
    };
}

module.exports = { alreadyNoticed, latestRecap, buildRecapNoticePayload };
