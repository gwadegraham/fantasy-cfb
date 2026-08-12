// Commissioner invite flow — the pure pieces.
//
// The link is a bearer credential: whoever holds it can claim a franchise. Most
// of what matters here is therefore about REFUSING — expired, tampered, spent,
// or claimed by the wrong person. The happy path is one case; the ways it must
// not work are the rest.

const inviteToken = require('../modules/invite-token');
const { decideInvite, getCookie, renderRefusalPage, COOKIE } = require('../modules/invite-bind');

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
    const base = { invite, sub: 'google-oauth2|1', tokenEmail: 'ann@example.com', emailVerified: true, sessionUserId: null, record, lookupError: false };
    const decide = (o) => decideInvite(Object.assign({}, base, o));

    test('binds when the login email matches the franchise', () => {
        expect(decide()).toEqual({ action: 'bind', reason: 'verified' });
    });

    test('is case- and whitespace-insensitive about the email', () => {
        expect(decide({ tokenEmail: '  ANN@Example.com ' }).action).toBe('bind');
    });

    test('does nothing without an invite', () => {
        expect(decide({ invite: null })).toEqual({ action: 'skip', reason: 'no-invite' });
    });

    test('waits for the login rather than acting on an anonymous request', () => {
        expect(decide({ sub: null })).toEqual({ action: 'skip', reason: 'not-authenticated' });
    });

    test('never repoints a session that already has a franchise', () => {
        expect(decide({ sessionUserId: 'someone-else' })).toEqual({ action: 'clear', reason: 'already-linked' });
    });

    test('keeps the invite alive through a DB hiccup instead of spending it', () => {
        expect(decide({ lookupError: true })).toEqual({ action: 'skip', reason: 'lookup-error' });
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
            .toEqual({ action: 'clear', reason: 'already-bound' });
    });

    // Re-enabling sign-ups means anyone can type any address into the form, so a
    // password identity has to prove the mailbox before that address can take a
    // franchise — otherwise a leaked link plus a self-signup walks past the email
    // gate entirely. Google and Apple vouch for the address themselves.
    test('refuses an unverified password identity', () => {
        expect(decide({ sub: 'auth0|1', emailVerified: false }))
            .toEqual({ action: 'refuse', reason: 'unverified-email' });
    });

    test('accepts a verified password identity', () => {
        expect(decide({ sub: 'auth0|1', emailVerified: true }).action).toBe('bind');
    });

    test.each([['google-oauth2|1'], ['apple|1']])(
        'does not demand verification of %s — the provider vouches', (sub) => {
        expect(decide({ sub, emailVerified: false }).action).toBe('bind');
    });

    // The mailbox check must not become a way around single-use or the email gate.
    test('the spent-link and wrong-address refusals still win over verification', () => {
        expect(decide({ sub: 'auth0|1', emailVerified: false, record: Object.assign({}, record, { authSub: 'auth0|other' }) }).reason)
            .toBe('already-claimed');
        expect(decide({ sub: 'auth0|1', emailVerified: true, tokenEmail: 'mallory@example.com' }).reason)
            .toBe('email-mismatch');
    });

    test('an unverified password identity cannot use the no-email fallback either', () => {
        expect(decide({ sub: 'auth0|1', emailVerified: false, record: Object.assign({}, record, { email: null }) }))
            .toEqual({ action: 'refuse', reason: 'unverified-email' });
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
        expect(decide({ record: legacy })).toEqual({ action: 'bind', reason: 'first-use' });
        expect(decide({ record: legacy, tokenEmail: null })).toEqual({ action: 'bind', reason: 'first-use' });
    });

    test('a league-less invite is not treated as a mismatch', () => {
        expect(decide({ invite: { userId: 'u1', league: '' } }).action).toBe('bind');
    });
});

describe('getCookie', () => {
    const req = (cookie) => ({ headers: cookie ? { cookie } : {} });

    test('reads the named cookie', () => {
        expect(getCookie(req('a=1; cc_invite=tok; b=2'), COOKIE)).toBe('tok');
    });
    test('url-decodes the value', () => {
        expect(getCookie(req('cc_invite=a%2Bb'), COOKIE)).toBe('a+b');
    });
    test('returns null when absent, and when there are no headers at all', () => {
        expect(getCookie(req('a=1'), COOKIE)).toBeNull();
        expect(getCookie({}, COOKIE)).toBeNull();
    });
    // 'xcc_invite=' must not satisfy a lookup for 'cc_invite'.
    test('does not match a cookie whose name merely ends with the target', () => {
        expect(getCookie(req('xcc_invite=nope'), COOKIE)).toBeNull();
    });
});

describe('renderRefusalPage', () => {
    test('explains the specific reason and always offers a way out', () => {
        const html = renderRefusalPage('email-mismatch');
        expect(html).toContain('Wrong email address');
        expect(html).toContain('different address');
        expect(html).toContain('href="/logout"');
    });

    // An unconfirmed address is a step still to take, not a dead end: the
    // heading shouldn't say the invite failed, and the way forward is to retry
    // rather than to log out.
    test('treats an unconfirmed address as a step, not a failure', () => {
        const html = renderRefusalPage('unverified-email', '/invite/TOK');
        expect(html).toContain('One more step');
        expect(html).not.toContain('didn’t work');
        expect(html).toContain('href="/invite/TOK"');
    });

    test('falls back to Log out when there is no retry link to offer', () => {
        const html = renderRefusalPage('unverified-email');
        expect(html).toContain('href="/logout"');
        expect(html).not.toContain('/invite/');
    });

    test('does not offer a retry for reasons retrying cannot fix', () => {
        expect(renderRefusalPage('already-claimed', '/invite/TOK')).not.toContain('href="/invite/TOK"');
    });

    test('falls back to a generic message for an unknown reason', () => {
        expect(renderRefusalPage('who-knows')).toContain('couldn’t finish setting up');
    });
});

describe('auth0-management', () => {
    const ISSUER = 'https://tenant.us.auth0.com';
    let management;
    let realFetch;

    beforeEach(() => {
        jest.resetModules();
        realFetch = global.fetch;
        process.env.ISSUER_BASE_URL = ISSUER;
        process.env.AUTH0_M2M_CLIENT_ID = 'cid';
        process.env.AUTH0_M2M_CLIENT_SECRET = 'secret';
        management = require('../modules/auth0-management');
        management._reset();
    });
    afterEach(() => {
        global.fetch = realFetch;
        management._reset();
    });

    function stubFetch(handlers) {
        const calls = [];
        global.fetch = jest.fn(async (url, opts) => {
            calls.push({ url, opts });
            return handlers(url, opts);
        });
        return calls;
    }

    const tokenOk = () => ({ ok: true, status: 200, json: async () => ({ access_token: 'T1', expires_in: 86400 }) });

    test('is not configured without credentials', () => {
        delete process.env.AUTH0_M2M_CLIENT_SECRET;
        expect(management.isConfigured()).toBe(false);
        process.env.AUTH0_M2M_CLIENT_SECRET = 'secret';
        expect(management.isConfigured()).toBe(true);
    });

    test('requests a token against the Management API audience', async () => {
        const calls = stubFetch(() => tokenOk());
        await management.getToken();
        const body = JSON.parse(calls[0].opts.body);
        expect(calls[0].url).toBe(ISSUER + '/oauth/token');
        expect(body.grant_type).toBe('client_credentials');
        expect(body.audience).toBe(ISSUER + '/api/v2/');
    });

    test('caches the token instead of buying one per call', async () => {
        const calls = stubFetch(() => tokenOk());
        await management.getToken();
        await management.getToken();
        expect(calls).toHaveLength(1);
    });

    test('renews once the cached token is close to expiring', async () => {
        const calls = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ access_token: 'T', expires_in: 30 }) }));
        await management.getToken();
        await management.getToken();   // 30s life is inside the skew window
        expect(calls).toHaveLength(2);
    });

    test('throws when the token request fails', async () => {
        stubFetch(() => ({ ok: false, status: 401 }));
        await expect(management.getToken()).rejects.toThrow(/token request failed: 401/);
    });

    test('PATCHes user_metadata with a bearer token and an encoded sub', async () => {
        const calls = stubFetch((url) => url.endsWith('/oauth/token')
            ? tokenOk()
            : { ok: true, status: 200, json: async () => ({ user_id: 'auth0|1' }) });

        await management.patchUserMetadata('auth0|1', { metadata: { userId: 'u1', league: 'gg' } });

        const patch = calls[1];
        expect(patch.url).toBe(ISSUER + '/api/v2/users/auth0%7C1');   // the pipe must be escaped
        expect(patch.opts.method).toBe('PATCH');
        expect(patch.opts.headers.authorization).toBe('Bearer T1');
        expect(JSON.parse(patch.opts.body)).toEqual({ user_metadata: { metadata: { userId: 'u1', league: 'gg' } } });
    });

    // A revoked token would otherwise be replayed until the cache aged out.
    test('drops the cached token on a 401 so the next attempt re-authenticates', async () => {
        let patches = 0;
        const calls = stubFetch((url) => {
            if (url.endsWith('/oauth/token')) return tokenOk();
            patches += 1;
            return patches === 1 ? { ok: false, status: 401 } : { ok: true, status: 200, json: async () => ({}) };
        });

        await expect(management.patchUserMetadata('auth0|1', {})).rejects.toThrow(/PATCH failed: 401/);
        await management.patchUserMetadata('auth0|1', {});

        expect(calls.filter(c => c.url.endsWith('/oauth/token'))).toHaveLength(2);
    });

    test('refuses to call out when it has no credentials', async () => {
        delete process.env.AUTH0_M2M_CLIENT_ID;
        global.fetch = jest.fn();
        await expect(management.patchUserMetadata('auth0|1', {})).rejects.toThrow(/not configured/);
        expect(global.fetch).not.toHaveBeenCalled();
    });
});


// Regression: an invitee between "account created" and "team claimed" has a
// session with no franchise pointer — exactly what identity-guard blocks. It was
// blocking /invite/* too, so the link they were told to reopen was unreachable
// and the flow dead-ended on the block page.
describe('identity-guard leaves the invite path open', () => {
    const identityGuard = require('../modules/identity-guard');
    const express = require('express');
    const request = require('supertest');

    function guardedApp(oidcUser) {
        const app = express();
        app.use((req, res, next) => {
            req.oidc = { isAuthenticated: () => !!oidcUser, user: oidcUser };
            next();
        });
        // No pointer resolves, so the guard would normally refuse every request.
        app.use(identityGuard({ User: { findById: () => ({ lean: async () => null }) } }));
        app.use((req, res) => res.status(200).send('reached'));   // version-agnostic catch-all
        return app;
    }

    const unlinked = { sub: 'auth0|new', email: 'ann@example.com', user_metadata: {} };

    test('lets an unlinked session reach its invite link and start', async () => {
        const app = guardedApp(unlinked);
        expect((await request(app).get('/invite/TOKEN')).status).toBe(200);
        expect((await request(app).get('/invite/TOKEN/start')).status).toBe(200);
        expect((await request(app).get('/invite/verified')).status).toBe(200);
    });

    test('still blocks everything else for that session', async () => {
        expect((await request(guardedApp(unlinked)).get('/standings')).status).toBe(403);
    });
});
