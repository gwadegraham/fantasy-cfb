// Scheduled entry point for the "your weekly recap is ready" push.
//
// In modules/ rather than a root update-*-job.js file, for the same reason as
// modules/captain-reminder-job.js: it reads users directly and runs inside the
// web dyno via modules/scheduler.js.
//
// Monday morning, because that is when the recap becomes the NEW week's recap:
// public/weekly-recap.js draws its once-a-week popup boundary at Monday 07:00,
// and the weekend is scored well before then (sunday-scores runs 03:00 and
// 06:00 Central, daily-scores every night at 23:00). Sending at 07:05 means the
// notification and the popup are talking about the same week.
//
// It runs twice — morning and evening — and the second is normally a no-op,
// because notifyRecapReady dedupes on the recap's WEEK rather than on when it
// ran. That makes the evening pass a free retry for a week whose scoring was
// late, or a morning the dyno spent restarting, without any risk of a manager
// being told twice.

const { startRun, finishRun } = require('./job-logger');
const pushNotify = require('./push-notify');

const JOB_NAME = 'recap-notice';

// Logged only on a tick that did something, like the Captain reminder — the
// evening retry is silent by design and a JobRun for it would just be noise on
// the admin strip. A failure always logs.
async function run() {
    const startMs = Date.now();
    let result;

    try {
        result = await pushNotify.notifyRecapReady();
    } catch (err) {
        // notifyRecapReady catches its own errors, so reaching here means
        // something outside it broke.
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
    const summary = `${result.due} manager(s) told their recap is ready — ${result.sent} notification(s) delivered (${secs}s)`;
    console.log(`[${JOB_NAME}] ${summary}`);

    const id = await startRun(JOB_NAME);
    await finishRun(id, 'success', summary);

    return result;
}

module.exports = { run, JOB_NAME };
