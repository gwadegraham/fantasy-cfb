// Commissioner invite flow — the pure pieces.
//
// The link is a bearer credential: whoever holds it can claim a franchise. Most
// of what matters here is therefore about REFUSING — expired, tampered, spent,
// or claimed by the wrong person. The happy path is one case; the ways it must
// not work are the rest.

const inviteToken = require('../modules/invite-token');
const { decideInvite, refusalMessage } = require('../modules/invite-claim');

const SECRET = 'test-secret-value';

describe('invite-token', () => {
    test('round-trips the franchise and league', () => {
        const t = inviteToken.sign({ userId: 'abc123', league: 'graham-league' }, SECRET);
        expect(inviteToken.verify(t, SECRET)).toEqual({ userId: 'abc123', league: 'graham-league' });
    });

    test('coerces a Mongo ObjectId to a string', () => {
        const t = inviteToken.sign({ userId: { toString: () => 'oid' }, league: 'x' }, SECRET);
        expect(inviteToken.verify(t, SECRET).userId).toBe('oid');
    });

    test('rejects a token signed with a different secret', () => {
        const t = inviteToken.sign({ userId: 'abc' }, SECRET);
        expect(inviteToken.verify(t, 'other-secret')).toBeNull();
    });

    test('rejects a tampered payload', () => {
        const t = inviteToken.sign({ userId: 'abc' }, SECRET);
        const [data, sig] = t.split('.');
        const forged = Buffer.from(JSON.stringify({ inv: 'someone-else', exp: Date.now() + 1000 }))
            .toString('base64url');
        expect(inviteToken.verify(forged + '.' + sig, SECRET)).toBeNull();
        expect(data).not.toBe(forged);
    });

    test('rejects an expired token', () => {
        const t = inviteToken.sign({ userId: 'abc' }, SECRET, -1000);   // already past
        expect(inviteToken.verify(t, SECRET)).toBeNull();
    });

    test('rejects malformed input and a missing secret', () => {
        expect(inviteToken.verify('', SECRET)).toBeNull();
        expect(inviteToken.verify('no-dot', SECRET)).toBeNull();
        expect(inviteToken.verify('a.b.c', SECRET)).toBeNull();
        expect(inviteToken.verify(null, SECRET)).toBeNull();
        expect(inviteToken.verify('anything', '')).toBeNull();
    });

    test('refuses to sign without a userId or a secret', () => {
        expect(inviteToken.sign({ league: 'x' }, SECRET)).toBeNull();
        expect(inviteToken.sign({ userId: 'a' }, '')).toBeNull();
    });

    test('a token carrying no inv is not a valid invite', () => {
        // Signed by us, correctly, but for something else — a draft token, say.
        const draftToken = require('../modules/draft-token');
        const t = draftToken.sign({ userId: 'abc' }, SECRET);
        expect(inviteToken.verify(t, SECRET)).toBeNull();
    });

    test('linkFor builds the URL and tolerates a trailing slash', () => {
        expect(inviteToken.linkFor('https://campusclash.io/', 'TOK')).toBe('https://campusclash.io/invite/TOK');
        expect(inviteToken.linkFor('https://campusclash.io', 'TOK')).toBe('https://campusclash.io/invite/TOK');
    });

    test('the default lifetime is 14 days', () => {
        expect(inviteToken.TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    });
});

describe('decideInvite', () => {
    const invite = { userId: 'u1', league: 'graham-league' };
    const record = { _id: 'u1', league: 'graham-league', email: 'ann@example.com', authSub: null };
    const base = { invite, sub: 'google-oauth2|1', tokenEmail: 'ann@example.com', sessionUserId: null, record, lookupError: false };
    const decide = (o) => decideInvite(Object.assign({}, base, o));

    test('binds when the login email matches the franchise', () => {
        expect(decide()).toEqual({ action: 'claim', reason: 'verified' });
    });

    test('is case- and whitespace-insensitive about the email', () => {
        expect(decide({ tokenEmail: '  ANN@Example.com ' }).action).toBe('claim');
    });

    test('does nothing without an invite', () => {
        expect(decide({ invite: null })).toEqual({ action: 'ignore', reason: 'no-invite' });
    });

    test('waits for the login rather than acting on an anonymous request', () => {
        expect(decide({ sub: null })).toEqual({ action: 'ignore', reason: 'no-identity' });
    });

    test('never repoints a session that already has a franchise', () => {
        expect(decide({ sessionUserId: 'someone-else' })).toEqual({ action: 'ignore', reason: 'already-linked' });
    });

    test('keeps the invite alive through a DB hiccup instead of spending it', () => {
        expect(decide({ lookupError: true })).toEqual({ action: 'ignore', reason: 'lookup-error' });
    });

    test('refuses when the franchise is gone', () => {
        expect(decide({ record: null })).toEqual({ action: 'refuse', reason: 'no-record' });
    });

    test('refuses a token minted for a different league', () => {
        expect(decide({ invite: { userId: 'u1', league: 'claunts-league' } }))
            .toEqual({ action: 'refuse', reason: 'league-mismatch' });
    });

    // The single-use property: a link that already bought someone a franchise
    // must not buy a second person the same one.
    test('refuses a link that has already been claimed by someone else', () => {
        expect(decide({ record: Object.assign({}, record, { authSub: 'auth0|other' }) }))
            .toEqual({ action: 'refuse', reason: 'already-claimed' });
    });

    test('is idempotent for the identity that already owns the franchise', () => {
        expect(decide({ record: Object.assign({}, record, { authSub: 'google-oauth2|1' }) }))
            .toEqual({ action: 'ignore', reason: 'already-bound' });
    });

    // The mailbox-confirmation step was removed: it cost every password invitee
    // a trip to their inbox mid-flow while social users sailed past, and the
    // signed single-use link already gates who can claim at all.
    test('binds a password identity without demanding a confirmed address', () => {
        expect(decide({ sub: 'auth0|1' }).action).toBe('claim');
    });

    // The forwarded-link property.
    test('refuses when the claimer signed in with a different address', () => {
        expect(decide({ tokenEmail: 'mallory@example.com' }))
            .toEqual({ action: 'refuse', reason: 'email-mismatch' });
    });

    test('refuses when the login carried no email to check against', () => {
        expect(decide({ tokenEmail: null })).toEqual({ action: 'refuse', reason: 'no-token-email' });
    });

    // Every record predating this feature has no email, because nothing ever
    // wrote User.email. Those still have to be invitable.
    test('trusts the first claimer when the franchise has no email on file', () => {
        const legacy = Object.assign({}, record, { email: null });
        expect(decide({ record: legacy })).toEqual({ action: 'claim', reason: 'first-use' });
        expect(decide({ record: legacy, tokenEmail: null })).toEqual({ action: 'claim', reason: 'first-use' });
    });

    test('a league-less invite is not treated as a mismatch', () => {
        expect(decide({ invite: { userId: 'u1', league: '' } }).action).toBe('claim');
    });
});





// Regression: an invitee between "account created" and "team claimed" has a
// session with no franchise pointer — exactly what identity-guard blocks. It was
// blocking /invite/* too, so the link they were told to reopen was unreachable
// and the flow dead-ended on the block page.


// The post-bind token refresh asks Auth0 for a new token with prompt=none. When
// there's no session to reuse Auth0 refuses, and that has to read as "just sign
// in" rather than as a server error — otherwise the invitee gets a 500 at the
// last step of a claim that actually succeeded.

describe('refusalMessage', () => {
    test('explains each refusal in words an invitee can act on', () => {
        expect(refusalMessage('already-claimed')).toMatch(/already been used/i);
        expect(refusalMessage('email-mismatch')).toMatch(/different address/i);
        expect(refusalMessage('league-mismatch')).toMatch(/league/i);
    });
    test('falls back to something sayable for an unknown reason', () => {
        expect(refusalMessage('who-knows')).toMatch(/couldn’t be used/i);
    });
});
