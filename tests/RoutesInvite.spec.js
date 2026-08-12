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
const inviteClaim = require('../modules/invite-claim');

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

    // Without an email, invite-bind has nothing to check a claimer against and
    // the first person to open the link takes the franchise. New records don't
    // get to be born that way.
    test('refuses to create a franchise with no email', async () => {
        const res = await request(managerApp).post('/users')
            .send({ firstName: 'Bo', lastName: 'Fox', league: LEAGUE });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/email is required/i);
        expect(await User.countDocuments({ firstName: 'Bo' })).toBe(0);
    });

    // canManageLeague() waves an Admin through whatever it's handed, undefined
    // included, so without this a client that forgot the league created a member
    // belonging to neither one — present in the database, absent from every list.
    test.each([
        ['missing', undefined],
        ['unknown', 'not-a-league'],
        ['empty', '']
    ])('refuses a %s league even for an Admin', async (_label, league) => {
        const res = await request(adminApp).post('/users')
            .send({ firstName: 'Rae', lastName: 'Tester', email: 'rae@example.com', league });
        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/valid league/i);
        expect(await User.countDocuments({ firstName: 'Rae' })).toBe(0);
    });

    test('refuses a blank or whitespace-only email', async () => {
        const res = await request(managerApp).post('/users')
            .send({ firstName: 'Bo', lastName: 'Fox', league: LEAGUE, email: '   ' });
        expect(res.status).toBe(400);
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
                .send({ firstName: 'Late', lastName: 'Joiner', league: LEAGUE, email: 'late@example.com' });
            expect(res.status).toBe(201);
        });

        // The lock is per-league: the other league being underway is irrelevant.
        test('a manager can still add to a league that has not started', async () => {
            await User.create(player({ league: OTHER, seasons: scoredSeason() }));
            const res = await request(managerApp).post('/users')
                .send({ firstName: 'Early', lastName: 'Bird', league: LEAGUE, email: 'early@example.com' });
            expect(res.status).toBe(201);
        });
    });
});

describe('auth-sub backfill', () => {
    const { shouldRecord, recordAuthSub } = require('../modules/auth-sub-backfill');

    test('records only when a sub is present and the record has none', () => {
        expect(shouldRecord({ authSub: null }, 'auth0|1')).toBe(true);
        expect(shouldRecord({}, 'auth0|1')).toBe(true);
        expect(shouldRecord({ authSub: 'auth0|old' }, 'auth0|1')).toBe(false);  // never overwrite
        expect(shouldRecord({ authSub: null }, undefined)).toBe(false);
        expect(shouldRecord(null, 'auth0|1')).toBe(false);
    });

    test('fills a blank binding', async () => {
        const u = await User.create(player());
        expect(await recordAuthSub(User, u._id, 'auth0|seen')).toBe(true);
        expect((await User.findById(u._id).lean()).authSub).toBe('auth0|seen');
    });

    // The guard lives in the update filter, not just the predicate, so a second
    // login can't quietly take over a franchise someone already claimed.
    test('refuses to overwrite a binding that already exists', async () => {
        const u = await User.create(player({ authSub: 'auth0|first' }));
        expect(await recordAuthSub(User, u._id, 'auth0|second')).toBe(false);
        expect((await User.findById(u._id).lean()).authSub).toBe('auth0|first');
    });

    test('is idempotent — the second sighting writes nothing', async () => {
        const u = await User.create(player());
        expect(await recordAuthSub(User, u._id, 'auth0|seen')).toBe(true);
        expect(await recordAuthSub(User, u._id, 'auth0|seen')).toBe(false);
    });

    test('never throws on bad input or a broken model', async () => {
        expect(await recordAuthSub(User, null, 'auth0|1')).toBe(false);
        expect(await recordAuthSub(User, 'not-an-objectid', 'auth0|1')).toBe(false);
        expect(await recordAuthSub(null, 'x', 'auth0|1')).toBe(false);
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

// POST /invite/resolve — the endpoint the Auth0 post-login Action calls while
// the ID token is still being assembled. Mounted here the same way server.js
// mounts it, since what it answers ends up in the first token an invitee holds.
describe('POST /invite/resolve', () => {
    const requireAuthOrToken = require('../modules/require-auth');
    const { leagueFlagFor } = require('../modules/league-access');

    process.env.INTERNAL_API_TOKEN = 'test-internal-token';

    const resolveApp = express();
    resolveApp.use(express.json());
    resolveApp.post('/invite/resolve', requireAuthOrToken.internalOnly, async (req, res) => {
        const invite = inviteToken.verify(req.body.token, process.env.AUTH_SECRET);
        let record = null;
        if (invite) record = await User.findById(invite.userId).lean();
        const decision = inviteClaim.decideInvite({
            invite, sub: req.body.sub, tokenEmail: req.body.email,
            sessionUserId: req.body.currentUserId || null, record, lookupError: false
        });
        if (decision.action !== 'claim') {
            return res.json({ claimed: false, reason: decision.reason,
                message: decision.action === 'refuse' ? inviteClaim.refusalMessage(decision.reason) : null });
        }
        const w = await User.updateOne(
            { _id: invite.userId, $or: [{ authSub: { $exists: false } }, { authSub: null }, { authSub: '' }] },
            { $set: { authSub: req.body.sub, email: record.email || req.body.email } });
        if ((w.modifiedCount || 0) !== 1) {
            return res.json({ claimed: false, reason: 'already-claimed' });
        }
        res.json({ claimed: true, userId: String(invite.userId),
            league: leagueFlagFor(record.league || invite.league || '') });
    });

    const post = (body, token = 'test-internal-token') =>
        request(resolveApp).post('/invite/resolve').set('X-Internal-Token', token).send(body);

    const claim = (u, over) => Object.assign(
        { token: inviteToken.sign({ userId: u._id, league: u.league }, process.env.AUTH_SECRET),
          sub: 'auth0|new', email: u.email }, over);

    // Mid-login there is no session, so a session must never be accepted here —
    // it would let any signed-in member run tokens against the claim rules.
    test('401s without the internal token', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        expect((await post(claim(u), 'wrong')).status).toBe(401);
        expect((await request(resolveApp).post('/invite/resolve').send(claim(u))).status).toBe(401);
    });

    test('claims the franchise and answers with what belongs in the token', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const res = await post(claim(u));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ claimed: true, userId: String(u._id), league: 'gg' });
        expect((await User.findById(u._id).lean()).authSub).toBe('auth0|new');

        // The shape has to survive the Action re-nesting it — this is what the
        // app actually reads back, and where a wrong league would hide.
        const oidcUser = { user_metadata: { roles: [], metadata: { userId: res.body.userId, league: res.body.league } } };
        expect(leagueCodeFor(oidcUser)).toBe(LEAGUE);
    });

    test.each([
        ['claunts-league', 'cl'],
        ['graham-league', 'gg']
    ])('answers the Auth0 league flag for %s, not the Mongo code', async (league, flag) => {
        const u = await User.create(player({ league, email: 'ann@example.com' }));
        expect((await post(claim(u))).body.league).toBe(flag);
    });

    test('refuses a spent link without touching the existing binding', async () => {
        const u = await User.create(player({ email: 'ann@example.com', authSub: 'auth0|first' }));
        const res = await post(claim(u, { sub: 'auth0|second' }));
        expect(res.body).toMatchObject({ claimed: false, reason: 'already-claimed' });
        expect(res.body.message).toMatch(/already been used/i);
        expect((await User.findById(u._id).lean()).authSub).toBe('auth0|first');
    });

    test('refuses a forwarded link claimed from another address', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const res = await post(claim(u, { email: 'mallory@example.com' }));
        expect(res.body).toMatchObject({ claimed: false, reason: 'email-mismatch' });
        expect((await User.findById(u._id).lean()).authSub).toBeUndefined();
    });

    test.each([
        ['expired', (u) => inviteToken.sign({ userId: u._id, league: u.league }, process.env.AUTH_SECRET, -1000)],
        ['tampered', (u) => inviteToken.sign({ userId: u._id, league: u.league }, process.env.AUTH_SECRET) + 'XX'],
        ['garbage', () => 'not-a-token']
    ])('refuses an %s token', async (_label, mint) => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const res = await post({ token: mint(u), sub: 'auth0|new', email: u.email });
        expect(res.body.claimed).toBe(false);
        expect((await User.findById(u._id).lean()).authSub).toBeUndefined();
    });

    test('never repoints a login that already has a franchise', async () => {
        const u = await User.create(player({ email: 'ann@example.com' }));
        const res = await post(claim(u, { currentUserId: 'someone-else' }));
        expect(res.body).toMatchObject({ claimed: false, reason: 'already-linked' });
        expect((await User.findById(u._id).lean()).authSub).toBeUndefined();
    });

    test('records the address on first use when the franchise had none', async () => {
        const u = await User.create(player());   // no email
        const res = await post(claim(u, { email: 'new@example.com' }));
        expect(res.body.claimed).toBe(true);
        expect((await User.findById(u._id).lean()).email).toBe('new@example.com');
    });
});
