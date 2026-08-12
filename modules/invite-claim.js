// Decides whether an invite may be claimed, and by whom.
//
// This runs DURING login, not after it. The Auth0 post-login Action calls
// /invite/resolve with the token and the identity that just authenticated; the
// answer goes into the ID token Auth0 is about to mint, so the very first token
// an invitee holds already names their franchise.
//
// That ordering is the whole point. It used to run afterwards, writing the
// pointer to Auth0 once the token had already been issued — which meant the
// token was stale the moment it existed and the app had to send the invitee
// back through a second login to replace it. There is no quiet way to do that
// (a prompt=none refresh answers login_required when the tenant has no session
// to reuse), so the fix is to have nothing to refresh.
//
// The rules below are unchanged from when they ran in middleware; only the
// caller moved.

const norm = (e) => String(e == null ? '' : e).trim().toLowerCase();

// Pure decision, exported for testing.
//
// `action` is one of:
//   claim  — hand back the franchise; the caller records the binding
//   ignore — nothing to do, and nothing wrong (already linked, already theirs)
//   refuse — say why; the invitee sees it on the way back
function decideInvite({ invite, sub, tokenEmail, sessionUserId, record, lookupError }) {
    if (!invite) return { action: 'ignore', reason: 'no-invite' };
    if (!sub)    return { action: 'ignore', reason: 'no-identity' };

    // Already has a franchise. Someone opening a second invite on a linked
    // login isn't an error, but we must never repoint a working account.
    if (sessionUserId) return { action: 'ignore', reason: 'already-linked' };

    // A DB hiccup shouldn't spend the invite — let them try again.
    if (lookupError) return { action: 'ignore', reason: 'lookup-error' };

    if (!record) return { action: 'refuse', reason: 'no-record' };

    if (invite.league && record.league && invite.league !== record.league) {
        return { action: 'refuse', reason: 'league-mismatch' };
    }

    // Idempotent: the identity that already owns this franchise re-entering
    // (a refresh, a re-used link) is a no-op, not a failure.
    if (record.authSub && record.authSub === sub) {
        return { action: 'ignore', reason: 'already-bound' };
    }
    // Single-use. A spent link must not hand the franchise to a second person.
    if (record.authSub) return { action: 'refuse', reason: 'already-claimed' };

    // No mailbox-confirmation step, deliberately. It was tried and removed: it
    // made every password invitee leave for an inbox mid-flow while Google and
    // Apple went straight through, and most of this league uses a password.
    // What still stands in the way: the link is HMAC-signed, expires in 14 days,
    // works once, and has to be handed over by the commissioner. Revisit if
    // invites ever travel further than a group chat.

    // Email gate. When the franchise knows its manager's address, the person
    // claiming has to be that person — this is what makes a forwarded link
    // useless. When it doesn't (every record predating this feature, since
    // nothing ever wrote User.email), trust the commissioner's choice of
    // recipient and record the address on first use.
    if (record.email) {
        if (!tokenEmail) return { action: 'refuse', reason: 'no-token-email' };
        if (norm(tokenEmail) !== norm(record.email)) {
            return { action: 'refuse', reason: 'email-mismatch' };
        }
        return { action: 'claim', reason: 'verified' };
    }
    return { action: 'claim', reason: 'first-use' };
}

// What the invitee is told when a claim is refused. Short, because it reaches
// them as a query parameter on the login page rather than a page of its own.
const REFUSAL_COPY = {
    'no-record':       'That invite points at a team that no longer exists.',
    'league-mismatch': 'That invite doesn’t match the league it was created for.',
    'already-claimed': 'That invite has already been used. Ask your commissioner for a new link.',
    'no-token-email':  'That login didn’t give us an email address, so we can’t match it to your team.',
    'email-mismatch':  'That invite was sent to a different address. Sign in with the one your commissioner invited.'
};

function refusalMessage(reason) {
    return REFUSAL_COPY[reason] || 'That invite couldn’t be used. Ask your commissioner for a new link.';
}

module.exports = { decideInvite, refusalMessage, REFUSAL_COPY };
