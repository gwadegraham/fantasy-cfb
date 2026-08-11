// HTTP-level tests for the invite endpoints and the season lock on player
// creation. Real handlers, real validation, in-memory Mongo — same bare-app
// pattern as RoutesJobRuns.spec.js (no Auth0; the server's auth tiers are
// covered in Permissions.spec.js).
//
// The distinction under test throughout: CREATING a franchise mid-season is
// destructive and locked, INVITING an existing one is not. Conflating those
// would either let a manager quietly distort the standings in week 10, or lock a
// locked-out member out of their own team until January.

process.env.YEAR = '2026';
process.env.AUTH_SECRET = 'test-auth-secret';
process.env.URL = 'https://campusclash.io';

const express = require('express');
const request = require('supertest');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const usersRouter = require('../routes/users');
const inviteToken = require('../modules/invite-token');
const { leagueCodeFor } = require('../modules/league-access');

// A League Manager for graham-league: can manage their own league, not the other.
function appAs(roles, leagueFlag) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.oidc = {
            isAuthenticated: () => true,
            user: { user_metadata: { roles, metadata: { league: leagueFlag } } }
        };
        next();
    });
    app.use('/users', usersRouter);
    return app;
}

const managerApp = appAs(['League Manager'], 'gg');   // graham-league
const adminApp = appAs(['Admin'], 'gg');
const memberApp = appAs([], 'gg');                    // no commissioner role

useMongo();

const LEAGUE = 'graham-league';
const OTHER = 'claunts-league';
const SEASON = 2026;

function player(over) {
    return Object.assign({
        firstName: 'Ann', lastName: 'Lee', league: LEAGUE,
        seasons: [{ season: SEASON }]
    }, over);
}

// hasScoredGames keys off a scoreByTeam entry, so seed one to make the season
// look underway (see RosterCorrection.spec.js, which does the same).
function scoredSeason() {
    return [{
        season: SEASON,
        weeklyScore: [{ week: 1, score: 5, scoreByTeam: [{ team: 'Iowa', teamId: 1, gameId: 100, score: 5 }] }]
    }];
}

describe('POST /users/:id/invite-link', () => {
    test('returns a signed link that resolves back to the franchise', async () => {
        const u = await User.create(player());
        const res = await request(managerApp).post(`/users/${u._id}/invite-link`);

        expect(res.status).toBe(200);
        expect(res.body.link).toContain('https://campusclash.io/invite/');
        expect(res.body.expiresInDays).toBe(14);
        expect(res.body.alreadyClaimed).toBe(false);

        const token = res.body.link.split('/invite/')[1];
        expect(inviteToken.verify(token, process.env.AUTH_SECRET))
            .toEqual({ userId: String(u._id), league: LEAGUE });
    });

    test('404s for a franchise that does not exist', async () => {
        const res = await request(managerApp).post('/users/507f1f77bcf86cd799439011/invite-link');
        expect(res.status).toBe(404);
    });

    test('a League Manager cannot mint a link for another league', async () => {
        const u = await User.create(player({ league: OTHER }));
        const res = await request(managerApp).post(`/users/${u._id}/invite-link`);
        expect(res.status).toBe(403);
    });

    test('an Admin can mint a link for any league', async () => {
        const u = await User.create(player({ league: OTHER }));
        const res = await request(adminApp).post(`/users/${u._id}/invite-link`);
        expect(res.status).toBe(200);
    });

    test('a plain member cannot mint a link at all', async () => {
        const u = await User.create(player());
        const res = await request(memberApp).post(`/users/${u._id}/invite-link`);
        expect(res.status).toBe(403);
    });

    // The whole reason inviting is separated from creating: someone loses access
    // to their login in week 6 and needs a way back in.
    test('still works once the season is underway', async () => {
        const u = await User.create(player({ seasons: scoredSeason() }));
        const res = await request(managerApp).post(`/users/${u._id}/invite-link`);
        expect(res.status).toBe(200);
        expect(res.body.link).toBeDefined();
    });

    test('flags a franchise that already has a login bound', async () => {
        const u = await User.create(player({ authSub: 'auth0|existing' }));
        const res = await request(managerApp).post(`/users/${u._id}/invite-link`);
        expect(res.status).toBe(200);
        expect(res.body.alreadyClaimed).toBe(true);
    });
});

describe('DELETE /users/:id/invite-link', () => {
    test('clears the binding so a fresh invite can be claimed', async () => {
        const u = await User.create(player({ authSub: 'auth0|old' }));
        const res = await request(managerApp).delete(`/users/${u._id}/invite-link`);
        expect(res.status).toBe(200);
        expect((await User.findById(u._id).lean()).authSub).toBeUndefined();
    });

    test('a League Manager cannot reset another league', async () => {
        const u = await User.create(player({ league: OTHER, authSub: 'auth0|old' }));
        const res = await request(managerApp).delete(`/users/${u._id}/invite-link`);
        expect(res.status).toBe(403);
        expect((await User.findById(u._id).lean()).authSub).toBe('auth0|old');
    });
});

describe('POST /users', () => {
    test('persists the email, lower-cased', async () => {
        const res = await request(managerApp).post('/users')
            .send({ firstName: 'Ann', lastName: 'Lee', league: LEAGUE, email: '  Ann@Example.COM ' });
        expect(res.status).toBe(201);
        expect((await User.findById(res.body._id).lean()).email).toBe('ann@example.com');
    });

    test('email stays optional', async () => {
        const res = await request(managerApp).post('/users')
            .send({ firstName: 'Bo', lastName: 'Fox', league: LEAGUE });
        expect(res.status).toBe(201);
        expect((await User.findById(res.body._id).lean()).email).toBeUndefined();
    });

    describe('once the season is underway', () => {
        // A franchise added now starts with an empty roster and sits on zero,
        // which quietly distorts every ranking — same class of change as a
        // season-roster edit, so it gets the same lock.
        test('a League Manager is locked out with 423', async () => {
            await User.create(player({ seasons: scoredSeason() }));
            const res = await request(managerApp).post('/users')
                .send({ firstName: 'Late', lastName: 'Joiner', league: LEAGUE });
            expect(res.status).toBe(423);
            expect(res.body.message).toMatch(/locked once the season is underway/i);
            expect(await User.countDocuments({ firstName: 'Late' })).toBe(0);
        });

        test('an Admin may still add (they can rescore afterwards)', async () => {
            await User.create(player({ seasons: scoredSeason() }));
            const res = await request(adminApp).post('/users')
                .send({ firstName: 'Late', lastName: 'Joiner', league: LEAGUE });
            expect(res.status).toBe(201);
        });

        // The lock is per-league: the other league being underway is irrelevant.
        test('a manager can still add to a league that has not started', async () => {
            await User.create(player({ league: OTHER, seasons: scoredSeason() }));
            const res = await request(managerApp).post('/users')
                .send({ firstName: 'Early', lastName: 'Bird', league: LEAGUE });
            expect(res.status).toBe(201);
        });
    });
});

// The middleware that actually claims the invite. This is the part that writes
// to Auth0 and to Mongo, so it gets exercised against a real DB with the
// Management API stubbed — a bug here strands a real person mid-signup.
describe('inviteBind middleware', () => {
    const { inviteBind, COOKIE } = require('../modules/invite-bind');

    // Builds an app whose session is `oidcUser` (null = logged out), with the
    // middleware mounted ahead of a sentinel route.
    function bindApp(oidcUser, management) {
        const app = express();
        app.use((req, res, next) => {
            req.oidc = { isAuthenticated: () => !!oidcUser, user: oidcUser };
            next();
        });
        app.use(inviteBind({
            User, management, inviteToken,
            secret: () => process.env.AUTH_SECRET
        }));
        app.get('/anything', (req, res) => res.status(200).send('passed-through'));
        return app;
    }

    const okManagement = () => ({ patchUserMetadata: jest.fn(async () => ({})) });
    const session = (over) => Object.assign({ sub: 'auth0|new', email: 'ann@example.com', user_metadata: {} }, over);
    const tokenFor = (u) => inviteToken.sign({ userId: u._id, league: u.league }, process.env.AUTH_SECRET);

    test('passes straight through when there is no invite cookie', async () => {
        const res = await request(bindApp(session(), okManagement())).get('/anything');
        expect(res.status).toBe(200);
        expect(res.text).toBe('passed-through');
    });

    test('binds the signed-in identity to the franchise and re-logins for a fresh token', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const management = okManagement();

        const res = await request(bindApp(session(), management))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);

        // A re-login is required: the current ID token predates the PATCH, so it
        // still carries no franchise pointer.
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?returnTo=%2Fstandings');

        // Shape matters twice over, and both are invisible at runtime:
        //   - TOP-LEVEL, not nested under `metadata`. The post-login Action wraps
        //     the whole user_metadata as the token's `metadata`, so nesting here
        //     would surface as metadata.metadata.userId and bind nothing.
        //   - the league FLAG ('gg'), not the Mongo code ('graham-league').
        //     leagueCodeFor reads anything that isn't 'gg' as claunts, so the
        //     wrong vocabulary files the member into the other league silently.
        expect(management.patchUserMetadata).toHaveBeenCalledWith('auth0|new', {
            userId: String(u._id),
            league: 'gg'
        });
        const saved = await User.findById(u._id).lean();
        expect(saved.authSub).toBe('auth0|new');
    });

    // The write and the read are separated by an Auth0 Action that lives in the
    // dashboard, not this repo, so nothing else in the suite connects them. This
    // replays what the Action does — claim = { roles, metadata: user_metadata } —
    // and asserts the app resolves the member back to the league we started from.
    // Both shipped bugs (nesting one level too deep, and writing the Mongo league
    // code instead of the Auth0 flag) fail here and nowhere else.
    test.each([
        ['graham-league', 'gg'],
        ['claunts-league', 'cl']
    ])('what it writes for %s round-trips back through the app read path', async (league, flag) => {
        const u = await User.create(player({ league, email: 'ann@example.com' }));
        const management = okManagement();

        await request(bindApp(session(), management))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);

        const written = management.patchUserMetadata.mock.calls[0][1];
        expect(written.league).toBe(flag);

        // Exactly what "Post Login Add Metadata" builds.
        const oidcUser = { user_metadata: { roles: [], metadata: written } };

        expect(leagueCodeFor(oidcUser)).toBe(league);
        expect(oidcUser.user_metadata.metadata.userId).toBe(String(u._id));
    });

    test('records the email on first use when the franchise had none', async () => {
        const u = await User.create(player());   // no email
        await request(bindApp(session({ email: 'new@example.com' }), okManagement()))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);
        expect((await User.findById(u._id).lean()).email).toBe('new@example.com');
    });

    test('refuses a forwarded link claimed from a different address', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const management = okManagement();

        const res = await request(bindApp(session({ email: 'mallory@example.com' }), management))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);

        expect(res.status).toBe(403);
        expect(res.text).toContain('different email address');
        expect(management.patchUserMetadata).not.toHaveBeenCalled();
        expect((await User.findById(u._id).lean()).authSub).toBeUndefined();
    });

    test('refuses a link that has already been spent', async () => {
        const u = await User.create(player({ email: 'ann@example.com', authSub: 'auth0|first' }));
        const res = await request(bindApp(session({ sub: 'auth0|second' }), okManagement()))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);

        expect(res.status).toBe(403);
        expect(res.text).toContain('already been used');
        expect((await User.findById(u._id).lean()).authSub).toBe('auth0|first');   // unchanged
    });

    // Auth0 rejecting the write must not look like success, and must not leave a
    // half-bound record behind.
    test('surfaces a Management API failure without binding', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const management = { patchUserMetadata: jest.fn(async () => { throw new Error('boom'); }) };

        const res = await request(bindApp(session(), management))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);

        expect(res.status).toBe(500);
        expect(res.text).toContain('couldn’t finish setting up');
        expect((await User.findById(u._id).lean()).authSub).toBeUndefined();
    });

    test('waits for the login instead of acting on a logged-out request', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const management = okManagement();
        const res = await request(bindApp(null, management))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);

        expect(res.status).toBe(200);
        expect(management.patchUserMetadata).not.toHaveBeenCalled();
    });

    test('drops a garbage cookie and carries on rather than erroring', async () => {
        const res = await request(bindApp(session(), okManagement()))
            .get('/anything').set('Cookie', `${COOKIE}=not-a-real-token`);
        expect(res.status).toBe(200);
        expect(res.headers['set-cookie'].join()).toMatch(new RegExp(COOKIE + '=;'));
    });

    test('never repoints a session that already resolves to a franchise', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const management = okManagement();
        const linked = session({ user_metadata: { metadata: { userId: 'someone-else' } } });

        const res = await request(bindApp(linked, management))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);

        expect(res.status).toBe(200);
        expect(management.patchUserMetadata).not.toHaveBeenCalled();
    });

    // A stale cookie after the round-trip must not 403 the person who just
    // successfully claimed the franchise.
    test('is a no-op for the identity that already owns the franchise', async () => {
        const u = await User.create(player({ email: 'ann@example.com', authSub: 'auth0|new' }));
        const res = await request(bindApp(session(), okManagement()))
            .get('/anything').set('Cookie', `${COOKIE}=${tokenFor(u)}`);
        expect(res.status).toBe(200);
    });
});

describe('GET /users/league/:league/roster', () => {
    test('reports who has a login bound, without leaking the sub', async () => {
        await User.create(player({ firstName: 'Linked', authSub: 'auth0|1', email: 'a@b.com' }));
        await User.create(player({ firstName: 'Unlinked' }));

        const res = await request(managerApp).get(`/users/league/${LEAGUE}/roster`);
        expect(res.status).toBe(200);

        const linked = res.body.players.find(p => p.firstName === 'Linked');
        const unlinked = res.body.players.find(p => p.firstName === 'Unlinked');
        expect(linked.linked).toBe(true);
        expect(unlinked.linked).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('auth0|1');
    });

    // An Admin is never `locked`, but still needs to know the season has started
    // before adding someone onto an empty roster — so the two are separate flags.
    test('reports seasonUnderway separately from locked', async () => {
        await User.create(player({ seasons: scoredSeason() }));

        const asManager = await request(managerApp).get(`/users/league/${LEAGUE}/roster`);
        expect(asManager.body.seasonUnderway).toBe(true);
        expect(asManager.body.locked).toBe(true);

        const asAdmin = await request(adminApp).get(`/users/league/${LEAGUE}/roster`);
        expect(asAdmin.body.seasonUnderway).toBe(true);
        expect(asAdmin.body.locked).toBe(false);
    });
});
