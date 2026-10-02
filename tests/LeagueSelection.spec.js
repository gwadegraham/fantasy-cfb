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
const migration = require('../modules/account-migration');
const selection = require('../modules/league-selection');
const { canManageLeague } = require('../modules/league-access');

useMongo();

const BALL = 'graham-league';
const OTHER = 'claunts-league';
const HOOPS = 'hoops-league';

// A request as express-openid-connect leaves it: the account id lives in the
// inner metadata, which is the only link between a login and a franchise.
const reqFor = (accountId, { league = 'gg', roles = [], cookie, authed = true } = {}) => {
    // On oidc.user, because that is what dev-role's effectiveUser reads —
    // req.effUser is derived FROM it by middleware, not the other way round.
    const user = {
        user_metadata: { roles, metadata: { userId: accountId ? String(accountId) : undefined, league } }
    };
    return {
        oidc: { isAuthenticated: () => authed, user },
        headers: cookie ? { cookie: `${selection.COOKIE}=${encodeURIComponent(cookie)}` } : {},
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

describe('POST /league/select', () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { Object.assign(req, app.locals._req); next(); });
    app.post('/league/select', async (req, res) => {
        if (!await selection.maySelect(req, (req.body || {}).league)) {
            return res.status(403).json({ message: 'Not one of your leagues' });
        }
        res.cookie(selection.COOKIE, req.body.league, selection.COOKIE_OPTS);
        res.json({ ok: true, league: req.body.league });
    });

    test('sets the cookie for a league you hold', async () => {
        const u = await manager(BALL, { second: HOOPS });
        app.locals._req = reqFor(u._id);
        const res = await request(app).post('/league/select').send({ league: HOOPS });
        expect(res.status).toBe(200);
        expect(res.headers['set-cookie'][0]).toContain(`${selection.COOKIE}=${HOOPS}`);
        expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
    });

    test('refuses one you do not', async () => {
        const u = await manager(BALL);
        app.locals._req = reqFor(u._id);
        const res = await request(app).post('/league/select').send({ league: OTHER });
        expect(res.status).toBe(403);
        expect(res.headers['set-cookie']).toBeUndefined();
    });
});
