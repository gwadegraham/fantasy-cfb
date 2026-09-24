// modules/identity-guard.js — the seatbelt on the app's whole identity model.
//
// The app resolves "who you are" from ONE Auth0 claim pointing at a Mongo _id.
// A wrong pointer renders, and lets you edit, someone else's franchise; that
// has actually happened (a member's Google identity resolved into the other
// league). This middleware compares the login's email against the resolved
// record's and refuses on a verifiable mismatch.
//
// It had 57% coverage and the database read itself had NONE, which is why this
// file exists: #313 phase 2 is about to move that read onto accounts, and there
// was nothing pinning what it does today.
//
// The asymmetry is the thing to hold on to. Failing CLOSED on a session that
// should be allowed locks a manager out of the app entirely, with only Log Out
// as an escape — so every ambiguous case must fail OPEN, and each of those
// paths gets a test here rather than being left to the pure-function block.

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const franchiseRepo = require('../modules/franchise-repo');
const identityGuard = require('../modules/identity-guard');
const { decideIdentity } = identityGuard;

useMongo();

beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// A session in the shape the Post Login Add Metadata Action produces:
// { roles, metadata: <the whole user_metadata> }. The nesting is load-bearing —
// the app reads user_metadata.metadata.userId.
function session(userId, email) {
    return {
        sub: 'auth0|whoever',
        email,
        user_metadata: { roles: [], metadata: userId ? { userId: String(userId) } : {} }
    };
}

function guardedApp(oidcUser, deps) {
    const app = express();
    app.use((req, res, next) => {
        req.oidc = { isAuthenticated: () => !!oidcUser, user: oidcUser };
        next();
    });
    app.use(identityGuard(deps || { repo: franchiseRepo }));
    app.use((req, res) => res.status(200).send('reached'));
    return app;
}

const player = (over) => Object.assign({
    firstName: 'Ann', lastName: 'Arbor', league: 'graham-league', seasons: []
}, over);

describe('decideIdentity — the pure verdict', () => {
    const rec = (email) => ({ email });

    test.each([
        ['a DB hiccup allows, rather than locking anyone out',
         { userId: 'u1', tokenEmail: 'a@x.com', record: null, lookupError: true }, true, 'lookup-error'],
        ['a login with no pointer is blocked',
         { userId: null, tokenEmail: 'a@x.com', record: rec('a@x.com') }, false, 'no-pointer'],
        ['a pointer that resolves to nothing is blocked',
         { userId: 'u1', tokenEmail: 'a@x.com', record: null }, false, 'no-record'],
        ['a record with no email cannot be checked, so it allows',
         { userId: 'u1', tokenEmail: 'a@x.com', record: rec(null) }, true, 'unverifiable'],
        ['a login with no email cannot be checked either, so it allows',
         { userId: 'u1', tokenEmail: null, record: rec('a@x.com') }, true, 'no-token-email'],
        ['matching emails allow',
         { userId: 'u1', tokenEmail: 'a@x.com', record: rec('a@x.com') }, true, 'match'],
        ['a genuine mismatch blocks',
         { userId: 'u1', tokenEmail: 'a@x.com', record: rec('b@x.com') }, false, 'mismatch']
    ])('%s', (_label, input, ok, reason) => {
        expect(decideIdentity(input)).toEqual({ ok, reason });
    });

    test('case and surrounding whitespace do not make a mismatch', () => {
        expect(decideIdentity({
            userId: 'u1', tokenEmail: '  Ann@Example.COM ', record: rec('ann@example.com')
        })).toEqual({ ok: true, reason: 'match' });
    });

    test('lookupError wins over everything, including a real mismatch', () => {
        // Ordering, not a coincidence: a failed read means `record` is null and
        // therefore says nothing. Deciding on it would turn a database blip into
        // a league-wide lockout.
        expect(decideIdentity({
            userId: 'u1', tokenEmail: 'a@x.com', record: rec('b@x.com'), lookupError: true
        })).toEqual({ ok: true, reason: 'lookup-error' });
    });
});

describe('the middleware, against a real record', () => {
    test('a matching login is served', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const res = await request(guardedApp(session(u._id, 'ann@example.com'))).get('/standings');
        expect(res.status).toBe(200);
        expect(res.text).toBe('reached');
    });

    test('a login pointing at ANOTHER manager is blocked — the Cole incident', async () => {
        // Two real managers. The session authenticates as Ann but its pointer
        // resolves to Bob's record, which is exactly the shape of the incident
        // this guard was written for.
        await User.create(player({ email: 'ann@example.com' }));
        const bob = await User.create(player({ firstName: 'Bob', email: 'bob@example.com',
                                               league: 'claunts-league' }));
        const res = await request(guardedApp(session(bob._id, 'ann@example.com'))).get('/standings');
        expect(res.status).toBe(403);
    });

    test('the block page is self-contained and offers a way out', async () => {
        // It renders before the static middleware, so it cannot rely on
        // styles.css — and Log Out is the ONLY escape from a hard gate.
        const bob = await User.create(player({ firstName: 'Bob', email: 'bob@example.com' }));
        const res = await request(guardedApp(session(bob._id, 'ann@example.com')))
            .get('/standings').set('Accept', 'text/html');
        expect(res.status).toBe(403);
        expect(res.headers['content-type']).toMatch(/html/);
        expect(res.text).toContain('href="/logout"');
        expect(res.text).not.toContain('styles.css');
    });

    test('a non-HTML request gets JSON, not a page', async () => {
        const bob = await User.create(player({ firstName: 'Bob', email: 'bob@example.com' }));
        const res = await request(guardedApp(session(bob._id, 'ann@example.com')))
            .get('/users/me').set('Accept', 'application/json');
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('account_not_linked');
    });

    test('a record with no email on file is served, not blocked', async () => {
        // Every record predating the invite flow is in this state.
        const u = await User.create(player());
        const res = await request(guardedApp(session(u._id, 'ann@example.com'))).get('/standings');
        expect(res.status).toBe(200);
    });

    test('a login carrying no email is served, not blocked', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const res = await request(guardedApp(session(u._id, undefined))).get('/standings');
        expect(res.status).toBe(200);
    });

    test('a pointer that resolves to nothing is blocked', async () => {
        const mongoose = require('mongoose');
        const res = await request(guardedApp(session(new mongoose.Types.ObjectId(), 'ann@example.com')))
            .get('/standings');
        expect(res.status).toBe(403);
    });
});

describe('it never locks anyone out by accident', () => {
    test('a logged-out visitor is not gated at all', async () => {
        const res = await request(guardedApp(null)).get('/standings');
        expect(res.status).toBe(200);
    });

    test('a database error fails OPEN', async () => {
        // The whole league behind one failed query is worse than the mismatch
        // this guard exists to catch. Note the record here WOULD mismatch.
        const bob = await User.create(player({ firstName: 'Bob', email: 'bob@example.com' }));
        const app = guardedApp(session(bob._id, 'ann@example.com'), {
            repo: { byAccountId: () => Promise.reject(new Error('db down')) }
        });
        expect((await request(app).get('/standings')).status).toBe(200);
    });

    test('a malformed pointer is a lookup error, not a block', async () => {
        // 'not-an-objectid' makes Mongoose throw a CastError inside the guard's
        // own try. Blocking on it would gate anyone whose claim got mangled.
        const res = await request(guardedApp({
            sub: 'auth0|x', email: 'ann@example.com',
            user_metadata: { roles: [], metadata: { userId: 'not-an-objectid' } }
        })).get('/standings');
        expect(res.status).toBe(200);
    });

    test('a throw inside the lookup is caught and allowed', async () => {
        const app = guardedApp(session('u1', 'ann@example.com'), {
            repo: { byAccountId: () => { throw new Error('boom'); } }
        });
        expect((await request(app).get('/standings')).status).toBe(200);
    });

    test('a throw OUTSIDE the lookup is caught by the outer net and allowed', async () => {
        // The inner try only wraps the database call. This is the last line of
        // defence — a bug anywhere else in the guard must not take the app down
        // for everyone, and it was the one uncovered path left in the module.
        const app = express();
        app.use((req, res, next) => {
            req.oidc = {
                isAuthenticated: () => true,
                get user() { throw new Error('claim parsing blew up'); }
            };
            next();
        });
        app.use(identityGuard({ repo: franchiseRepo }));
        app.use((req, res) => res.status(200).send('reached'));
        expect((await request(app).get('/standings')).status).toBe(200);
    });
});

describe('the verdict is the same from either source (#313 phase 2)', () => {
    // Everything above runs with FRANCHISE_READS unset, which is the production
    // path — and therefore proves nothing about the source the cutover will make
    // permanent. Reviews of #458 kept finding evidence that only reached one
    // branch; this is the other one.
    //
    // For THIS middleware the stakes are not a wrong number on a page. A verdict
    // that differs between the two sources is either a manager locked out of the
    // app or a session served someone else's franchise.
    const migration = require('../modules/account-migration');
    const ORIGINAL = process.env.FRANCHISE_READS;
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.FRANCHISE_READS;
        else process.env.FRANCHISE_READS = ORIGINAL;
    });

    async function statusBothWays(userId, email, path) {
        const out = {};
        for (const flag of ['false', 'true']) {
            process.env.FRANCHISE_READS = flag;
            out[flag] = (await request(guardedApp(session(userId, email))).get(path || '/standings')).status;
        }
        return out;
    }

    test('a matching login is served from accounts too', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        await migration.migrate({ apply: true });
        const got = await statusBothWays(u._id, 'ann@example.com');
        expect(got).toEqual({ false: 200, true: 200 });
    });

    test('a mismatched login is blocked by both', async () => {
        await User.create(player({ email: 'ann@example.com' }));
        const bob = await User.create(player({ firstName: 'Bob', email: 'bob@example.com' }));
        await migration.migrate({ apply: true });
        const got = await statusBothWays(bob._id, 'ann@example.com');
        expect(got).toEqual({ false: 403, true: 403 });
    });

    test('a record with no email is served by both, not blocked by one', async () => {
        // The asymmetric case. If the account read dropped `email`, this record
        // would look unverifiable and be ALLOWED where it should be — but a
        // mismatched one would be allowed too. The test above is what catches
        // that; this one catches the opposite, a dropped field turning into a
        // block for every pre-invite-era record in the league.
        const u = await User.create(player());
        await migration.migrate({ apply: true });
        const got = await statusBothWays(u._id, 'ann@example.com');
        expect(got).toEqual({ false: 200, true: 200 });
    });

    test('a pointer resolving to nothing is blocked by both', async () => {
        const mongoose = require('mongoose');
        await User.create(player({ email: 'ann@example.com' }));
        await migration.migrate({ apply: true });
        const got = await statusBothWays(new mongoose.Types.ObjectId(), 'ann@example.com');
        expect(got).toEqual({ false: 403, true: 403 });
    });

    test('the read asks for email and gets email, from either source', async () => {
        // Directly, rather than only through a status code: a 200 can mean
        // "matched" or "nothing to compare", and those are very different.
        const u = await User.create(player({ email: 'ann@example.com' }));
        await migration.migrate({ apply: true });
        for (const flag of ['false', 'true']) {
            process.env.FRANCHISE_READS = flag;
            const rec = await franchiseRepo.byAccountId(u._id, { fields: ['email'] });
            expect(rec.email).toBe('ann@example.com');
            expect(String(rec._id)).toBe(String(u._id));
            expect(decideIdentity({ userId: u._id, tokenEmail: 'ann@example.com', record: rec }))
                .toEqual({ ok: true, reason: 'match' });
        }
    });
});

describe('the paths that stay open to a blocked session', () => {
    // A blocked session still has to be able to load the block page's own
    // assets, reach its invite link, and log out.
    const deadPointer = { repo: { byAccountId: async () => null } };
    const unlinked = { sub: 'auth0|new', email: 'ann@example.com', user_metadata: {} };

    test.each([
        ['/season-preview'], ['/favicon.ico'], ['/profile'],
        ['/images/logo.png'], ['/invite/TOKEN'],
        ['/styles.css'], ['/app.js'], ['/fonts/x.woff2'], ['/data.json']
    ])('%s is served', async (path) => {
        expect((await request(guardedApp(unlinked, deadPointer)).get(path)).status).toBe(200);
    });

    test('but an ordinary page is not', async () => {
        expect((await request(guardedApp(unlinked, deadPointer)).get('/standings')).status).toBe(403);
    });
});
