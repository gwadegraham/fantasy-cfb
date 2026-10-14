#!/usr/bin/env node
//
// Run the basketball roster-turnover job once, now (#541).
//
//   npm run hoops:turnover
//   heroku run npm run hoops:turnover      <- the one-time prod fill
//
// The scheduler runs it every morning at 07:10 Central; this is for the first
// fill after a deploy, or a re-run after a failure email. At most 2 billable
// CBBD calls, and 0 if the stored copy is under a week old (or was fetched
// after tip-off). Writes the hoopsteamturnover collection and a JobRun,
// nothing else.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const seasons = require('../modules/active-season');
const job = require('../modules/hoops-turnover-job');

async function main() {
    await mongoose.connect(process.env.DATABASE_URL);
    // basketballLeagues() reads each league's sport and season from the
    // cache; unprimed, it answers 'football' for every league and the job
    // finds nothing to do.
    await seasons.prime();
    const out = await job.run();
    console.log(out.summary || out.skippedReason);
    return out.status === 'error' ? 1 : 0;
}

main()
    .then(code => mongoose.disconnect().then(() => process.exit(code)))
    .catch(err => {
        console.error(err);
        mongoose.disconnect().finally(() => process.exit(1));
    });
