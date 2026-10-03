// Which league the viewer is LOOKING AT (#319).
//
// Deliberately a different question from "which league may they manage", and
// keeping the two apart is the whole reason this module exists rather than
// league-access.js growing a cookie.
//
//   viewing  — the person's choice, so a cookie, validated against the
//              franchises they actually hold
//   managing — their authority, so never their choice: see canManageLeague
//
// Collapsing them is a privilege escalation. canManageLeague answers a League
// Manager with `leagueCodeFor(user) === league`; the moment that value is
// something the viewer picks, a League Manager picks the other league and may
// now manage it. league-access.js keeps its own answer for that reason.
//
// ---- why a cookie ----
//
// The switcher already existed for Admins and worked by writing
// localStorage.leagueCode and reloading, which the SERVER never sees — so a
// server-rendered page always showed the viewer's own league regardless. A
// cookie is the smallest thing both sides can read. modules/dev-role.js
// already does exactly this for the role spoof, including overriding the
// league, so the shape is proven here; this one is validated rather than
// DEV-gated.
//
// ---- the cookie is not trusted ----
//
// It is client-supplied, and routes/search.js's comment is the reason that
// matters: the league it scopes to must come from the server, "NOT from a
// parameter the client sends". So the value is only ever used after it has
// been matched against `leaguesFor(accountId)`. An unrecognised one is
// ignored, not honoured and not an error — a stale cookie from a league
// someone left should quietly stop applying.

const franchiseRepo = require('./franchise-repo');
const { leagueCodeFor } = require('./league-access');
const { effectiveUser, effectiveRoles } = require('./dev-role');
const leagueCatalog = require('./league-catalog');

const COOKIE = 'cc_league';

// httpOnly: nothing in the browser needs to read it — public/league.js is
// seeded from the server-rendered page — and not exposing it to script keeps
// it out of reach of anything injected into a page.
const COOKIE_OPTS = { sameSite: 'lax', httpOnly: true, path: '/', maxAge: 180 * 24 * 60 * 60 * 1000 };

// MUST NOT THROW. decodeURIComponent raises URIError on any malformed
// percent-escape ('cc_league=%' is enough), and this is reached from an async
// middleware on EVERY request. Express 4 does not catch a rejected promise
// from async middleware, there is no process-level unhandledRejection handler,
// and Node 20 exits on an unhandled rejection — so one bad cookie would
// restart-loop the dyno for everybody, not just the browser holding it. The
// cookie is 180-day persistent, so the holder could not reload their way out.
//
// An undecodable value is returned raw, which then fails the membership check
// below and is ignored like any other unrecognised league.
function readCookie(req, name) {
    const raw = (req && req.headers && req.headers.cookie) || '';
    for (const part of raw.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k !== name) continue;
        const value = v.join('=');
        try { return decodeURIComponent(value); } catch (e) { return value; }
    }
    return null;
}

// The account id behind this request, which is what membership is keyed on.
// Auth0's user_metadata.metadata.userId IS a Mongo _id — see the note in
// modules/franchise-repo.js; there is no other link between a login and a
// franchise.
function accountIdFor(req) {
    const u = effectiveUser(req);
    const inner = (u && u.user_metadata && u.user_metadata.metadata) || {};
    return inner.userId || null;
}

// Every league this person actually plays in.
//
// Cached on the request: selectedLeague is called from the locals middleware
// and again from individual routes, and this is a database round trip on a
// free-tier cluster where latency tracks bytes.
async function leaguesOf(req) {
    if (req._ccLeagues) return req._ccLeagues;
    const id = accountIdFor(req);
    if (!id) return (req._ccLeagues = []);
    try {
        req._ccLeagues = await franchiseRepo.leaguesFor(id);
    } catch (err) {
        // A failed read must not log someone out of their own league. Fall
        // back to the Auth0 flag, which is what this replaces.
        console.error(`league-selection: could not read franchises for ${id}: ${err.message}`);
        req._ccLeagues = [];
    }
    return req._ccLeagues;
}

// An Admin sees every league, and has been able to switch between them from
// the navbar since long before this module existed. That is the same answer
// canManageLeague gives, and deliberately so: for an Admin the viewing and
// managing questions genuinely do coincide, because the role already carries
// authority over every league. It is only the LEAGUE MANAGER case where the
// two must stay apart, and that is the branch this module never touches.
//
// Validated against the known leagues rather than accepted outright, so a
// hand-written cookie still cannot put an arbitrary string into every query
// the page then runs.
//
// From the CATALOG, not from scoring-defaults: that hardcoded array is tied to
// the scoring models, and a basketball league will never be in it. Reading it
// directly meant an Admin could not select a league that existed only in the
// database — which is every league this epic is about.
function isAdmin(req) {
    return effectiveRoles(req).includes('Admin');
}

// Every league this person may look at. For an Admin that is all of them; for
// everyone else it is exactly the franchises they hold.
//
// A member's answer is NOT filtered against the catalog: their franchise is
// the fact, and a league missing from the collection should not strand them
// outside their own team. The Admin case is the one that needs a list to
// check against, because it is not derived from anything they own.
async function viewableBy(req) {
    if (isAdmin(req)) return leagueCatalog.codes(req);
    return leaguesOf(req);
}

// The league to render, for this request.
//
// Order matters: an explicit, VALID choice wins; then their HOME league if
// they hold a franchise in it; then their franchises alphabetically; then the
// Auth0 flag.
//
// Home-first is what makes this safe to ship: someone who has never touched
// the switcher sees exactly the league they see today, so adding a second
// franchise to an account cannot silently move them. The alphabetical step is
// only reached by someone whose franchises do not include their flagged league
// at all — a basketball-only manager — and it exists because leaguesFor does
// not sort, so without it the landing league would be Mongo's natural order
// and could change under a document rewrite.
//
// The last fallback covers an account the franchise collection does not know
// about yet, which is why this can go out before the data is complete.
async function selectedLeague(req) {
    if (!(req && req.oidc && req.oidc.isAuthenticated())) return '';

    const mine = await viewableBy(req);
    const chosen = readCookie(req, COOKIE);
    if (chosen && mine.includes(chosen)) return chosen;

    const home = leagueCodeFor(effectiveUser(req));
    if (mine.includes(home)) return home;
    if (mine.length) return mine.slice().sort()[0];
    return home;
}

// May this person choose that league? The same validation the read does, so a
// POST cannot set a cookie that a GET would then ignore.
async function maySelect(req, league) {
    const mine = await viewableBy(req);
    return !!league && mine.includes(league);
}

// More than one franchise is what makes a switcher worth rendering. An Admin
// gets the all-leagues picker regardless — that is league-access's business,
// not this module's.
async function canSwitch(req) {
    return (await viewableBy(req)).length > 1;
}

// Everything the navbar needs about the viewer's league, in one call.
//
// A function rather than six lines in the locals middleware, for the same
// reason the route handler below is one: the inline version could be reverted
// — the filter dropped, canSwitch hardcoded to true — with the whole suite
// green, because the only tests were of the template that consumes it.
//
// `leagues` is the catalog, passed in so this does not read it a second time.
async function viewerContext(req, leagues) {
    const code = await selectedLeague(req);
    const mine = new Set(await viewableBy(req));

    // Catalog order first, so the navbar keeps a stable arrangement...
    const offered = (leagues || []).filter(l => mine.has(l.code));

    // ...then any league the viewer holds that the catalog does not list. A
    // member's franchise is the fact: a league missing from the collection
    // must not hide their own team from them. Named by its code, which is
    // ugly and visible — better than silently absent. Sorted, because the
    // set's own order is Mongo's.
    const seen = new Set(offered.map(l => l.code));
    const extras = [...mine].filter(c => !seen.has(c)).sort();
    if (extras.length) {
        // Resolved against the ARCHIVED-INCLUSIVE list. Retiring a league
        // removes it from the catalog, but the people still in it keep their
        // franchise — so without this their own switcher would show them a
        // raw slug for a league they are actively playing in.
        const byCode = new Map((await leagueCatalog.named(req)).map(l => [l.code, l]));
        for (const extra of extras) {
            offered.push(byCode.get(extra) || { code: extra, name: extra });
        }
    }

    // The list the CLIENT seed is built from (ccLeague.name(), the page
    // labels, the <title>). It must name everything `offered` does, or a
    // member holding an archived league sees its name resolve to '' and every
    // [league-label] on their pages goes blank — on a league they still play
    // in. Assembled here rather than in the middleware because the inline
    // version could be deleted with the whole suite green.
    const listed = new Set((leagues || []).map(l => l.code));
    const all = (leagues || []).concat(offered.filter(l => !listed.has(l.code)));

    const admin = isAdmin(req);

    // What the client is told, as one object, because the middleware
    // assembling it inline could swap `offered` for the full catalog with
    // every test green — and that swap publishes the name and code of every
    // league in the database into window.CC_LEAGUE on every page.
    //
    // `all` here is the VIEWER'S leagues. You learn a league exists by being
    // in it, or by being an Admin, whose own list is the whole catalog
    // anyway. A league can therefore be built and seeded for weeks before
    // the people in the other league find out it is there.
    const seed = { code, canSwitch: admin || offered.length > 1, isAdmin: admin, all: offered };

    return {
        code,
        leagues: offered,
        all,
        seed,
        // Derived from the list actually rendered, so a flag saying "you may
        // switch" and a list with nothing to switch to cannot disagree.
        canSwitch: admin || offered.length > 1,
        isAdmin: admin
    };
}

// The same shape as viewerContext, for a request that never asks for it —
// a non-HTML GET, or one where the lookup threw.
//
// It exists because the caller is a middleware that runs on EVERY request and
// then unconditionally serialises `seed`. Leaving a field off this object
// crashed the dyno on every static asset: safeJson(undefined) throws, and an
// async middleware that throws takes the process with it. Keyed off the same
// builder as the real thing so the two cannot drift again.
function emptyContext({ admin = false } = {}) {
    return {
        code: '',
        leagues: [],
        all: [],
        canSwitch: admin,          // an Admin keeps the switcher they have always had
        isAdmin: admin,
        seed: { code: '', canSwitch: admin, isAdmin: admin, all: [] }
    };
}

// POST /league/select, as a handler rather than inline in server.js — the
// first version of this was re-implemented inside its own spec, so deleting
// the authorization check from the real route left every test green.
//
// It grants nothing: the league is checked before the cookie is set and again
// on every read, so a hand-written cookie cannot widen what anyone sees.
async function selectHandler(req, res) {
    const league = (req.body && req.body.league) || '';
    if (!await maySelect(req, league)) {
        // 403 rather than 400: the input is well-formed, the person simply
        // does not play in that league.
        return res.status(403).json({ message: 'Not one of your leagues' });
    }
    res.cookie(COOKIE, league, COOKIE_OPTS);
    return res.json({ ok: true, league });
}

module.exports = {
    COOKIE, COOKIE_OPTS,
    selectedLeague, maySelect, canSwitch, viewableBy, isAdmin, selectHandler, viewerContext, emptyContext,
    leaguesOf, accountIdFor
};
