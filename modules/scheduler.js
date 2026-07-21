const schedule = require('node-schedule');

// All schedules are Central time. node-schedule honors the tz (DST-aware),
// unlike a UTC-only cron. Specs are data so tests can assert them.
const TZ = 'America/Chicago';

const JOB_SCHEDULES = [
    { job: 'daily-scores', modulePath: '../update-daily-scores-job', rule: { hour: 23, minute: 0 } },
    { job: 'saturday-scores', modulePath: '../update-saturday-scores-job', rule: { dayOfWeek: 6, hour: [15, 18, 22], minute: 0 } },
    { job: 'sunday-scores', modulePath: '../update-sunday-scores-job', rule: { dayOfWeek: 0, hour: [3, 6], minute: 0 } },
    // Weekly enrichment (SP+/FPI/talent/returning/coaches + broadcast outlets).
    // Tuesday morning, after the weekend's ratings have refreshed. ~6 CFBD calls.
    { job: 'enrichment', modulePath: '../update-enrichment-job', rule: { dayOfWeek: 2, hour: 5, minute: 30 } }
];

function toRule(spec) {
    const r = new schedule.RecurrenceRule();
    if (spec.dayOfWeek != null) r.dayOfWeek = spec.dayOfWeek;
    r.hour = spec.hour;
    r.minute = spec.minute;
    r.tz = TZ;
    return r;
}

// Registers the recurring jobs. Each job's own run() already logs and emails;
// we just guard against an unhandled rejection here.
function start() {
    JOB_SCHEDULES.forEach(function (s) {
        const mod = require(s.modulePath);
        schedule.scheduleJob(toRule(s.rule), function () {
            Promise.resolve().then(function () { return mod.run(); })
                .catch(function (err) { console.error(`Scheduled ${s.job} failed:`, err); });
        });
        console.log(`Scheduled ${s.job}:`, JSON.stringify(s.rule), TZ);
    });
}

module.exports = { start, JOB_SCHEDULES, TZ, toRule };
