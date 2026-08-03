const schedule = require('node-schedule');

// All schedules are Central time. node-schedule honors the tz (DST-aware),
// unlike a UTC-only cron. Specs are data so tests can assert them.
const TZ = 'America/Chicago';

const JOB_SCHEDULES = [
    { job: 'daily-scores', modulePath: '../update-daily-scores-job', rule: { hour: 23, minute: 0 } },
    { job: 'saturday-scores', modulePath: '../update-saturday-scores-job', rule: { dayOfWeek: 6, hour: [15, 18, 22], minute: 0 } },
    { job: 'sunday-scores', modulePath: '../update-sunday-scores-job', rule: { dayOfWeek: 0, hour: [3, 6], minute: 0 } },
    // Weekly enrichment (SP+/FPI ratings + broadcast outlets). Tuesday morning,
    // after the weekend's ratings have refreshed. ~3 CFBD calls. Season-fixed
    // fields (talent/returning/coaches) are pulled preseason instead — run
    // `node update-enrichment-job.js <year> preseason` before the season/draft.
    { job: 'enrichment', modulePath: '../update-enrichment-job', rule: { dayOfWeek: 2, hour: 5, minute: 30 } }
];

// Opt-in game-day live poller (modules/live-poll.js). Fires every 10 min, every
// day; the module's own phase-aware gates decide whether to actually spend a
// CFBD call (a regular game live on Thu/Fri/Sat, or a postseason game live any
// day — bowls/CFP run Mon–Sat — plus under the call ceiling). Firing daily is
// cheap: the games-live gate is a local DB check, so non-game times cost nothing.
// Kept OUT of the always-on JOB_SCHEDULES and gated behind LIVE_POLL_ENABLED=true
// so it can be switched on/off independently of the core scoring jobs.
const LIVE_POLL_SCHEDULE = {
    job: 'live-scores', modulePath: '../modules/live-poll',
    rule: { minute: [0, 10, 20, 30, 40, 50] }
};

function livePollEnabled() { return process.env.LIVE_POLL_ENABLED === 'true'; }

function toRule(spec) {
    const r = new schedule.RecurrenceRule();
    if (spec.dayOfWeek != null) r.dayOfWeek = spec.dayOfWeek;
    // Leave hour unset for jobs that run every hour (e.g. the live poller); an
    // unset field means "any" in node-schedule.
    if (spec.hour != null) r.hour = spec.hour;
    if (spec.minute != null) r.minute = spec.minute;
    r.tz = TZ;
    return r;
}

// Registers the recurring jobs. Each job's own run() already logs and emails;
// we just guard against an unhandled rejection here. The live poller is included
// only when LIVE_POLL_ENABLED=true.
function start() {
    const schedules = JOB_SCHEDULES.slice();
    if (livePollEnabled()) schedules.push(LIVE_POLL_SCHEDULE);

    schedules.forEach(function (s) {
        const mod = require(s.modulePath);
        schedule.scheduleJob(toRule(s.rule), function () {
            Promise.resolve().then(function () { return mod.run(); })
                .catch(function (err) { console.error(`Scheduled ${s.job} failed:`, err); });
        });
        console.log(`Scheduled ${s.job}:`, JSON.stringify(s.rule), TZ);
    });
}

module.exports = { start, JOB_SCHEDULES, LIVE_POLL_SCHEDULE, livePollEnabled, TZ, toRule };
