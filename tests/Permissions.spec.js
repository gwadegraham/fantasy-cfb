process.env.INTERNAL_API_TOKEN = 'test-internal-token';

const requireAdmin = require('../modules/require-admin');
const requireCommissioner = require('../modules/require-commissioner');
const { canManageLeague } = require('../modules/league-access');
const { effectiveRoles } = require('../modules/dev-role');

function mkReq({ roles = [], authed = true, token = null, cookie = '', innerLeague = null } = {}) {
    return {
        get: (h) => (h === 'X-Internal-Token' ? token : undefined),
        headers: { cookie },
        oidc: {
            isAuthenticated: () => authed,
            user: authed ? { user_metadata: { roles, metadata: innerLeague ? { league: innerLeague } : {} } } : null
        }
    };
}
function mkRes() {
    return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
function run(mw, req) {
    const res = mkRes();
    let nexted = false;
    mw(req, res, () => { nexted = true; });
    return { nexted, status: res.statusCode, body: res.body };
}

describe('requireAdmin', () => {
    test('valid internal token passes (jobs)', () => {
        expect(run(requireAdmin, mkReq({ authed: false, token: 'test-internal-token' })).nexted).toBe(true);
    });
    test('Admin session passes', () => {
        expect(run(requireAdmin, mkReq({ roles: ['Admin'] })).nexted).toBe(true);
    });
    test('League Manager is forbidden', () => {
        const r = run(requireAdmin, mkReq({ roles: ['League Manager'] }));
        expect(r.nexted).toBe(false);
        expect(r.status).toBe(403);
    });
    test('regular member is forbidden', () => {
        expect(run(requireAdmin, mkReq({ roles: [] })).status).toBe(403);
    });
});

describe('requireCommissioner', () => {
    test('Admin and League Manager both pass', () => {
        expect(run(requireCommissioner, mkReq({ roles: ['Admin'] })).nexted).toBe(true);
        expect(run(requireCommissioner, mkReq({ roles: ['League Manager'] })).nexted).toBe(true);
    });
    test('regular member is forbidden', () => {
        expect(run(requireCommissioner, mkReq({ roles: [] })).status).toBe(403);
    });
    test('internal token passes', () => {
        expect(run(requireCommissioner, mkReq({ authed: false, token: 'test-internal-token' })).nexted).toBe(true);
    });
});

describe('canManageLeague (own-league)', () => {
    test('internal token can manage any league', () => {
        expect(canManageLeague(mkReq({ authed: false, token: 'test-internal-token' }), 'claunts-league')).toBe(true);
    });
    test('Admin can manage any league', () => {
        expect(canManageLeague(mkReq({ roles: ['Admin'], innerLeague: 'gg' }), 'claunts-league')).toBe(true);
    });
    test('League Manager can manage their own league only', () => {
        const graham = mkReq({ roles: ['League Manager'], innerLeague: 'gg' });
        expect(canManageLeague(graham, 'graham-league')).toBe(true);
        expect(canManageLeague(graham, 'claunts-league')).toBe(false);
        const claunts = mkReq({ roles: ['League Manager'], innerLeague: 'cl' });
        expect(canManageLeague(claunts, 'claunts-league')).toBe(true);
        expect(canManageLeague(claunts, 'graham-league')).toBe(false);
    });
    test('regular member cannot manage any league', () => {
        expect(canManageLeague(mkReq({ roles: [] }), 'graham-league')).toBe(false);
    });
});

describe('dev role spoof (effectiveRoles)', () => {
    const spoofCookie = (obj) => 'cc_spoof=' + encodeURIComponent(JSON.stringify(obj));

    test('a real Admin with a spoof cookie takes on the spoofed roles', () => {
        const req = mkReq({ roles: ['Admin'], cookie: spoofCookie({ roles: ['League Manager'] }) });
        expect(effectiveRoles(req)).toEqual(['League Manager']);
    });
    test('spoofing "member" (empty roles) de-escalates the Admin', () => {
        const req = mkReq({ roles: ['Admin'], cookie: spoofCookie({ roles: [] }) });
        expect(effectiveRoles(req)).toEqual([]);
    });
    test('a non-Admin cannot spoof (cookie ignored)', () => {
        const req = mkReq({ roles: ['League Manager'], cookie: spoofCookie({ roles: ['Admin'] }) });
        expect(effectiveRoles(req)).toEqual(['League Manager']);
    });
    test('no cookie returns the real roles', () => {
        expect(effectiveRoles(mkReq({ roles: ['Admin'] }))).toEqual(['Admin']);
    });
});
