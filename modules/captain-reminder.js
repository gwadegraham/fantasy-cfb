// Pure helpers for the Captain lock reminder: a push alert some chosen distance
// (2 hours by default) before a manager's weekly Captain pick stops being
// editable.
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

// How far ahead of the lock the reminder goes out, when a manager hasn't chosen
// otherwise.
const DEFAULT_LEAD_MINUTES = 120;
const LEAD_MS = DEFAULT_LEAD_MINUTES * 60 * 1000;

// The leads a manager can pick, in minutes. An allowlist rather than a free
// number for two reasons. A huge lead is not a longer warning, it is a wrong
// one: the reminder can only fire once the week is in focus (see
// captainFocusWeek), so anything past a couple of days would silently behave as
// "as soon as the week opens" while claiming a precise countdown. And a lead
// SHORTER than the sweep interval could fall between two ticks and never fire
// at all — 30 minutes is the floor because modules/scheduler.js sweeps every 30
// minutes, and a half-open window exactly one interval wide always contains
// exactly one tick.
const LEAD_CHOICES = [
    { minutes: 30, label: '30 minutes' },
    { minutes: 60, label: '1 hour' },
    { minutes: 120, label: '2 hours' },
    { minutes: 180, label: '3 hours' },
    { minutes: 360, label: '6 hours' },
    { minutes: 720, label: '12 hours' },
    { minutes: 1440, label: '1 day' }
];

const LEAD_MINUTES = LEAD_CHOICES.map(c => c.minutes);

function isLeadChoice(minutes) {
    return LEAD_MINUTES.indexOf(Number(minutes)) !== -1;
}

// This manager's lead, in ms. Anything unset, unrecognised or left over from an
// older shape falls back to the default rather than throwing or disabling the
// alert — a bad stored value must not be the reason someone stops being warned.
function leadMsFor(prefs) {
    const chosen = prefs && prefs.captainLockLeadMinutes;
    return (isLeadChoice(chosen) ? Number(chosen) : DEFAULT_LEAD_MINUTES) * 60 * 1000;
}

// Is this manager inside the reminder window for a lock at `lockMs`?
//
// The whole run-up counts, not a narrow band around lockMs - LEAD_MS. The job
// fires on a fixed cadence, so a band would have to be at least as wide as the
// gap between runs, and a missed run (deploy, dyno restart, a slow tick) would
// drop the reminder entirely with nothing to show for it. An open window plus
// the once-per-week dedupe means a late run still delivers — later than two
// hours out, but delivered, which is the point of the alert.
//
// The window matters more the shorter the lead: at the 30-minute floor exactly
// one sweep lands inside it, so a band narrower than the window would have to be
// re-tuned every time a manager picks a different lead.
//
// That is also why the message quotes the real remaining time rather than the
// manager's setting: a reminder sent 40 minutes out must not claim 2 hours.
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
function buildCaptainReminderPayload({ userId, week, lockMs, nowMs, currentPick, autoPick }) {
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
        // the drawer on this hash once the tile has its data. Landing somewhere
        // else and hunting for the tile is a worse answer to a notification that
        // exists to say "you have two hours".
        //
        // The whole path matters and every part of it was wrong once. `/` is
        // STANDINGS, not the profile. The Captain tile is on /userHome. And
        // /userHome without `?user=` renders an empty page — the server hands
        // the template the session user either way, but public/userHome.js reads
        // the query param to decide whose profile to draw, so the id has to be
        // on the URL even though it is always the recipient's own.
        url: userId ? `/userHome?user=${userId}#captain` : '/userHome#captain',
        // One tag per (week): a second send for the same week REPLACES the first
        // on the lock screen instead of stacking. The dedupe log should make that
        // impossible, but a tag costs nothing and a duplicated nag is the most
        // annoying way for this feature to fail.
        tag: `captain-lock-w${week}`,
        week,
        teamId: pick ? pick.id : null
    };
}

module.exports = {
    LEAD_MS, DEFAULT_LEAD_MINUTES, LEAD_CHOICES, LEAD_MINUTES,
    isLeadChoice, leadMsFor,
    isDue, alreadySent, timeLeftLabel, buildCaptainReminderPayload
};
