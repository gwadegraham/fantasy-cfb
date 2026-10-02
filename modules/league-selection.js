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
const { effectiveUser } = require('./dev-role');

const COOKIE = 'cc_league';

// httpOnly: nothing in the browser needs to read it — public/league.js is
// seeded from the server-rendered page — and not exposing it to script keeps
// it out of reach of anything injected into a page.
const COOKIE_OPTS = { sameSite: 'lax', httpOnly: true, path: '/', maxAge: 180 * 24 * 60 * 60 * 1000 };

function readCookie(req, name) {
    const raw = (req && req.headers && req.headers.cookie) || '';
    for (const part of raw.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v.join('='));
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

    const mine = await leaguesOf(req);
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
    const mine = await leaguesOf(req);
    return !!league && mine.includes(league);
}

// More than one franchise is what makes a switcher worth rendering. An Admin
// gets the all-leagues picker regardless — that is league-access's business,
// not this module's.
async function canSwitch(req) {
    return (await leaguesOf(req)).length > 1;
}

module.exports = { COOKIE, COOKIE_OPTS, selectedLeague, maySelect, canSwitch, leaguesOf, accountIdFor };
