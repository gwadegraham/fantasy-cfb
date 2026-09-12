// Split every User into an Account + a Franchise (#313).
//
// The riskiest change in the Hardwood epic, run against a live season. So:
//
//   - DRY RUN by default. It reports exactly what it would write and changes
//     nothing unless you pass { apply: true }.
//   - IDEMPOTENT. Re-running upserts by (accountId, league) rather than
//     duplicating a roster, so a half-finished run is safe to repeat.
//   - SELF-VERIFYING. `verify()` diffs every migrated season against the User
//     it came from, field by field, and is the thing that actually decides
//     whether the run succeeded — not the absence of an error.
//   - NON-DESTRUCTIVE. Nothing deletes or edits a User. The users collection is
//     left exactly as it was, which is what makes this reversible: to roll back,
//     stop reading the new collections.
//
// The `_id` rule is the one that matters. An Auth0 login resolves through
// `user_metadata.metadata.userId`, which IS a Mongo users `_id`
// (modules/identity-guard.js). So an Account keeps its User's `_id` verbatim.
// Minting a new one breaks every existing login, silently — the lookup finds
// nothing and the app just says "no profile in session".

const User = require('../models/user');
const Account = require('../models/account');
const Franchise = require('../models/franchise');

// Person-level fields move to the Account; everything else is the franchise's.
const ACCOUNT_FIELDS = ['firstName', 'lastName', 'email', 'authSub', 'avatarUrl', 'profilePrompted', 'color'];
const FRANCHISE_FIELDS = ['isUpdated', 'lastUpdated'];
// Handled structurally rather than by name.
const STRUCTURAL_FIELDS = ['_id', '__v', 'league', 'seasons'];

// Every path on the User schema must be accounted for somewhere, or the
// migration drops it silently AND verify() stays green — it only ever compares
// the fields it knows about. Add `timezone` to models/user.js six months from
// now, run the cutover, and it is simply gone.
//
// Checked at call time against the live schema, so it cannot drift.
function uncoveredUserFields() {
    const known = new Set([...ACCOUNT_FIELDS, ...FRANCHISE_FIELDS, ...STRUCTURAL_FIELDS]);
    // Compared on the ROOT segment, not the full path. Filtering out anything
    // dotted was only correct for `seasons` — every other nested shape
    // (`prefs: { timezone }`, `notifications: { weeklyRecap }`) dropped out of
    // this check entirely, so the migration would lose it AND verify would stay
    // green. That is the exact failure this function exists to prevent.
    const roots = new Set(Object.keys(User.schema.paths).map(path => path.split('.')[0]));
    return [...roots].filter(root => !known.has(root)).sort();
}

function accountFrom(user) {
    const doc = { _id: user._id, migratedFrom: user._id };
    ACCOUNT_FIELDS.forEach(f => { if (user[f] !== undefined) doc[f] = user[f]; });
    return doc;
}

function franchiseFrom(user) {
    const doc = {
        accountId: user._id, league: user.league, seasons: user.seasons || [],
        migratedFrom: user._id
    };
    FRANCHISE_FIELDS.forEach(f => { if (user[f] !== undefined) doc[f] = user[f]; });
    return doc;
}

// What the run would do, without doing it.
async function plan() {
    const users = await User.find({}).lean();
    const existingAccounts = new Set((await Account.find({}, { _id: 1 }).lean()).map(a => String(a._id)));
    const existingFranchises = new Set(
        (await Franchise.find({}, { accountId: 1, league: 1 }).lean()).map(f => `${f.accountId}::${f.league}`)
    );

    const steps = [];
    const problems = [];
    for (const user of users) {
        if (!user.league) {
            // Without a league there is no franchise to create. Report it rather
            // than inventing one or skipping silently.
            problems.push(`${user.firstName} ${user.lastName} (${user._id}) has no league`);
        }
        steps.push({
            userId: String(user._id),
            name: `${user.firstName} ${user.lastName}`,
            league: user.league || null,
            seasons: (user.seasons || []).map(s => s.season),
            accountAction: existingAccounts.has(String(user._id)) ? 'update' : 'create',
            franchiseAction: user.league
                ? (existingFranchises.has(`${user._id}::${user.league}`) ? 'update' : 'create')
                : 'skip'
        });
    }
    return { steps, problems, userCount: users.length };
}

// Do it. `apply` must be true or this is a no-op that still returns the plan.
async function migrate({ apply = false } = {}) {
    const planned = await plan();
    if (!apply) return { applied: false, ...planned };

    let accounts = 0;
    let franchises = 0;
    const users = await User.find({}).lean();

    for (const user of users) {
        // Upsert, never insert: re-running must not duplicate or throw on the
        // unique (accountId, league) index.
        await Account.updateOne({ _id: user._id }, { $set: accountFrom(user) }, { upsert: true });
        accounts++;

        if (!user.league) continue;
        const f = franchiseFrom(user);
        await Franchise.updateOne(
            { accountId: f.accountId, league: f.league },
            { $set: f },
            { upsert: true }
        );
        franchises++;

        // A user whose league changed between runs would otherwise keep a
        // franchise in the old one — two leagues for one manager. verify()
        // caught it, but re-running never fixed it, which contradicts "a
        // half-finished run is safe to repeat". This has happened for real
        // (the 2026 Cole -> James roster change). Scoped to migrated documents
        // so a genuine second franchise (a basketball entry, #310) survives.
        const stale = await Franchise.deleteMany({
            accountId: f.accountId,
            league: { $ne: f.league },
            migratedFrom: { $exists: true }
        });
        if (stale.deletedCount) {
            console.log(`removed ${stale.deletedCount} stale franchise(s) for ${user.firstName} ${user.lastName}`);
        }
    }

    return { applied: true, accounts, franchises, ...planned };
}

// Did it actually work?
//
// Compares every Account and Franchise against the User it came from. This is
// the check that decides success: a run that throws nothing can still have
// written the wrong thing, and #313's real criterion is that standings come out
// byte-identical.
//
// ---- compared against the EXPECTED document, not the raw user ----
//
// Both sides go through the models first. Mongoose applies defaults and casts
// on write, so a raw-user comparison reported differences that were not
// differences: a user with no `isUpdated` gets `false` by default, and a season
// row with no `teams` key gets `teams: []`. Both are correct migrations that a
// naive diff called failures — and a preseason roster is exactly the shape that
// triggers the second one. Building the expected document the same way the
// migration builds the real one compares like with like.
//
// ---- what this can and cannot tell you ----
//
// It cannot tell you a write did not land BETWEEN the migration and this check.
// `usersFingerprint` is reported so a changed value means "someone scored while
// this ran, re-verify" rather than a silent stale pass. Run midweek anyway.
async function verify() {
    const users = await User.find({}).lean();
    const mismatches = [];
    const warnings = [];

    // A field on User in neither list is dropped by the migration AND invisible
    // to every comparison below, because they only look at fields they know.
    const uncovered = uncoveredUserFields();
    if (uncovered.length) {
        mismatches.push({
            field: 'schema-coverage',
            reason: `models/user.js has field(s) the migration ignores: ${uncovered.join(', ')}. ` +
                    `Add them to ACCOUNT_FIELDS or FRANCHISE_FIELDS.`
        });
    }

    for (const user of users) {
        const id = String(user._id);
        const expectedAccount = new Account(accountFrom(user)).toObject();
        const account = await Account.findById(user._id).lean();

        if (!account) {
            mismatches.push({ userId: id, field: 'account', reason: 'missing' });
        } else {
            // The _id rule. Deliberately NOT `if (account._id !== id)` after a
            // findById(id): that can only ever return a document with that id,
            // so the check reads as the important one while being unreachable.
            // What actually catches a minted _id is asking whether anything
            // claims to have come from this user and landed elsewhere.
            const strays = await Account.find(
                { migratedFrom: user._id, _id: { $ne: user._id } },
                { _id: 1 }
            ).lean();
            strays.forEach(stray => mismatches.push({
                userId: id, field: '_id',
                reason: `account ${stray._id} claims to come from this user but has a different _id — ` +
                        `an Auth0 login resolving through metadata.userId would find nothing`
            }));
            ACCOUNT_FIELDS.forEach(f => {
                const before = stripIds(expectedAccount[f] === undefined ? null : expectedAccount[f]);
                const after = stripIds(account[f] === undefined ? null : account[f]);
                if (JSON.stringify(before) !== JSON.stringify(after)) {
                    mismatches.push({ userId: id, field: f, expected: before, actual: after });
                }
            });
        }

        if (!user.league) continue;
        const expectedFranchise = new Franchise(franchiseFrom(user)).toObject();
        const franchise = await Franchise.findOne({ accountId: user._id, league: user.league }).lean();
        if (!franchise) {
            mismatches.push({ userId: id, field: 'franchise', reason: `missing for ${user.league}` });
            continue;
        }

        // Seasons compared whole, not by count: a roster or a weekly score that
        // changed shape in transit is what would move standings, and counting
        // entries would miss it.
        const before = stripIds(expectedFranchise.seasons || []);
        const after = stripIds(franchise.seasons || []);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
            mismatches.push({ userId: id, field: 'seasons', reason: seasonDiffSummary(before, after) });
        }
        FRANCHISE_FIELDS.forEach(f => {
            const b = stripIds(expectedFranchise[f] === undefined ? null : expectedFranchise[f]);
            const a = stripIds(franchise[f] === undefined ? null : franchise[f]);
            if (JSON.stringify(b) !== JSON.stringify(a)) {
                mismatches.push({ userId: id, field: f, expected: b, actual: a });
            }
        });
    }

    // Counted over MIGRATED documents only. Once phase 2 ships, an account
    // created directly (a basketball-only manager with no User) is a legitimate
    // extra, not a fault — counting every document would make verify red
    // forever, which is exactly the end state this epic is driving at.
    const migratedAccounts = await Account.countDocuments({ migratedFrom: { $exists: true } });
    const migratedFranchises = await Franchise.countDocuments({ migratedFrom: { $exists: true } });
    const extraAccounts = await Account.countDocuments({ migratedFrom: { $exists: false } });
    const extraFranchises = await Franchise.countDocuments({ migratedFrom: { $exists: false } });
    const expectedFranchiseCount = users.filter(u => u.league).length;

    if (migratedAccounts !== users.length) {
        mismatches.push({ field: 'accountCount', expected: users.length, actual: migratedAccounts });
    }
    if (migratedFranchises !== expectedFranchiseCount) {
        mismatches.push({ field: 'franchiseCount', expected: expectedFranchiseCount, actual: migratedFranchises });
    }
    if (extraAccounts || extraFranchises) {
        warnings.push(`${extraAccounts} account(s) and ${extraFranchises} franchise(s) were not created by this ` +
                      `migration — not compared, and rollback will not delete them.`);
    }

    return {
        ok: mismatches.length === 0,
        mismatches, warnings,
        users: users.length,
        accountCount: migratedAccounts,
        franchiseCount: migratedFranchises,
        // Changes if anything wrote to a user while this ran. Compare across two
        // verify() calls to tell a stale pass from a real one.
        usersFingerprint: fingerprint(users)
    };
}

// Cheap "did the users collection move" signal — the fields a scoring pass
// writes.
function fingerprint(users) {
    return users
        .map(u => `${u._id}:${u.lastUpdated || ''}:${(u.seasons || []).map(s => s.cumulativeScore || 0).join(',')}`)
        .sort()
        .join('|');
}

// Mongoose stamps a fresh _id on every copied subdocument, so compare on
// content. The subdoc ids are not referenced anywhere.
function stripIds(value) {
    if (Array.isArray(value)) return value.map(stripIds);
    // Dates, ObjectIds and Buffers are objects with NO own enumerable keys, so
    // the generic branch below rebuilt them as {} — silently comparing every
    // Date equal to every other Date. Serialise them instead. There is no Date
    // in seasonSchema today; the day someone adds a draft timestamp or a
    // captain lock time, this has to already be right.
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return value.toString('hex');
    if (value && typeof value === 'object' && typeof value.toHexString === 'function') {
        return value.toHexString();   // ObjectId
    }
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => {
            // Subdocument ids are referenced nowhere. They happen to survive the
            // copy today, but a copy path that re-mints them must not fail this.
            if (k === '_id') return;
            out[k] = stripIds(value[k]);
        });
        return out;
    }
    return value;
}

// A readable "what differs", so a failed verify names the season rather than
// printing two walls of JSON.
function seasonDiffSummary(before, after) {
    if (before.length !== after.length) return `season count ${before.length} -> ${after.length}`;
    const differing = before
        .map((b, i) => (JSON.stringify(b) === JSON.stringify(after[i]) ? null : (b.season || `index ${i}`)))
        .filter(Boolean);
    return `seasons differ: ${differing.join(', ')}`;
}

// Undo. Drops only what the migration created; users are untouched throughout,
// so this returns the database to exactly its pre-migration state.
async function rollback({ apply = false } = {}) {
    // Scoped by `migratedFrom`, NOT deleteMany({}). Once phase 2 ships, a
    // basketball-only manager exists as an Account with no User behind them —
    // and unlike everyone else, they cannot be reconstructed from the users
    // collection. An unscoped delete would take them with it.
    const owned = { migratedFrom: { $exists: true } };
    const accounts = await Account.countDocuments(owned);
    const franchises = await Franchise.countDocuments(owned);
    const keptAccounts = await Account.countDocuments({ migratedFrom: { $exists: false } });
    const keptFranchises = await Franchise.countDocuments({ migratedFrom: { $exists: false } });

    // "A full return to the pre-migration state" holds only while these
    // documents still say what their source user says. After the cutover the app
    // writes here — a changed avatar, a renamed franchise, a week of scores —
    // and none of that is in `users`, which still holds only what it held
    // before. Deleting then is data loss, not a rollback.
    //
    // Detected by CONTENT, not timestamps: `updatedAt > createdAt` counts the
    // migration's own re-apply as an app write, which made this fire on every
    // document after a second --apply. A document that still matches what the
    // migration would produce carries nothing that `users` cannot rebuild,
    // however many times it has been rewritten.
    const divergent = (await verify()).mismatches
        .filter(m => m.userId)
        .map(m => m.userId);
    const touchedSinceMigration = new Set(divergent).size;

    if (!apply) {
        return {
            applied: false,
            wouldDelete: { accounts, franchises },
            wouldKeep: { accounts: keptAccounts, franchises: keptFranchises },
            touchedSinceMigration
        };
    }
    await Account.deleteMany(owned);
    await Franchise.deleteMany(owned);
    return {
        applied: true,
        deleted: { accounts, franchises },
        kept: { accounts: keptAccounts, franchises: keptFranchises },
        touchedSinceMigration
    };
}

module.exports = {
    plan, migrate, verify, rollback,
    accountFrom, franchiseFrom, stripIds, uncoveredUserFields, fingerprint,
    ACCOUNT_FIELDS, FRANCHISE_FIELDS
};
