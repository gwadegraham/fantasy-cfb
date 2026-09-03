if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { internalFetch } = require('./modules/internal-api');
const { startRun, finishRun } = require('./modules/job-logger');
const { sendJobEmail, emailOnSuccess } = require('./modules/job-mailer');

const JOB_NAME = 'season-stats';

async function run() {
    const season = parseInt(process.env.YEAR, 10);
    const id = await startRun(JOB_NAME, { season: String(season) });
    try {
        const res = await internalFetch(`${process.env.URL}/team-season-stats/ingest/${season}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
        });
        const body = await res.json().catch(() => ({}));
        if (res.status !== 200) {
            throw new Error(`Ingest failed: ${body.message || res.status}`);
        }
        console.log(`[${JOB_NAME}] ${body.teams} teams ingested (${body.created} new, ${body.updated} updated)`);
        await finishRun(id, 'success', body);
        if (emailOnSuccess()) sendJobEmail(JOB_NAME, 'success', body);
    } catch (err) {
        console.error(`[${JOB_NAME}] failed:`, err.message);
        await finishRun(id, 'error', { message: err.message });
        sendJobEmail(JOB_NAME, 'error', { message: err.message });
    }
}

module.exports = { run, JOB_NAME };
