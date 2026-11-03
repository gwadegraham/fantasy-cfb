#!/usr/bin/env node
//
// Store past NCAA tournaments for the March Madness bracket page.
//
//   npm run hoops:ncaa-backfill                    <- the last 3 seasons
//   npm run hoops:ncaa-backfill -- 2024 2026       <- named seasons
//   npm run hoops:ncaa-backfill -- --dry-run       <- fetch and check, write nothing
//   npm run hoops:ncaa-backfill -- --force         <- refetch a season already stored
//   heroku run -a fantasy-cfb npm run hoops:ncaa-backfill    <- the prod fill
//
// One billable CBBD call per season fetched, and none for a season already
// stored in full (so a re-run is free). Writes hoopsgames rows only.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const seasons = require('../modules/active-season');
const backfill = require('../modules/hoops-ncaa-backfill');

const DEFAULT_SEASONS = 3;

async function main() {
    const args = process.argv.slice(2);
    const opts = { dryRun: args.includes('--dry-run'), force: args.includes('--force') };
    const named = args.filter(a => !a.startsWith('--')).map(Number);

    await mongoose.connect(process.env.DATABASE_URL);
    await seasons.prime();
    const list = named.length ? named : backfill.lastSeasons(DEFAULT_SEASONS);
    const results = await backfill.backfill(list, opts);
    results.forEach(r => console.log(r.status === 'stored'
        ? `${r.season}: already stored (${r.stored} games), no call made`
        : `${r.season}: ${r.status}, ${r.fetched} games fetched, ${r.written} written (CBBD calls left: ${r.remainingCalls ?? '?'})`));
    return 0;
}

main()
    .then(code => mongoose.disconnect().then(() => process.exit(code)))
    .catch(err => {
        console.error(err.message || err);
        mongoose.disconnect().finally(() => process.exit(1));
    });
