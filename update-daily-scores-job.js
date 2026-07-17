if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { makeJob } = require('./modules/score-job');

// Daily full update (also refreshes betting lines). Timing is owned by the
// in-process scheduler (modules/scheduler.js); running this file directly still
// works as a manual fallback.
const JOB_NAME = 'daily-scores';
const run = makeJob({ jobName: JOB_NAME, label: 'Daily Update', withBetting: true });

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
