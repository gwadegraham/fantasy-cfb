#!/usr/bin/env node
//
// Run the basketball style-tags job once, now (#542).
//
//   npm run hoops:styles
//   heroku run npm run hoops:styles      <- the one-time prod fill
//
// The scheduler runs it every morning at 07:00 Central; this is for the first
// fill after a deploy, or a re-run after a failure email. At most 2 billable
// CBBD calls (usually 1). Writes the hoopsteamstyles collection and a JobRun,
// nothing else.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const seasons = require('../modules/active-season');
const job = require('../modules/hoops-styles-job');

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
