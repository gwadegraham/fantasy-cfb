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

function accountFrom(user) {
    const doc = { _id: user._id };
    ACCOUNT_FIELDS.forEach(f => { if (user[f] !== undefined) doc[f] = user[f]; });
    return doc;
}

function franchiseFrom(user) {
    const doc = { accountId: user._id, league: user.league, seasons: user.seasons || [] };
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
    }

    return { applied: true, accounts, franchises, ...planned };
}

// Did it actually work?
//
// Compares every Account and Franchise against the User it came from. This is
// the check that decides success — a run that throws nothing can still have
// written the wrong thing, and the whole point of #313's "pre/post standings
// diff is empty" criterion is that scores must come out byte-identical.
async function verify() {
    const users = await User.find({}).lean();
    const mismatches = [];

    for (const user of users) {
        const id = String(user._id);
        const account = await Account.findById(user._id).lean();

        if (!account) {
            mismatches.push({ userId: id, field: 'account', reason: 'missing' });
        } else {
            // The _id rule, checked explicitly rather than assumed: this is the
            // one that breaks every login if it is wrong.
            if (String(account._id) !== id) {
                mismatches.push({ userId: id, field: '_id', expected: id, actual: String(account._id) });
            }
            ACCOUNT_FIELDS.forEach(f => {
                const before = user[f] === undefined ? null : user[f];
                const after = account[f] === undefined ? null : account[f];
                if (JSON.stringify(before) !== JSON.stringify(after)) {
                    mismatches.push({ userId: id, field: f, expected: before, actual: after });
                }
            });
        }

        if (!user.league) continue;
        const franchise = await Franchise.findOne({ accountId: user._id, league: user.league }).lean();
        if (!franchise) {
            mismatches.push({ userId: id, field: 'franchise', reason: `missing for ${user.league}` });
            continue;
        }

        // Seasons compared whole, not by count: a roster or a weekly score that
        // changed shape in transit is exactly what would make standings differ,
        // and counting entries would miss it.
        const before = stripIds(user.seasons || []);
        const after = stripIds(franchise.seasons || []);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
            mismatches.push({
                userId: id,
                field: 'seasons',
                reason: seasonDiffSummary(before, after)
            });
        }
        FRANCHISE_FIELDS.forEach(f => {
            const b = user[f] === undefined ? null : user[f];
            const a = franchise[f] === undefined ? null : franchise[f];
            if (JSON.stringify(b) !== JSON.stringify(a)) {
                mismatches.push({ userId: id, field: f, expected: b, actual: a });
            }
        });
    }

    // Nothing should exist that no User accounts for.
    const accountCount = await Account.countDocuments({});
    const franchiseCount = await Franchise.countDocuments({});
    const expectedFranchises = users.filter(u => u.league).length;
    if (accountCount !== users.length) {
        mismatches.push({ field: 'accountCount', expected: users.length, actual: accountCount });
    }
    if (franchiseCount !== expectedFranchises) {
        mismatches.push({ field: 'franchiseCount', expected: expectedFranchises, actual: franchiseCount });
    }

    return { ok: mismatches.length === 0, mismatches, users: users.length, accountCount, franchiseCount };
}

// Mongoose stamps a fresh _id on every copied subdocument, so compare on
// content. The subdoc ids are not referenced anywhere.
function stripIds(value) {
    if (Array.isArray(value)) return value.map(stripIds);
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => {
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
    const accounts = await Account.countDocuments({});
    const franchises = await Franchise.countDocuments({});
    if (!apply) return { applied: false, wouldDelete: { accounts, franchises } };
    await Account.deleteMany({});
    await Franchise.deleteMany({});
    return { applied: true, deleted: { accounts, franchises } };
}

module.exports = {
    plan, migrate, verify, rollback,
    accountFrom, franchiseFrom, stripIds,
    ACCOUNT_FIELDS, FRANCHISE_FIELDS
};
