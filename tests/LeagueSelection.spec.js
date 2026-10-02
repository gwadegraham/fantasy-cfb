// Which league you're VIEWING, and why that is not which league you may
// MANAGE (#319).
//
// The whole module exists because collapsing those two is a privilege
// escalation, and there are two separate doors to it:
//
//   canManageLeague — a League Manager's permissions
//   the draft token — isCommissionerOf reads `user.league` off it
//
// Both must keep answering from the Auth0 flag. If either ever starts reading
// the selection, a League Manager picks the other league and gains authority
// over it. That is what most of this file is about.

const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const Franchise = require('../models/franchise');
const League = require('../models/league');
const migration = require('../modules/account-migration');
const selection = require('../modules/league-selection');
const { canManageLeague } = require('../modules/league-access');

useMongo();

const BALL = 'graham-league';
const OTHER = 'claunts-league';
const HOOPS = 'hoops-league';

// A request as express-openid-connect leaves it: the account id lives in the
// inner metadata, which is the only link between a login and a franchise.
// `cookie` is encoded on the way in, as a browser would. `rawCookie` is NOT,
// which is the only way to test a malformed value — the first version of the
// undecodable-cookie tests passed `%` through encodeURIComponent, so it
// arrived as `%25`, decoded back to `%` without throwing, and stayed green
// with the guard deleted. The fixture was sanitising the thing under test.
const reqFor = (accountId, { league = 'gg', roles = [], cookie, rawCookie, authed = true } = {}) => {
    // On oidc.user, because that is what dev-role's effectiveUser reads —
    // req.effUser is derived FROM it by middleware, not the other way round.
    const user = {
        user_metadata: { roles, metadata: { userId: accountId ? String(accountId) : undefined, league } }
    };
    return {
        oidc: { isAuthenticated: () => authed, user },
        headers: rawCookie !== undefined
            ? { cookie: `${selection.COOKIE}=${rawCookie}` }
            : (cookie ? { cookie: `${selection.COOKIE}=${encodeURIComponent(cookie)}` } : {}),
        effUser: user,
        get: () => undefined
    };
};

async function manager(league, { second } = {}) {
    const u = await User.create({ firstName: 'Ann', lastName: 'T', league, seasons: [{ season: 2026 }] });
    await migration.migrate({ apply: true });
    if (second) await Franchise.create({ accountId: u._id, league: second, seasons: [{ season: 2027 }] });
    return u;
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// Everything below that says "Admin" leans on this: an Admin's viewable set
// is every known league, not their franchises.
const adminReq = (opts = {}) => reqFor(new mongoose.Types.ObjectId(), Object.assign({ roles: ['Admin'] }, opts));

describe('a cookie that cannot be decoded', () => {
    // THE DYNO-KILLER. decodeURIComponent throws URIError on any malformed
    // percent-escape, this runs from an async middleware on every request,
    // Express 4 does not catch a rejected promise, nothing handles
    // unhandledRejection and Node 20 exits on one. A single
    // `document.cookie = 'cc_league=%'` in devtools would restart-loop the
    // dyno for EVERYONE — and the cookie is 180-day persistent, so the holder
    // could not reload their way out of it.
    test.each([['%'], ['%E0%A4%A'], ['%zz'], ['graham-league%']])('%s is survived, not thrown', async (junk) => {
        const u = await manager(BALL);
        const req = reqFor(u._id, { rawCookie: junk });   // RAW: encoding it would defuse the test
        // Not `rejects` — the point is that nothing escapes at all.
        await expect(selection.selectedLeague(req)).resolves.toBe(BALL);
        await expect(selection.maySelect(req, junk)).resolves.toBe(false);
        await expect(selection.canSwitch(req)).resolves.toBe(false);
    });

    test('the raw cookie is passed through, so it fails the membership check', async () => {
        // An undecodable value must be IGNORED like any unrecognised league,
        // not treated as a match for anything.
        const u = await manager(BALL, { second: HOOPS });
        expect(await selection.selectedLeague(reqFor(u._id, { rawCookie: '%hoops-league' }))).toBe(BALL);
    });
});

describe('an Admin sees every league', () => {
    // An Admin has switched leagues from the navbar since long before this
    // module existed. The first version of it validated against franchises
    // only, so the Admin — the one person with the control — got a 403 and a
    // dropdown that snapped back and did nothing on all eight pages.
    test('can select a league they hold no franchise in', async () => {
        expect(await selection.maySelect(adminReq(), OTHER)).toBe(true);
        expect(await selection.selectedLeague(adminReq({ cookie: OTHER }))).toBe(OTHER);
    });

    test('and is offered the switcher without owning two franchises', async () => {
        expect(await selection.canSwitch(adminReq())).toBe(true);
    });

    test('and can select a league that exists only in the DATABASE', async () => {
        // #319 part 2. An Admin's viewable set used to come straight from the
        // hardcoded scoring-defaults array, which holds the two football
        // leagues and will never hold a basketball one — so the Admin could
        // not look at the league this whole epic is for.
        await require('../models/league').create({ code: HOOPS, name: 'Hoops', sport: 'basketball' });
        expect(await selection.maySelect(adminReq(), HOOPS)).toBe(true);
        expect(await selection.selectedLeague(adminReq({ cookie: HOOPS }))).toBe(HOOPS);
    });

    test('but still cannot select a league that does not exist', async () => {
        // Validated against the known list, not accepted outright: the value
        // goes on to scope real queries.
        for (const junk of ['', 'nonsense', '{"$ne":null}', 'graham-league ']) {
            expect(await selection.maySelect(adminReq(), junk)).toBe(false);
        }
        expect(await selection.selectedLeague(adminReq({ cookie: 'nonsense' }))).toBe(BALL);
    });

    test('a member keeps their franchise even if the catalog has not caught up', async () => {
        // A member's answer is their franchise, not a list lookup: a league
        // missing from the collection must not strand someone outside their
        // own team.
        const u = await User.create({ firstName: 'Di', lastName: 'M', league: 'gg', seasons: [{ season: 2026 }] });
        await migration.migrate({ apply: true });
        await Franchise.updateOne({ accountId: u._id }, { $set: { league: 'ghost-league' } });
        expect(await selection.selectedLeague(reqFor(u._id, { league: 'gg' }))).toBe('ghost-league');
    });

    test('a NON-admin gets none of that', async () => {
        // The separation the whole module is about: being able to see a league
        // is a role, not a cookie.
        const u = await manager(BALL);
        expect(await selection.maySelect(reqFor(u._id), OTHER)).toBe(false);
        expect(await selection.canSwitch(reqFor(u._id))).toBe(false);
    });
});

describe('selectedLeague', () => {
    test('one franchise means that league, cookie or no cookie', async () => {
        const u = await manager(BALL);
        expect(await selection.selectedLeague(reqFor(u._id))).toBe(BALL);
    });

    // The franchise WINS over the Auth0 flag, and this is the only fixture that
    // can tell the two apart: leagueCodeFor is binary ('gg' or claunts), so it
    // can never answer hoops-league. Every other test here has a franchise
    // whose league happens to match the flag, and with those alone, deleting
    // the franchise branch entirely leaves this file green.
    test('your franchise beats the Auth0 flag when they disagree', async () => {
        const u = await User.create({ firstName: 'Bo', lastName: 'H', league: 'gg', seasons: [{ season: 2026 }] });
        await migration.migrate({ apply: true });
        await Franchise.updateOne({ accountId: u._id }, { $set: { league: HOOPS } });
        expect(await selection.selectedLeague(reqFor(u._id, { league: 'gg' }))).toBe(HOOPS);
    });

    // Which league you LAND on with two franchises and no choice made yet.
    //
    // Both of these need a second league that sorts BEFORE the home one, or
    // the alphabetical fallback returns the same answer by accident and the
    // test cannot tell the two branches apart. The first version used
    // hoops-league, which sorts after graham-league, and stayed green with the
    // home-league preference deleted outright.
    const EARLY = 'alpha-league';

    test('with no choice, your HOME league wins over the other one', async () => {
        // The property that makes this safe to ship: giving someone a second
        // franchise must not silently move them somewhere new.
        const u = await manager(BALL, { second: EARLY });
        expect(await selection.selectedLeague(reqFor(u._id, { league: 'gg' }))).toBe(BALL);
    });

    test('and without a home franchise the landing league is STABLE', async () => {
        // leaguesFor does not sort, so the bare first element is whatever
        // Mongo hands back — which is why the ORDER is forced here rather than
        // hoped for. Reading it from the database instead left this green with
        // the sort removed, because the documents came back alphabetically
        // anyway.
        const order = jest.spyOn(require('../modules/franchise-repo'), 'leaguesFor')
            .mockResolvedValue(['zeta-league', EARLY]);
        expect(await selection.selectedLeague(reqFor(new mongoose.Types.ObjectId(), { league: 'gg' }))).toBe(EARLY);
        order.mockRestore();
    });

    test('a valid choice is honoured', async () => {
        const u = await manager(BALL, { second: HOOPS });
        expect(await selection.selectedLeague(reqFor(u._id, { cookie: HOOPS }))).toBe(HOOPS);
    });

    // THE COOKIE IS NOT TRUSTED. It is as client-supplied as a query string;
    // the only thing making it safe is this check.
    test('a league you do not play in is IGNORED, not honoured', async () => {
        const u = await manager(BALL);
        expect(await selection.selectedLeague(reqFor(u._id, { cookie: OTHER }))).toBe(BALL);
    });

    test('a stale cookie from a league you left stops applying, quietly', async () => {
        // Not an error: someone removed from a league should simply see the
        // one they still have, not a failure page.
        const u = await manager(BALL, { second: HOOPS });
        await Franchise.deleteOne({ accountId: u._id, league: HOOPS });
        expect(await selection.selectedLeague(reqFor(u._id, { cookie: HOOPS }))).toBe(BALL);
    });

    test('nonsense in the cookie is ignored', async () => {
        const u = await manager(BALL);
        for (const junk of ['', '../../etc', '{"$ne":null}', 'graham-league ']) {
            expect(await selection.selectedLeague(reqFor(u._id, { cookie: junk }))).toBe(BALL);
        }
    });

    test('a login with no account id behind it keeps its Auth0 league', async () => {
        // Not hypothetical: an Auth0 user created outside the invite flow has
        // no user_metadata.metadata.userId, and that is the ONLY link between
        // a login and a franchise. Without an id there is nothing to look up,
        // so the flag is all there is — and the database must not be asked.
        const spy = jest.spyOn(Franchise, 'find');
        const req = reqFor(null, { league: 'cl' });
        expect(await selection.selectedLeague(req)).toBe(OTHER);
        expect(await selection.canSwitch(req)).toBe(false);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    test('a signed-out request has no league at all', async () => {
        expect(await selection.selectedLeague(reqFor(null, { authed: false }))).toBe('');
    });

    // The fallback that makes this safe to ship before the data catches up.
    test('an account the repo knows nothing about keeps its Auth0 league', async () => {
        const ghost = new mongoose.Types.ObjectId();
        expect(await selection.selectedLeague(reqFor(ghost, { league: 'gg' }))).toBe(BALL);
        expect(await selection.selectedLeague(reqFor(ghost, { league: 'cl' }))).toBe(OTHER);
    });

    test('a failed franchise read does not log anyone out of their league', async () => {
        const boom = jest.spyOn(Franchise, 'find').mockImplementationOnce(() => { throw new Error('mongo down'); });
        expect(await selection.selectedLeague(reqFor(new mongoose.Types.ObjectId(), { league: 'gg' }))).toBe(BALL);
        boom.mockRestore();
    });

    test('the franchise read happens ONCE per request', async () => {
        // The locals middleware calls this, then routes call it again, on a
        // free tier where latency tracks bytes.
        const u = await manager(BALL, { second: HOOPS });
        const req = reqFor(u._id, { cookie: HOOPS });
        const spy = jest.spyOn(Franchise, 'find');
        await selection.selectedLeague(req);
        await selection.selectedLeague(req);
        await selection.canSwitch(req);
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('canSwitch', () => {
    test('one franchise is not worth a switcher', async () => {
        const u = await manager(BALL);
        expect(await selection.canSwitch(reqFor(u._id))).toBe(false);
    });

    test('two is', async () => {
        const u = await manager(BALL, { second: HOOPS });
        expect(await selection.canSwitch(reqFor(u._id))).toBe(true);
    });
});

describe('maySelect agrees with selectedLeague', () => {
    // A POST that sets a cookie a GET would then ignore is a switcher that
    // silently does nothing.
    test('what can be selected is what gets honoured', async () => {
        const u = await manager(BALL, { second: HOOPS });
        for (const lg of [BALL, HOOPS, OTHER, '', 'nonsense']) {
            const allowed = await selection.maySelect(reqFor(u._id), lg);
            const got = await selection.selectedLeague(reqFor(u._id, { cookie: lg }));
            expect(allowed).toBe(got === lg && lg !== '');
        }
    });
});

describe('MANAGING is not SELECTING', () => {
    // The escalation this module is shaped around.
    const lmReq = (league, cookie) =>
        reqFor(new mongoose.Types.ObjectId(), { league, roles: ['League Manager'], cookie });

    test('a League Manager cannot manage another league by selecting it', async () => {
        const req = lmReq('gg', OTHER);                 // of graham, viewing claunts
        expect(canManageLeague(req, BALL)).toBe(true);
        expect(canManageLeague(req, OTHER)).toBe(false);
    });

    test('and selecting their own league changes nothing either', async () => {
        const req = lmReq('gg', BALL);
        expect(canManageLeague(req, OTHER)).toBe(false);
    });

    test('an Admin still manages any league', async () => {
        const req = reqFor(new mongoose.Types.ObjectId(), { league: 'gg', roles: ['Admin'] });
        expect(canManageLeague(req, OTHER)).toBe(true);
    });

    test('a plain member manages none', async () => {
        const req = lmReq('gg', BALL);
        req.effUser.user_metadata.roles = [];
        expect(canManageLeague(req, BALL)).toBe(false);
    });

    // Pinned structurally: league-access must not start importing the
    // selection module, which is the only way this regresses.
    test('league-access does not depend on league-selection', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'modules', 'league-access.js'), 'utf8');
        expect(src).not.toMatch(/require\(.*league-selection/);
        expect(src).not.toMatch(/selectedLeague/);
    });

    test('and the draft token still carries the AUTHORITY league', () => {
        // modules/draft-socket.js isCommissionerOf reads user.league off the
        // token: `role === 'League Manager' && user.league === league`. A
        // token minted from the SELECTION would hand a League Manager
        // commissioner powers in another league's draft room.
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', 'server.js'), 'utf8');
        // Everything the sign() call is given, comments and all — the first
        // version of this anchored on `sign(\s*{` and missed because a
        // comment sits between them.
        const mint = /draftToken\.sign\(([\s\S]*?)process\.env\.AUTH_SECRET/.exec(src)[1];
        expect(mint).toContain('leagueCodeFor(req.effUser)');
        expect(mint).not.toContain('viewerLeagueCode');
    });
});

describe('viewerContext — what the navbar is built from', () => {
    // Extracted from the locals middleware because the inline version could
    // be reverted with the whole suite green: the only coverage was of the
    // template that consumes these values, not of anything that produces them.
    const CATALOG = [
        { code: OTHER, name: 'Goofballers', sport: 'football' },
        { code: BALL, name: 'The Polar Depressed', sport: 'football' },
        { code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' }
    ];

    test('a member is offered ONLY their own leagues', async () => {
        // The bug: built from the catalog unfiltered, a member's switcher
        // offers leagues the server then refuses with a 403.
        const u = await manager(BALL, { second: HOOPS });
        const ctx = await selection.viewerContext(reqFor(u._id), CATALOG);
        expect(ctx.leagues.map(l => l.code)).toEqual([BALL, HOOPS]);
        expect(ctx.canSwitch).toBe(true);
        expect(ctx.isAdmin).toBe(false);
    });

    test('with one league there is nothing to switch to', async () => {
        const u = await manager(BALL);
        const ctx = await selection.viewerContext(reqFor(u._id), CATALOG);
        expect(ctx.leagues.map(l => l.code)).toEqual([BALL]);
        expect(ctx.canSwitch).toBe(false);
    });

    test('an Admin is offered the whole catalog', async () => {
        // The League docs must exist, not just the array: an Admin's viewable
        // set is read from the catalog, so seeding only the list being
        // rendered would make the two disagree — which is precisely the thing
        // the agreement test below forbids.
        await League.create({ code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' });
        const ctx = await selection.viewerContext(adminReq(), CATALOG);
        expect(ctx.leagues.map(l => l.code)).toEqual([OTHER, BALL, HOOPS]);
        expect(ctx.canSwitch).toBe(true);
        expect(ctx.isAdmin).toBe(true);
    });

    // THE INVARIANT. Offering a league the POST would refuse is a control
    // that snaps back and does nothing — the exact failure the Admin
    // switcher had before part 1's QA pass.
    test('everything offered is something maySelect ACCEPTS', async () => {
        await League.create({ code: HOOPS, name: 'Hardwood Heroes', sport: 'basketball' });
        const u = await manager(BALL, { second: HOOPS });
        for (const req of [reqFor(u._id), adminReq()]) {
            const ctx = await selection.viewerContext(req, CATALOG);
            expect(ctx.leagues.length).toBeGreaterThan(0);
            for (const lg of ctx.leagues) {
                expect(await selection.maySelect(req, lg.code)).toBe(true);
            }
        }
    });

    test('and an Admin may switch even with a one-league catalog', async () => {
        // canSwitch is a ROLE for an Admin, not a count.
        //
        // Archiving the other league is what makes this test mean anything:
        // passing a one-entry list is not enough, because the viewable set is
        // read from the catalog and the "franchise the catalog missed" branch
        // below puts the second league straight back, giving a list of two.
        // The first version did exactly that and stayed green with the role
        // term deleted.
        await League.create({ code: OTHER, name: 'Goofballers', status: 'archived' });
        const ctx = await selection.viewerContext(adminReq(), [CATALOG[1]]);
        expect(ctx.leagues.map(l => l.code)).toEqual([BALL]);     // genuinely one
        expect(ctx.canSwitch).toBe(true);
    });

    test('the names come from the catalog, so a rename lands here too', async () => {
        const u = await manager(BALL, { second: HOOPS });
        const ctx = await selection.viewerContext(reqFor(u._id), CATALOG);
        expect(ctx.leagues.map(l => l.name)).toEqual(['The Polar Depressed', 'Hardwood Heroes']);
    });

    test('a franchise the catalog does not list is still offered', async () => {
        // A member's franchise is the fact. A league missing from the
        // collection must not hide their own team from them — it shows up
        // named by its code, which is ugly and visible rather than absent.
        const u = await manager(BALL, { second: 'ghost-league' });
        const ctx = await selection.viewerContext(reqFor(u._id), CATALOG);
        expect(ctx.leagues.map(l => l.code)).toEqual([BALL, 'ghost-league']);
        expect(ctx.leagues[1].name).toBe('ghost-league');
        expect(ctx.canSwitch).toBe(true);
    });

    test('the offered list always contains the league being VIEWED', async () => {
        // Otherwise the switcher renders with nothing selected and the page
        // claims a league the dropdown does not list.
        const u = await manager(BALL, { second: HOOPS });
        for (const cookie of [undefined, HOOPS, BALL, 'nonsense']) {
            const ctx = await selection.viewerContext(reqFor(u._id, { cookie }), CATALOG);
            expect(ctx.leagues.map(l => l.code)).toContain(ctx.code);
        }
    });

    test('an empty catalog does not throw', async () => {
        const u = await manager(BALL);
        const ctx = await selection.viewerContext(reqFor(u._id), []);
        expect(ctx.leagues.map(l => l.code)).toEqual([BALL]);
        expect(await selection.viewerContext(reqFor(u._id), undefined)).toBeTruthy();
    });
});

describe('POST /league/select', () => {
    // Mounts the REAL handler. The first version of this re-implemented the
    // route body inline, so deleting the whole maySelect guard from server.js
    // left every test in the suite green — the endpoint that turns a POST body
    // into a cookie the server then trusts had no coverage at all.
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { Object.assign(req, app.locals._req); next(); });
    app.post('/league/select', selection.selectHandler);

    const post = (body) => request(app).post('/league/select').send(body);

    test('sets the cookie for a league you hold', async () => {
        const u = await manager(BALL, { second: HOOPS });
        app.locals._req = reqFor(u._id);
        const res = await post({ league: HOOPS });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, league: HOOPS });
        expect(res.headers['set-cookie'][0]).toContain(`${selection.COOKIE}=${HOOPS}`);
        expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
        expect(res.headers['set-cookie'][0]).toContain('SameSite=Lax');
    });

    test('refuses one you do not, and sets nothing', async () => {
        const u = await manager(BALL);
        app.locals._req = reqFor(u._id);
        const res = await post({ league: OTHER });
        expect(res.status).toBe(403);
        expect(res.headers['set-cookie']).toBeUndefined();
    });

    test('an Admin may set any KNOWN league', async () => {
        app.locals._req = adminReq();
        expect((await post({ league: OTHER })).status).toBe(200);
        expect((await post({ league: 'nonsense' })).status).toBe(403);
    });

    test('a junk body cannot set a cookie', async () => {
        // req.body.league is whatever JSON arrived: an object, an array, a
        // number. `includes` is strict equality against values that came out
        // of Mongo, so all of it fails closed — but the route must not throw
        // on the way there either.
        const u = await manager(BALL);
        app.locals._req = reqFor(u._id);
        for (const body of [{}, { league: null }, { league: { $ne: null } }, { league: [BALL] }, { league: 7 }]) {
            const res = await post(body);
            expect(res.status).toBe(403);
            expect(res.headers['set-cookie']).toBeUndefined();
        }
    });

    test('what the POST accepts is exactly what a GET then honours', async () => {
        // A switcher that sets a cookie the next render ignores looks broken.
        const u = await manager(BALL, { second: HOOPS });
        app.locals._req = reqFor(u._id);
        for (const lg of [BALL, HOOPS, OTHER, 'nonsense']) {
            const accepted = (await post({ league: lg })).status === 200;
            const honoured = await selection.selectedLeague(reqFor(u._id, { cookie: lg })) === lg;
            expect(accepted).toBe(honoured);
        }
    });
});

describe('the server wiring', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');

    test('mounts the real handler rather than a second copy of it', () => {
        expect(src).toContain('leagueSelection.selectHandler');
        // An inline body here is how the guard became untestable the first time.
        expect(src).not.toMatch(/'\/league\/select'[\s\S]{0,200}maySelect/);
    });

    test('and keeps it behind requiresAuth', () => {
        expect(src).toMatch(/'\/league\/select',\s*requiresAuth\(\)/);
    });

    test('the league lookup is gated to HTML GETs', () => {
        // express.static is mounted BELOW this middleware, so an ungated
        // lookup is a Franchise.find per asset — ~20 per page view on a free
        // Atlas tier. identity-guard.js skips assets for the same reason.
        // The guard is hoisted into `isHtmlGet` and shared with the catalog
        // read, so match the variable rather than the literal expression —
        // and check the definition really is the HTML-GET test, so renaming
        // the flag to something that is always true cannot pass.
        expect(src).toMatch(/const isHtmlGet = req\.method === 'GET'[\s\S]{0,80}text\/html/);
        const near = src.slice(Math.max(0, src.indexOf('selectedLeague(req)') - 400), src.indexOf('selectedLeague(req)'));
        expect(near).toMatch(/if \(isHtmlGet\)/);
    });

    test('and cannot take the dyno down when it throws', () => {
        // Express 4 does not catch a rejected promise from async middleware,
        // nothing handles unhandledRejection, and Node 20 exits on one.
        const near = src.slice(Math.max(0, src.indexOf('selectedLeague(req)') - 400), src.indexOf('selectedLeague(req)'));
        expect(near).toContain('try {');
    });

    test('the navbar locals come from viewerContext, not inline logic', () => {
        // Inline, the filter could be dropped and canSwitch hardcoded with
        // every test still green.
        expect(src).toContain('leagueSelection.viewerContext(req');
        expect(src).not.toMatch(/viewerLeagues = res\.locals\.leagues;/);
    });

    test('canSwitch and isAdmin are seeded SEPARATELY', () => {
        // Reusing canSwitch for the client's sticky-localStorage override
        // would hand a two-franchise member the Admin-only behaviour that
        // public/league.js documents against.
        const seed = /leagueSeed = safeJson\(\{([\s\S]*?)\}\)/.exec(src)[1];
        expect(seed).toMatch(/canSwitch/);
        expect(seed).toMatch(/isAdmin/);
    });
});
