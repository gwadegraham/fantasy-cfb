if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { makeJob } = require('./modules/score-job');

// Sunday morning refresh to catch late Saturday games (no betting-line update).
// Timing is owned by the in-process scheduler; direct runs still work.
const JOB_NAME = 'sunday-scores';
const run = makeJob({ jobName: JOB_NAME, label: 'Sunday Update', withBetting: false });

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
