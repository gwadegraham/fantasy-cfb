if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const { makeJob } = require('./modules/score-job');

// Saturday game-day refresh. Includes a betting-line update so spreads and
// totals are fresh before kickoffs. Timing is owned by the in-process
// scheduler; running this file directly still works as a fallback.
const JOB_NAME = 'saturday-scores';
const run = makeJob({ jobName: JOB_NAME, label: 'Saturday Update', withBetting: true });

module.exports = { run, JOB_NAME };
if (require.main === module) { run(); }
