#!/usr/bin/env node
//
// Split every User into an Account + a Franchise (#313).
//
//   npm run migrate:accounts               # dry run — reports, changes nothing
//   npm run migrate:accounts -- --apply    # do it
//   npm run migrate:accounts -- --verify   # diff the result against users
//   npm run migrate:accounts -- --rollback --apply
//
// Users are never modified or deleted, so a rollback is a clean return to the
// pre-migration state. See modules/account-migration.js for the _id rule that
// makes Auth0 logins keep working.
//
// Run it MIDWEEK — after Sunday scoring completes and before Saturday kickoff.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const migration = require('../modules/account-migration');
const Account = require('../models/account');
const Franchise = require('../models/franchise');

// Which database is this actually pointed at?
//
// Prod and dev SHARE A CLUSTER (see scripts/sync-prod-to-dev.sh), so a host is
// not an identity — the old banner printed a line that was byte-identical for
// both, after connecting, which is no kind of check at all. The database NAME is
// the only thing that differs, so that is what gets shown, up front, with the
// user visible too.
const ALLOWED_DEV_DBS = ['test', 'dev'];

function dbNameFrom(url) {
    // mongodb+srv://user:pass@host/dbname?opts
    const match = String(url).match(/^mongodb(?:\+srv)?:\/\/[^/]*\/([^?]+)/);
    const name = match ? decodeURIComponent(match[1]) : '';
    // A URI with no database in the path connects to one literally called
    // "test" — which is on the dev allowlist. Reporting null instead made the
    // banner say "NOT a known dev database" while the connection was in fact
    // going somewhere allowed, and left the confirm prompt unanswerable.
    return name || 'test';
}

function userFrom(url) {
    const match = String(url).match(/^mongodb(?:\+srv)?:\/\/([^:/@]+)(?::[^@]*)?@/);
    return match ? match[1] : '(no user)';
}

function banner(url) {
    const db = dbNameFrom(url);
    const host = String(url).replace(/^mongodb(\+srv)?:\/\/[^@]*@/, '').split('/')[0];
    const known = ALLOWED_DEV_DBS.includes(db);
    console.log('');
    console.log(`  database : ${db || '(none in the URI)'}${known ? '' : '   <-- NOT a known dev database'}`);
    console.log(`  cluster  : ${host}`);
    console.log(`  user     : ${userFrom(url)}`);
    console.log('');
    return { db, known };
}

// A writing run against a database that is not on the dev allowlist has to be
// typed out in full. The sibling sync script guards itself this way and it is
// the one that only READS.
function confirm(question) {
    return new Promise(resolve => {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
    });
}

const FLAGS = ['--apply', '--verify', '--rollback', '--yes', '-y', '--help', '-h'];

async function main() {
    const args = process.argv.slice(2);

    // Reject what we don't understand rather than ignoring it. A typo'd --apply
    // silently degrading to a dry run is the safe direction, but a typo'd
    // --rollback is not, and the sibling sync script already exits 2 on this.
    const unknown = args.filter(a => !FLAGS.includes(a));
    if (unknown.length) {
        console.error(`unknown argument(s): ${unknown.join(', ')}\nknown: ${FLAGS.join(' ')}`);
        process.exit(2);
    }
    if (args.includes('--help') || args.includes('-h')) {
        console.log('Usage: npm run migrate:accounts -- [--apply] [--verify] [--rollback] [--yes]');
        process.exit(0);
    }

    const apply = args.includes('--apply');
    const wantVerify = args.includes('--verify');
    const wantRollback = args.includes('--rollback');
    const assumeYes = args.includes('--yes') || args.includes('-y');

    if (wantVerify && wantRollback) {
        console.error('--verify and --rollback do different things; pick one.');
        process.exit(2);
    }
    if (wantVerify && apply) {
        console.error('--verify never writes; drop --apply.');
        process.exit(2);
    }

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }

    // Banner BEFORE connecting, so an operator sees the target while they can
    // still hit ctrl-C.
    const { db, known } = banner(process.env.DATABASE_URL);

    const writing = apply && !wantVerify;
    if (writing && !known && !assumeYes) {
        console.log(`"${db}" is not one of the known dev databases (${ALLOWED_DEV_DBS.join(', ')}).`);
        const answer = await confirm(`Type the database name to write to it: `);
        if (answer !== db) {
            console.error('\nnot confirmed — nothing was written.');
            process.exit(1);
        }
    }

    // autoIndex AND autoCreate off unless we are actually writing.
    //
    // autoIndex alone is not enough — autoCreate is a separate option, also on
    // by default, and it is the one that calls createCollection() on first use.
    //
    // "Dry run changes nothing" was not true: Mongoose creates a collection and
    // builds its indexes on first use, so merely connecting with these models
    // loaded left `accounts` and `franchises` behind — on whatever database you
    // were pointed at. And the confirmation prompt only guards --apply, so the
    // unguarded paths (plain dry run, --verify) were exactly the ones an
    // operator would aim at prod first.
    await mongoose.connect(process.env.DATABASE_URL, { autoIndex: writing, autoCreate: writing });
    if (writing) {
        // Build them deliberately, before relying on the unique
        // (accountId, league) index for idempotency.
        await Promise.all([Account.init(), Franchise.init()]);
    }

    try {
        if (wantRollback) {
            const r = await migration.rollback({ apply });
            console.log(apply
                ? `rolled back: deleted ${r.deleted.accounts} accounts, ${r.deleted.franchises} franchises`
                : `DRY RUN — would delete ${r.wouldDelete.accounts} accounts, ${r.wouldDelete.franchises} franchises`);
            if (r.touchedSinceMigration) {
                console.error(
                    `\n⚠️  ${r.touchedSinceMigration} of the deleted document(s) had been WRITTEN TO since the\n` +
                    `   migration created them. Those edits are gone and are NOT in the users\n` +
                    `   collection — users only has what it had before the cutover.`
                );
            } else {
                console.log('\nusers were never modified, and nothing had written to these documents since');
                console.log('the migration created them, so this is a full return to the pre-migration state.');
            }
            return;
        }

        if (wantVerify) {
            const v = await migration.verify();
            console.log(`users ${v.users} · accounts ${v.accountCount} · franchises ${v.franchiseCount}`);
            (v.warnings || []).forEach(w => console.log(`note: ${w}`));
            if (v.ok) {
                console.log('\n✅ verified: every account and franchise matches the user it came from.');
            } else {
                console.error(`\n❌ ${v.mismatches.length} mismatch(es):`);
                v.mismatches.slice(0, 40).forEach(m => console.error('   ', JSON.stringify(m)));
                if (v.mismatches.length > 40) console.error(`    … and ${v.mismatches.length - 40} more`);
                process.exitCode = 1;
            }
            return;
        }

        const result = await migration.migrate({ apply });

        console.log(`${result.userCount} user(s):\n`);
        result.steps.forEach(s => {
            console.log(`  ${s.name.padEnd(20)} ${String(s.league || '(no league)').padEnd(16)} ` +
                        `account:${s.accountAction.padEnd(7)} franchise:${s.franchiseAction.padEnd(7)} ` +
                        `seasons [${s.seasons.join(', ')}]`);
        });

        if (result.problems.length) {
            console.error(`\n⚠️  ${result.problems.length} problem(s):`);
            result.problems.forEach(p => console.error('   ', p));
        }

        if (apply) {
            console.log(`\napplied: ${result.accounts} account(s), ${result.franchises} franchise(s).`);
            const v = await migration.verify();

            // Verified TWICE, and the fingerprints compared. A single verify
            // takes its own snapshot of users, so a scoring write landing after
            // that snapshot leaves a franchise stale while verify compares
            // stale-against-stale and passes. Two verifies whose fingerprints
            // differ means someone scored while this ran — the run is not
            // necessarily wrong, but it is not proven either.
            const again = await migration.verify();
            if (v.usersFingerprint !== again.usersFingerprint) {
                console.error('\n⚠️  the users collection CHANGED while this ran — a scoring job is probably active.');
                console.error('   Re-run --apply once it is quiet; this result is not proof of anything.');
                process.exitCode = 1;
            }
            (again.warnings || []).forEach(w => console.log(`note: ${w}`));

            if (again.ok) {
                console.log('✅ verified against the users collection.');
            } else {
                console.error(`❌ verification found ${again.mismatches.length} mismatch(es) — see --verify.`);
                process.exitCode = 1;
            }
        } else {
            console.log('\nDRY RUN — nothing was written. Re-run with --apply.');
        }
    } finally {
        await mongoose.disconnect();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
