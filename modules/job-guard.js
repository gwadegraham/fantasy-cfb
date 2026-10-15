// The outer net under a scheduled job's run() (#574).
//
// The hoops jobs mail, and finish their JobRun, for a failure INSIDE their
// per-season loop. Anything thrown before it — the league lookup, a schedule
// query, startRun itself — used to reach only the scheduler's console line:
// no email, no JobRun, and /hoops/admin showing a stale last run as if
// nothing had happened. That is the shape that froze football scoring for
// two days (#430).
//
// Mirrors modules/score-job.js's catch: finish the run as an error, mail,
// rethrow so the scheduler still logs it. The hoops jobs start their run
// only AFTER the loop (a silent skip writes no row), so an early failure
// has none yet — the guard starts one, or the admin strip keeps showing
// the last green run. A job records its id on `run` once it has one, so a
// failure after that finishes the same row instead of opening a second.
//
// Namespaces, not destructures, so a spec's spy on either module reaches
// these calls.
const jobLogger = require('./job-logger');
const jobMailer = require('./job-mailer');

async function guardJob({ jobName, label, now }, body) {
    const run = { id: null };
    const startMs = Date.now();
    try {
        return await body(run);
    } catch (err) {
        const secs = Math.round((Date.now() - startMs) / 1000);
        const msg = (err && err.message) ? err.message : String(err);
        console.error(`❌ ${label} failed:`, err);
        // Both swallow their own errors, so neither can mask the original
        // one; finishRun skips a null id (the job-runs API was down too).
        const id = run.id || await jobLogger.startRun(jobName);
        await jobLogger.finishRun(id, 'error', msg);
        await jobMailer.sendJobEmail({
            label, when: now.toLocaleString('en-US', { timeZone: 'America/Chicago' }), ok: false,
            rows: [['Failed after', `${secs}s`]],
            error: (err && err.stack) ? err.stack : msg
        });
        throw err;
    }
}

module.exports = { guardJob };
