#!/usr/bin/env node
//
// Roll a sport over to a new season, or set where it is in its year.
//
//   npm run season:set -- football 2027
//   npm run season:set -- football 2027 preseason
//   npm run season:set -- football --status in-season
//
// This is the pivot in docs/season-flip-runbook.md. It used to be a `YEAR`
// config var plus a restart; since #312 the season lives in Mongo, and the boot
// seed deliberately never overwrites a stored season — so this (or the
// admin-only PUT /seasons/:sport) is the only thing that moves it.
//
// Writes straight to the database, so it needs DATABASE_URL and nothing else.
// Every running dyno picks the change up within its refresh interval
// (modules/active-season.js startRefresh) without a restart.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const SportSeason = require('../models/sportSeason');
const AuditLog = require('../models/auditLog');

const SPORTS = ['football', 'basketball'];
const STATUSES = ['preseason', 'in-season', 'complete'];

function usage(msg) {
    if (msg) console.error(`\n${msg}`);
    console.error(`
Usage: npm run season:set -- <sport> [season] [status] [--force]

  sport    ${SPORTS.join(' | ')}
  season   a year, e.g. 2027 (omit to change only the status)
  status   ${STATUSES.join(' | ')}
  --force  allow moving a season BACKWARDS (scoring would overwrite a
           finished season, so it is refused without this)

Examples:
  npm run season:set -- football 2027
  npm run season:set -- football 2027 preseason
  npm run season:set -- football --status complete
`);
    process.exit(msg ? 1 : 0);
}

async function main() {
    const args = process.argv.slice(2);
    if (!args.length || args.includes('--help') || args.includes('-h')) usage();

    const force = args.includes('--force');
    const rest = args.filter(a => a !== '--force');

    const sport = rest[0];
    if (!SPORTS.includes(sport)) usage(`Unknown sport "${sport}".`);

    // Accept either positional values or --status.
    let season = null;
    let status = null;
    for (let i = 1; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--status') {
            // A dangling --status used to read undefined and then skip the
            // validation below (undefined is falsy), so the run "succeeded"
            // having quietly ignored the thing you asked for.
            if (i + 1 >= rest.length) usage('--status needs a value.');
            if (status != null) usage('--status given more than once.');
            status = rest[++i];
            continue;
        }
        if (/^\d{4}$/.test(a)) {
            // Two years, last-wins, was silent. Refuse instead.
            if (season != null) usage(`Two seasons given ("${season}" and "${a}") — pick one.`);
            season = Number(a);
            continue;
        }
        if (STATUSES.includes(a)) {
            if (status != null) usage(`Two statuses given ("${status}" and "${a}") — pick one.`);
            status = a;
            continue;
        }
        usage(`Don't know what to do with "${a}".`);
    }
    if (status != null && !STATUSES.includes(status)) usage(`status must be one of ${STATUSES.join(', ')}.`);
    // Same range the route enforces (routes/seasons.js) — two write paths must
    // not have two validation contracts.
    if (season != null && (season < 2000 || season > 2100)) usage(`season must be between 2000 and 2100, got ${season}.`);
    if (season == null && status == null) usage('Nothing to change: give a season and/or a status.');

    if (!process.env.DATABASE_URL) usage('DATABASE_URL is not set.');
    await mongoose.connect(process.env.DATABASE_URL);

    try {
        const before = await SportSeason.findOne({ sport }).lean();
        console.log(before
            ? `before: ${sport} season ${before.season} (${before.status})`
            : `before: ${sport} has no stored season`);

        if (season != null && before && season < Number(before.season) && !force) {
            console.error(
                `\nRefusing to move ${sport} back from ${before.season} to ${season}.\n` +
                `The nightly scoring job would start overwriting a completed season.\n` +
                `Re-run with --force if that is genuinely what you want.\n`
            );
            process.exitCode = 1;
            return;
        }

        // A status-only change needs a season already stored. updateOne skips
        // schema validation, so without this an upsert would insert a row with
        // NO season field at all — which the cache then reads back as NaN.
        if (season == null && !before) {
            console.error(
                `\n${sport} has no stored season yet, so there is nothing to set a status on.\n` +
                `Give it a season first:  npm run season:set -- ${sport} <year> ${status}\n`
            );
            process.exitCode = 1;
            return;
        }

        const update = {};
        if (season != null) update.season = season;
        if (status != null) update.status = status;
        await SportSeason.updateOne(
            { sport },
            { $set: update, $setOnInsert: { sport } },
            { upsert: true }
        );

        const after = await SportSeason.findOne({ sport }).lean();
        console.log(`after:  ${sport} season ${after.season} (${after.status})`);

        // The route records an audit entry; this path did not — and this is the
        // path the runbook tells you to use, so the most consequential switch in
        // the app had a trail only where nobody goes. Written directly rather
        // than through modules/audit-log, which needs a request to name an actor.
        try {
            await AuditLog.create({
                action: 'season.set',
                season: String(after.season),
                actorName: `cli (${process.env.USER || 'unknown'})`,
                actorRole: 'cli',
                summary: `${sport} season set to ${after.season} (${after.status}) via npm run season:set`,
                meta: {
                    sport,
                    from: before ? { season: before.season, status: before.status } : null,
                    to: { season: after.season, status: after.status },
                    forced: !!force
                }
            });
        } catch (err) {
            console.error(`(audit entry not written: ${err.message})`);
        }
        console.log('\nRunning dynos pick this up within a minute — no restart needed.');
        if (process.env.YEAR && season != null && Number(process.env.YEAR) !== season) {
            console.log(
                `\nNote: the YEAR config var still says ${process.env.YEAR}. It no longer\n` +
                `drives anything, but boot logs an error while the two disagree — clear it\n` +
                `or set it to ${season} to keep the logs quiet.`
            );
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
