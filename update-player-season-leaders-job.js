if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { internalFetch } = require('./modules/internal-api');
const { startRun, finishRun } = require('./modules/job-logger');
const { sendJobEmail, emailOnSuccess } = require('./modules/job-mailer');

const JOB_NAME = 'player-season-leaders';
const LABEL = 'Player Season Leaders';

// `message` on a JobRun is a String, and sendJobEmail takes a single options
// object. Both used to be handed the raw response body — which made the PATCH
// that finishes the run fail its cast (leaving every run stuck at 'running'
// forever) and every email render as "undefined FAILED" even on success.
// Neither failure was visible from inside the job: job-logger swallows a bad
// response and the mailer never throws.
async function run() {
    const startMs = Date.now();
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    const season = parseInt(process.env.YEAR, 10);
    const id = await startRun(JOB_NAME, { season: String(season) });
    try {
        const res = await internalFetch(`${process.env.URL}/player-season-leaders/ingest/${season}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const body = await res.json().catch(() => ({}));
        if (res.status !== 200) {
            throw new Error(`Ingest failed: ${body.message || res.status}`);
        }
        const secs = Math.round((Date.now() - startMs) / 1000);
        const summary = `${body.teams} teams ingested `
            + `(${body.created} new, ${body.updated} updated) (${secs}s)`;
        console.log(`[${JOB_NAME}] ${summary}`);
        await finishRun(id, 'success', summary);

        if (emailOnSuccess()) {
            await sendJobEmail({
                label: LABEL, when, ok: true,
                rows: [
                    ['Season', String(season)],
                    ['Teams ingested', String(body.teams)],
                    ['New', String(body.created)],
                    ['Updated', String(body.updated)],
                    ['Duration', `${secs}s`]
                ]
            });
        }
        return body;
    } catch (err) {
        const secs = Math.round((Date.now() - startMs) / 1000);
        const msg = (err && err.message) ? err.message : String(err);
        console.error(`[${JOB_NAME}] failed:`, msg);
        await finishRun(id, 'error', msg);
        await sendJobEmail({
            label: LABEL, when, ok: false,
            rows: [['Season', String(season)], ['Failed after', `${secs}s`]],
            error: (err && err.stack) ? err.stack : msg
        });
        // Rethrow so the scheduler's catch sees a failed run. Swallowing it here
        // made a broken ingest indistinguishable from a healthy one.
        throw err;
    }
}

module.exports = { run, JOB_NAME, LABEL };
