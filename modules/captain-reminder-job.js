// Scheduled entry point for the Captain lock reminder.
//
// In modules/ rather than a root update-*-job.js file, and for the same reason
// modules/live-poll.js is: those root jobs drive the API over HTTP because a
// standalone `node update-x-job.js` process has no Mongo connection, and this
// one reads users and games directly. It runs inside the web dyno via
// modules/scheduler.js.
//
// Cadence is every 30 minutes. The lead is six HOURS, so half-hour granularity
// is well inside the precision the alert claims, and the reminder window in
// modules/captain-reminder.js stays open for the whole run-up — so a tick lost
// to a deploy or a restart is picked up by the next one rather than dropping the
// reminder.

const { startRun, finishRun } = require('./job-logger');
const pushNotify = require('./push-notify');

const JOB_NAME = 'captain-reminder';

// A JobRun is written only when the tick actually did something, the same way
// modules/live-poll.js skips logging a no-op poll. Every 30 minutes around the
// clock is 48 ticks a day and at most a handful contain a reminder; logging all
// of them would push every other job's latest run off the admin strip, which is
// exactly the failure the /job-runs grouping was just fixed for — and it would
// bury a real failure in a column of nothing-happened rows.
//
// A FAILURE always logs, whether or not anything was due.
async function run() {
    const startMs = Date.now();
    let result;

    try {
        result = await pushNotify.notifyCaptainLocks();
    } catch (err) {
        // notifyCaptainLocks catches its own errors, so reaching here means
        // something outside it broke (a bad require, a connection drop).
        const msg = (err && err.message) ? err.message : String(err);
        const id = await startRun(JOB_NAME);
        await finishRun(id, 'error', msg);
        console.error(`[${JOB_NAME}] failed:`, msg);
        throw err;
    }

    if (!result || !result.due) {
        return { skipped: (result && result.skipped) || 'nobody due' };
    }

    const secs = Math.round((Date.now() - startMs) / 1000);
    const summary = `${result.due} manager(s) reminded — ${result.sent} notification(s) delivered (${secs}s)`;
    console.log(`[${JOB_NAME}] ${summary}`);

    // Logged after the fact rather than around the work: the run is short, and
    // recording it only once it has something to say is the whole point above.
    const id = await startRun(JOB_NAME);
    await finishRun(id, 'success', summary);

    return result;
}

module.exports = { run, JOB_NAME };
