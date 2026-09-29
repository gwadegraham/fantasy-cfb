// Learns which Auth0 login owns which franchise, by watching people log in.
//
// The app resolves login -> franchise through the Auth0 claim
// user_metadata.metadata.userId, and for everyone provisioned before the invite
// flow that pointer only exists inside Auth0. Nothing on our side records WHICH
// login owns a team, so the Manager Logins panel couldn't tell a member who has
// signed in happily for two years apart from one who has never been set up —
// they both had an empty User.authSub.
//
// Rather than granting the Management API a read scope and running a migration,
// this takes the sub that already arrives in every session and records it the
// first time we see it. The panel becomes accurate on its own as people use the
// app. The trade is convergence speed: a member who doesn't log in stays
// unmarked until they do.
//
// SAFETY: this only ever runs on a session identity-guard has already vouched
// for (it is mounted after it in server.js), and it only ever fills a blank —
// the conditional in the update filter means an existing binding is never
// overwritten and two concurrent requests can't fight over it.

// Pure predicate, exported for testing: is there something to learn here?
function shouldRecord(record, sub) {
    return !!(sub && record && !record.authSub);
}

// Writes the sub only if the record still has none. Returns true if this call
// is the one that filled it in. Never throws — a failed backfill is a cosmetic
// loss (one row stays unmarked), not a reason to fail the request it rode in on.
async function recordAuthSub(repo, userId, sub) {
    if (!repo || !userId || !sub) return false;
    try {
        // authSub is an ACCOUNT field, so this goes through the repo rather than
        // the User model (#313 phase 3) and lands wherever the reads come from.
        //
        // The blank-only condition stays in the FILTER. That is what makes this
        // atomic: an existing binding is never overwritten and two concurrent
        // requests cannot fight over it. Expressed in the update body instead,
        // it would become read-then-write and lose both properties.
        const res = await repo.updateAccount(
            userId,
            { $set: { authSub: sub } },
            { filter: { $or: [{ authSub: { $exists: false } }, { authSub: null }, { authSub: '' }] } }
        );
        return (res.modifiedCount || res.nModified || 0) === 1;
    } catch (e) {
        return false;
    }
}

module.exports = { shouldRecord, recordAuthSub };
