// Per-league commissioners (#600): League.commissioners, read through the
// season cache by every authority check.
//
// What this file pins, in the order it matters:
//
//   1. A commissioner of a league may manage THAT league and no other —
//      canManageLeague, the write gate, and the draft room all agree.
//   2. The Auth0 League Manager flag still works exactly as before; the list
//      is additive.
//   3. /hoops/admin opens to a basketball league's commissioner with League
//      setup only — never the platform-wide data tasks — and stays a 404 for
//      anyone running no basketball league.
//   4. Fail soft: no list, or an unprimed cache, is "Admins only", never a
//      throw.
//
// The list is set straight on the document and the cache re-primed, the way
// the Admin PUT does it (that route is tested in LeagueAdmin.spec.js).

const express = require('express');
const path = require('path');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const { canManageLeague, managedLeagues } = require('../modules/league-access');
const requireCommissioner = require('../modules/require-commissioner');
const { isCommissionerOf } = require('../modules/draft-socket');
const hoopsAdmin = require('../routes/hoopsAdmin');

useMongo();

const HOOPS = 'claunts-hoops';
const OTHER_HOOPS = 'hardwood-heroes';
const JEFF = new mongoose.Types.ObjectId();

// A request as the routes see it. `league` is the Auth0 flag ('gg' | 'cl').
function reqFor({ roles = [], accountId = JEFF, league = 'cl', cookie } = {}) {
    const user = { user_metadata: { roles, metadata: { userId: accountId ? String(accountId) : undefined, league } } };
    return {
        oidc: { isAuthenticated: () => true, user },
        effUser: user,
        headers: cookie ? { cookie } : {},
        get: () => undefined
    };
}

async function appoint(code, ids) {
    await League.updateOne({ code }, { $set: { commissioners: ids } });
    await seasons.prime();
}

beforeEach(async () => {
    seasons._reset();
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' },
                              { sport: 'basketball', season: 2027, status: 'preseason' }]);
    await League.create([
        { code: 'graham-league', name: 'The Polar Depressed', sport: 'football' },
        { code: 'claunts-league', name: 'Goofballers', sport: 'football' },
        { code: HOOPS, name: 'Claunts Hoops', sport: 'basketball' },
        { code: OTHER_HOOPS, name: 'Hardwood Heroes', sport: 'basketball' }
    ]);
    await seasons.prime();
});
afterEach(() => { jest.restoreAllMocks(); seasons._reset(); });

describe('canManageLeague', () => {
    test('a commissioner manages their league, and only that one', async () => {
        await appoint(HOOPS, [JEFF]);
        const req = reqFor();     // no role at all
        expect(canManageLeague(req, HOOPS)).toBe(true);
        expect(canManageLeague(req, OTHER_HOOPS)).toBe(false);
        expect(canManageLeague(req, 'graham-league')).toBe(false);
        expect(canManageLeague(req, 'claunts-league')).toBe(false);
    });

    test("a League Manager keeps their flag's league and gains the listed one", async () => {
        await appoint(HOOPS, [JEFF]);
        const req = reqFor({ roles: ['League Manager'] });
        expect(canManageLeague(req, 'claunts-league')).toBe(true);
        expect(canManageLeague(req, HOOPS)).toBe(true);
        expect(canManageLeague(req, OTHER_HOOPS)).toBe(false);
        expect(canManageLeague(req, 'graham-league')).toBe(false);
        expect(managedLeagues(req)).toEqual(['claunts-league', HOOPS]);
    });

    test("a member of the league who is not on its list manages nothing", async () => {
        await appoint(HOOPS, [new mongoose.Types.ObjectId()]);
        expect(canManageLeague(reqFor(), HOOPS)).toBe(false);
        expect(managedLeagues(reqFor())).toEqual([]);
    });

    test('an Admin manages every league, listed or not', () => {
        const req = reqFor({ roles: ['Admin'] });
        expect(canManageLeague(req, HOOPS)).toBe(true);
        expect(canManageLeague(req, OTHER_HOOPS)).toBe(true);
    });

    // The invariant tests/LeagueSelection.spec.js pins for the flag holds for
    // the list too: the cookie picks what to VIEW, never what to run.
    test('viewing a league grants nothing', async () => {
        await appoint(HOOPS, [JEFF]);
        const req = reqFor({ cookie: `cc_league=${OTHER_HOOPS}` });
        expect(canManageLeague(req, OTHER_HOOPS)).toBe(false);
    });

    // A code from the URL that names an Object.prototype member used to
    // reach `.slice` on a function and throw — before most handlers' try,
    // which kills the process (#600 review).
    test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])('a league code of %s is just a league nobody runs', async (code) => {
        await appoint(HOOPS, [JEFF]);
        expect(() => canManageLeague(reqFor(), code)).not.toThrow();
        expect(canManageLeague(reqFor(), code)).toBe(false);
        expect(seasons.commissionersOf(code)).toEqual([]);
        expect(isCommissionerOf({ userId: String(JEFF), role: '' }, code)).toBe(false);
    });

    test('fail soft: an unprimed cache is Admins only, and nothing throws', async () => {
        await appoint(HOOPS, [JEFF]);
        seasons._reset();
        expect(canManageLeague(reqFor(), HOOPS)).toBe(false);
        expect(managedLeagues(reqFor())).toEqual([]);
    });

    // dev-role's spoof swaps the ROLE, not the person: an Admin previewing a
    // League Manager keeps the leagues that name them, which is what lets the
    // create-then-run flow be previewed at all.
    test('a dev role-spoof keeps the account\'s appointments', async () => {
        const admin = new mongoose.Types.ObjectId();
        await appoint(HOOPS, [admin]);
        const cookie = 'cc_spoof=' + encodeURIComponent(JSON.stringify({ roles: ['League Manager'], league: 'cl' }));
        const req = reqFor({ roles: ['Admin'], accountId: admin, cookie });
        expect(canManageLeague(req, HOOPS)).toBe(true);
        expect(canManageLeague(req, OTHER_HOOPS)).toBe(false);
    });
});

describe('the write gate (requireCommissioner)', () => {
    const gate = (req) => {
        const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json() { return this; } };
        const next = jest.fn();
        requireCommissioner(req, res, next);
        return next.mock.calls.length ? 'next' : res.statusCode;
    };
    test("lets a listed commissioner through without the Auth0 role; the handler scopes them", async () => {
        expect(gate(reqFor())).toBe(403);
        await appoint(HOOPS, [JEFF]);
        expect(gate(reqFor())).toBe('next');
    });
});

// The two /users writes only the jobs make. Their handlers check no league,
// so a role-less commissioner passing the role gate could rewrite scores and
// rosters in any league; server.js sends them to requireAdmin instead.
describe('job-only /users writes', () => {
    const { jobOnlyUsersWrite } = requireCommissioner;
    const r = (method, baseUrl, p) => ({ method, baseUrl, path: p });
    test('PATCH /users/:id and /users/draft/:id are job-only', () => {
        expect(jobOnlyUsersWrite(r('PATCH', '/users', '/64b000000000000000000001'))).toBe(true);
        expect(jobOnlyUsersWrite(r('PATCH', '/users', '/draft/64b000000000000000000001'))).toBe(true);
    });
    test('the self-service and league-checked PATCHes are not', () => {
        ['/me/profile', '/me/captain', '/me/push/prefs', '/64b0/captain', '/64b0/roster-team']
            .forEach(p => expect(jobOnlyUsersWrite(r('PATCH', '/users', p))).toBe(false));
        expect(jobOnlyUsersWrite(r('POST', '/users', '/64b0'))).toBe(false);
        expect(jobOnlyUsersWrite(r('PATCH', '/draft', '/64b0'))).toBe(false);
    });
    test('server.js routes them to requireAdmin, ahead of the commissioner gate', () => {
        const src = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        const at = src.indexOf('requireCommissioner.jobOnlyUsersWrite(req)) return requireAdmin(req, res, next)');
        expect(at).toBeGreaterThan(-1);
        expect(at).toBeLessThan(src.indexOf('return requireCommissioner(req, res, next);', at));
    });
});

describe('the draft room (isCommissionerOf)', () => {
    // A token as /draft-token mints it: account id, role, the flag's league.
    const token = (extra) => Object.assign({ userId: String(JEFF), role: '', league: 'claunts-league' }, extra);

    test("a commissioner controls their league's draft, and only that one", async () => {
        await appoint(HOOPS, [JEFF]);
        expect(isCommissionerOf(token(), HOOPS)).toBe(true);
        expect(isCommissionerOf(token(), OTHER_HOOPS)).toBe(false);
        expect(isCommissionerOf(token(), 'claunts-league')).toBe(false);
    });

    test('a League Manager keeps their own room by the token, and not another', () => {
        const lm = token({ role: 'League Manager' });
        expect(isCommissionerOf(lm, 'claunts-league')).toBe(true);
        expect(isCommissionerOf(lm, HOOPS)).toBe(false);
    });

    // Checked live, not baked into the six-hour token.
    test('removing a commissioner takes the controls away on the next action', async () => {
        await appoint(HOOPS, [JEFF]);
        const t = token();
        expect(isCommissionerOf(t, HOOPS)).toBe(true);
        await appoint(HOOPS, []);
        expect(isCommissionerOf(t, HOOPS)).toBe(false);
    });

});

describe('/hoops/admin for a commissioner', () => {
    function appAs(req, viewing) {
        const a = express();
        a.set('views', path.join(__dirname, '..', 'views'));
        a.set('view engine', 'ejs');
        a.use((r, res, next) => { Object.assign(r, { oidc: req.oidc, effUser: req.effUser }); r.headers = Object.assign(r.headers, req.headers); next(); });
        a.use('/hoops/admin', hoopsAdmin.build({
            pageLocals: () => ({ user: { userId: String(JEFF), firstName: 'Jeff', role: '' }, userState: '{}',
                viewerLeagueCode: viewing, draftDefaults: '{}' })
        }));
        a.use((r, res) => res.status(404).send('Not found'));
        return a;
    }

    test("gets League setup for their league, and none of the data tasks", async () => {
        await appoint(HOOPS, [JEFF]);
        const res = await request(appAs(reqFor())).get('/hoops/admin');
        expect(res.status).toBe(200);
        expect(res.text).toContain(`window.ADMIN_LEAGUE = "${HOOPS}"`);
        expect(res.text).toContain('src="/admin.js"');
        expect(res.text).not.toContain('src="/hoopsAdmin.js"');
        expect(res.text).not.toContain('src="/hoopsPreseason.js"');
        expect(res.text).not.toContain('id="hoops-admin"');
        // No role, so no Create league either.
        expect(res.text).not.toContain('href="/leagues"');
    });

    test('a League Manager running one gets the Leagues link too', async () => {
        await appoint(HOOPS, [JEFF]);
        const res = await request(appAs(reqFor({ roles: ['League Manager'] }))).get('/hoops/admin');
        expect(res.status).toBe(200);
        expect(res.text).toContain('href="/leagues"');
    });

    test("manages the league they run even while viewing someone else's", async () => {
        await appoint(HOOPS, [JEFF]);
        const res = await request(appAs(reqFor(), OTHER_HOOPS)).get('/hoops/admin');
        expect(res.status).toBe(200);
        expect(res.text).toContain(`window.ADMIN_LEAGUE = "${HOOPS}"`);
        expect(res.text).not.toContain('Hardwood Heroes');
    });

    test('the data routes stay Admin-only', async () => {
        await appoint(HOOPS, [JEFF]);
        expect((await request(appAs(reqFor())).get('/hoops/admin/status')).status).toBe(404);
        expect((await request(appAs(reqFor())).get('/hoops/admin/preseason')).status).toBe(404);
    });

    test('a 404 for a commissioner of a different league, and for a football League Manager', async () => {
        await appoint(OTHER_HOOPS, [new mongoose.Types.ObjectId()]);
        await appoint('graham-league', [JEFF]);
        expect((await request(appAs(reqFor())).get('/hoops/admin')).status).toBe(404);
        expect((await request(appAs(reqFor({ roles: ['League Manager'] }))).get('/hoops/admin')).status).toBe(404);
    });

    test('viewing a football league they run sends them to football admin', async () => {
        await appoint(HOOPS, [JEFF]);
        const res = await request(appAs(reqFor({ roles: ['League Manager'] }), 'claunts-league')).get('/hoops/admin');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/admin');
    });
});

describe("which admin page: football's redirect and the navbar link", () => {
    test('football /admin sends a commissioner to the basketball page when that is what they view, or all they run', async () => {
        await appoint(HOOPS, [JEFF]);
        expect(hoopsAdmin.footballAdminRedirect(reqFor(), HOOPS)).toBe('/hoops/admin');
        expect(hoopsAdmin.footballAdminRedirect(reqFor(), 'graham-league')).toBe('/hoops/admin');
        const lm = reqFor({ roles: ['League Manager'] });
        expect(hoopsAdmin.footballAdminRedirect(lm, HOOPS)).toBe('/hoops/admin');
        expect(hoopsAdmin.footballAdminRedirect(lm, 'claunts-league')).toBeNull();
        // Viewing a basketball league they do NOT run: stay on their football page.
        expect(hoopsAdmin.footballAdminRedirect(lm, OTHER_HOOPS)).toBeNull();
    });

    test('football admin manages a football league they were appointed to, not the flag', async () => {
        await appoint('graham-league', [JEFF]);
        const lm = reqFor({ roles: ['League Manager'] });
        expect(hoopsAdmin.footballManagedLeague(lm, 'graham-league')).toBe('graham-league');
        expect(hoopsAdmin.footballManagedLeague(lm, OTHER_HOOPS)).toBe('claunts-league');
    });

    test('the navbar link follows the viewed league when they run it, else a league they run', async () => {
        await appoint(HOOPS, [JEFF]);
        const lm = reqFor({ roles: ['League Manager'] });
        expect(hoopsAdmin.adminHref(lm, HOOPS)).toBe('/hoops/admin');
        expect(hoopsAdmin.adminHref(lm, 'claunts-league')).toBe('/admin');
        expect(hoopsAdmin.adminHref(lm, OTHER_HOOPS)).toBe('/admin');
        expect(hoopsAdmin.adminHref(reqFor(), 'graham-league')).toBe('/hoops/admin');
        expect(hoopsAdmin.adminHref(reqFor({ accountId: new mongoose.Types.ObjectId() }), HOOPS)).toBeNull();
        expect(hoopsAdmin.adminHref(reqFor({ roles: ['Admin'] }), HOOPS)).toBe('/hoops/admin');
    });
});
