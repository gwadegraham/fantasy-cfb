// Pure helpers for the Captain lock reminder: a push alert ~2 hours before a
// manager's weekly Captain pick stops being editable.
//
// The lock is PER MANAGER, not league-wide — modules/captain.js locks a week at
// the manager's own earliest kickoff among their rostered teams. So there is no
// single "captain deadline" to schedule against: six managers in one league have
// six different lock instants, and a manager on a Thursday-night team locks two
// days before one whose earliest game is Saturday night.
//
// DB-free so the decision (who is due, what it says) is unit-testable without a
// push service or a Mongo connection; modules/push-notify.js does the fan-out
// and modules/captain-reminder-job.js is the cron entry point.

// How far ahead of the lock the reminder goes out.
const LEAD_MS = 2 * 60 * 60 * 1000;

// Is this manager inside the reminder window for a lock at `lockMs`?
//
// The whole run-up counts, not a narrow band around lockMs - LEAD_MS. The job
// fires on a fixed cadence, so a band would have to be at least as wide as the
// gap between runs, and a missed run (deploy, dyno restart, a slow tick) would
// drop the reminder entirely with nothing to show for it. An open window plus
// the once-per-week dedupe means a late run still delivers — later than two
// hours out, but delivered, which is the point of the alert.
//
// The window matters more at a two-hour lead than it did at six: there are only
// four half-hourly ticks inside it, so a band one tick wide would have three
// chances in a week to drop the alert entirely.
//
// That is also why the message quotes the real remaining time rather than the
// constant: a reminder sent 40 minutes out must not claim 2 hours.
function isDue(lockMs, nowMs, leadMs) {
    if (lockMs == null || !Number.isFinite(lockMs)) return false;
    const lead = leadMs == null ? LEAD_MS : leadMs;
    return nowMs >= lockMs - lead && nowMs < lockMs;
}

// Has this manager already been reminded about (season, week)?
// `sent` is the user's stored reminder log: [{ season, week }].
function alreadySent(sent, season, week) {
    return (sent || []).some(r =>
        r && Number(r.season) === Number(season) && Number(r.week) === Number(week));
}

// "2 hours", "1.5 hours", "40 minutes" — how long until the pick locks,
// rounded the way a person would say it. Never claims more time than is left:
// everything rounds DOWN to the nearest half hour, because a manager told "2
// hours" who has 1h50m left is being told something that costs them the pick.
function timeLeftLabel(lockMs, nowMs) {
    const ms = lockMs - nowMs;
    if (ms <= 0) return 'now';
    const mins = Math.floor(ms / 60000);
    if (mins < 60) {
        const m = Math.max(1, Math.floor(mins / 5) * 5);
        return m === 1 ? '1 minute' : `${m} minutes`;
    }
    const halves = Math.floor(mins / 30) / 2;          // hours, floored to :30
    if (halves === 1) return '1 hour';
    if (Number.isInteger(halves)) return `${halves} hours`;
    return `${Math.floor(halves)}.5 hours`;
}

// The notification a due manager gets.
//
// `currentPick` is the team they have chosen, or null when they haven't — in
// which case `autoPick` is the team modules/captain.js would apply for them.
// Both are { id, school } or null.
//
// The body always names a team, because the alert has to answer "do I need to
// do anything?" on a lock screen. "No pick yet" alone would send everyone into
// the app to find out what the default was; "we'll use Georgia" lets the
// manager who is happy with that ignore it.
function buildCaptainReminderPayload({ week, lockMs, nowMs, currentPick, autoPick }) {
    const left = timeLeftLabel(lockMs, nowMs);
    const pick = currentPick || autoPick || null;
    const body = currentPick
        ? `${currentPick.school} is your Captain for week ${week}. Change it within ${left}.`
        : (autoPick
            ? `No pick yet for week ${week} — ${autoPick.school} goes in by default. ${left} to change it.`
            : `You haven't set one for week ${week}. ${left} left.`);

    return {
        type: 'captainLock',
        title: '🧢 Captain locks soon',
        body,
        // Deep link straight into the Captain picker — public/userHome.js opens
        // the drawer on this hash once the tile has its data. Landing on the
        // home page and hunting for the tile is a worse answer to a notification
        // that exists to say "you have two hours".
        url: '/#captain',
        // One tag per (week): a second send for the same week REPLACES the first
        // on the lock screen instead of stacking. The dedupe log should make that
        // impossible, but a tag costs nothing and a duplicated nag is the most
        // annoying way for this feature to fail.
        tag: `captain-lock-w${week}`,
        week,
        teamId: pick ? pick.id : null
    };
}

module.exports = { LEAD_MS, isDue, alreadySent, timeLeftLabel, buildCaptainReminderPayload };
