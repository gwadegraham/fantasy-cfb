if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { runFullUpdate } = require('./modules/score-update');
const { startRun, finishRun } = require('./modules/job-logger');
const { sendJobEmail } = require('./modules/job-mailer');

const JOB_NAME = 'saturday-scores';
const LABEL = 'Saturday Update';

// Saturday game-day refresh (no betting-line update). Timing is owned by the
// in-process scheduler; running this file directly still works as a fallback.
async function run() {
    const when = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
    console.log(`${LABEL} starting`, when);
    const id = await startRun(JOB_NAME, { season: process.env.YEAR });
    try {
        const { week, seasonType } = await runFullUpdate({ withBetting: false });
        await finishRun(id, 'success', `Updated ${seasonType} week ${week}`, { week, seasonType });
        await sendJobEmail({ label: LABEL, when, ok: true, detail: `Updated ${seasonType} week ${week}.` });
        return { week, seasonType };
    } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        console.error(`❌ ${LABEL} failed:`, err);
        await finishRun(id, 'error', msg);
        await sendJobEmail({ label: LABEL, when, ok: false, detail: (err && err.stack) ? err.stack : msg });
        throw err;
    }
}

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
