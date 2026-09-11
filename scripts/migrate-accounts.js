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

function banner(url) {
    // Say out loud which database this is about to touch. The dev tenant and
    // prod differ by a connection string and nothing else visible.
    const host = String(url).replace(/\/\/[^@]*@/, '//***@').split('/').slice(0, 3).join('/');
    console.log(`\ndatabase: ${host}\n`);
}

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const wantVerify = args.includes('--verify');
    const wantRollback = args.includes('--rollback');

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is not set.');
        process.exit(1);
    }
    await mongoose.connect(process.env.DATABASE_URL);
    banner(process.env.DATABASE_URL);

    try {
        if (wantRollback) {
            const r = await migration.rollback({ apply });
            console.log(apply
                ? `rolled back: deleted ${r.deleted.accounts} accounts, ${r.deleted.franchises} franchises`
                : `DRY RUN — would delete ${r.wouldDelete.accounts} accounts, ${r.wouldDelete.franchises} franchises`);
            console.log('\nusers were never modified, so this is a full return to the pre-migration state.');
            return;
        }

        if (wantVerify) {
            const v = await migration.verify();
            console.log(`users ${v.users} · accounts ${v.accountCount} · franchises ${v.franchiseCount}`);
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
            if (v.ok) {
                console.log('✅ verified against the users collection.');
            } else {
                console.error(`❌ verification found ${v.mismatches.length} mismatch(es) — see --verify.`);
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
