// Pure helpers for the "your weekly recap is ready" push.
//
// The recap itself (modules/weekly-recap.js) already exists and is already
// surfaced two ways on My Team: an inline card and a once-a-week popup. Both
// require the manager to open the app first, which is the gap — the recap for a
// week most people care about lands on Monday morning and is read on Thursday,
// if at all.
//
// This notification is a POINTER, not a delivery. The body carries the headline
// numbers the manager would see on the tile anyway (week, points, rank) and
// stops there; the narrative, the MVP, the upset and the weather beats stay in
// the app where they are already built. A push that contained the recap would
// be a recap by email with extra steps.
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

// "2nd", "11th" — the recap payload carries rank as a bare number.
function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = Number(n) % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// The one-line hook. Rank, then movement, because "you moved up two spots" is
// the part a manager cannot get from the score alone.
function recapHook(recap) {
    const bits = [];
    if (recap.score != null) bits.push(`${recap.score} points`);
    if (recap.rank != null) bits.push(`${recap.rankTie ? 'T-' : ''}${ordinal(recap.rank)}`);
    const delta = Number(recap.rankDelta);
    if (Number.isFinite(delta) && delta !== 0) {
        bits.push(delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`);
    }
    return bits.join(' · ');
}

function buildRecapNoticePayload({ userId, recap }) {
    const label = recap.label || `Week ${recap.week}`;
    const hook = recapHook(recap);

    return {
        type: 'recapReady',
        title: `📖 ${label} recap is ready`,
        // Deliberately short. The tile and the popup tell the story; this says
        // there IS one and gives the two numbers worth knowing on a lock screen.
        body: hook ? `${hook}. Tap to read your week.` : 'Tap to read your week.',
        // Same path the Captain reminder learned the hard way: `/` is Standings,
        // and /userHome without `?user=` renders blank because the client reads
        // the query param to decide whose profile to draw.
        url: userId ? `/userHome?user=${userId}#recap` : '/userHome',
        // One tag per week, so a retry replaces rather than stacks.
        tag: `recap-w${recap.week}`,
        week: recap.week
    };
}

module.exports = { alreadyNoticed, latestRecap, recapHook, ordinal, buildRecapNoticePayload };
