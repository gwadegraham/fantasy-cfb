if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const retrieveGamesModule = require('./modules/retrieve-games.js');
const scoringModule = require('./modules/scoring.js');
const schedule = require('node-schedule');
const { auth } = require('express-openid-connect');
const requireAuthOrToken = require('./modules/require-auth');
const requireCommissioner = require('./modules/require-commissioner');
const requireAdmin = require('./modules/require-admin');
const devRole = require('./modules/dev-role');
const identityGuard = require('./modules/identity-guard');
const { inviteBind, COOKIE: INVITE_COOKIE, COOKIE_MAX_AGE_MS: INVITE_COOKIE_MAX_AGE } = require('./modules/invite-bind');
const inviteToken = require('./modules/invite-token');
const auth0Management = require('./modules/auth0-management');
const authSubBackfill = require('./modules/auth-sub-backfill');
const { leagueCodeFor, canManageLeague } = require('./modules/league-access');
const ScoringConfig = require('./models/scoringConfig');
const User = require('./models/user');
const League = require('./models/league');
const { resolveConfig, fieldsForModel, LEAGUES, engagementForSeason } = require('./modules/scoring-defaults');
const draftToken = require('./modules/draft-token');
const registerDraftSockets = require('./modules/draft-socket');
const { cloudinaryConfig } = require('./modules/profile-update');

// Serializes an object to JSON that is safe to embed inside an inline <script>
// tag. Escapes the characters that could break out of the script context
// (e.g. "</script>") or the JS string (U+2028 / U+2029 line separators).
function safeJson(obj) {
    var lineSeps = String.fromCharCode(0x2028) + String.fromCharCode(0x2029);
    var unsafe = new RegExp('[<>&' + lineSeps + ']', 'g');
    return JSON.stringify(obj).replace(unsafe, function (c) {
        return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
    });
}

// Builds the view's user context from the OIDC user, tolerating accounts that
// are missing user_metadata / roles / metadata. Previously these were accessed
// unguarded (e.g. user_metadata.roles.length), so any such account threw a
// TypeError and got a 500 on every page.
function buildUserContext(oidcUser) {
    const meta = (oidcUser && oidcUser.user_metadata) || {};
    const roles = meta.roles || [];
    const innerMeta = meta.metadata || {};
    return {
        firstName: oidcUser && oidcUser.name,
        role: roles.length > 0 ? roles[0] : '',
        userId: innerMeta.userId,
        league: innerMeta.league || '',
        isMaintenance: false
    };
}

// Routing
const path = require('path')
const fs = require('fs')

const config = {
  authRequired: false,
  auth0Logout: true,
  secret: process.env.AUTH_SECRET,
  baseURL: process.env.URL,
  clientID: process.env.CLIENT_ID,
  issuerBaseURL: process.env.ISSUER_BASE_URL
};

// Expose the league list to every view (the navbar switcher renders from it).
app.locals.leagues = LEAGUES;

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(config));

// Dev role-spoof + view context. Resolves the effective user (honors an Admin's
// active role spoof in non-production; a no-op in prod / for non-Admins) and
// exposes dev flags to every view. The render routes and the role gates all
// read this, so a spoof is consistent across server checks and the client UI.
app.use((req, res, next) => {
    req.effUser = devRole.effectiveUser(req);
    res.locals.devMode = devRole.DEV;
    res.locals.canSpoof = devRole.DEV && devRole.isRealAdmin(req);
    res.locals.spoof = devRole.readSpoof(req); // {roles, league} | null, for the dev widget
    next();
});

// Claim a commissioner invite. Must sit BETWEEN the auth router (so there is a
// session to read) and the identity guard below — an invitee has no franchise
// pointer yet, which is precisely what the guard 403s on, so binding has to
// happen first. See modules/invite-bind.js.
app.use(inviteBind({
    User,
    management: auth0Management,
    inviteToken,
    secret: () => process.env.AUTH_SECRET
}));

// Identity-match guard. Refuses to serve a session whose login email doesn't
// match the franchise its Auth0 pointer resolves to (see modules/identity-guard).
// Runs on the REAL identity so dev role-spoofing can't trigger a false block.
app.use(identityGuard({ User }));

// Per-request league display names (editable via /leagues) for the navbar
// switcher — HTML GETs only, falling back to the hardcoded defaults.
app.use(async (req, res, next) => {
    res.locals.leagues = LEAGUES;
    try {
        if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
            const docs = await League.find({}, { code: 1, name: 1, _id: 0 }).lean();
            if (docs.length) {
                const byCode = {};
                docs.forEach(d => { byCode[d.code] = d.name; });
                res.locals.leagues = LEAGUES.map(l => ({ code: l.code, name: byCode[l.code] || l.name }));
            }
        }
    } catch (e) { /* fall back to defaults */ }
    next();
});

// Make the logged-in member's avatar available to every rendered view, so the
// navbar can show their profile photo instead of a generic icon. One indexed
// lookup per page navigation (guarded to HTML GETs so it never fires for static
// assets or API calls); any failure falls back to the generic icon.
app.use(async (req, res, next) => {
    try {
        if (req.method === 'GET'
            && (req.headers.accept || '').includes('text/html')
            && req.oidc && req.oidc.isAuthenticated()) {
            const innerMeta = (req.oidc.user.user_metadata && req.oidc.user.user_metadata.metadata) || {};
            if (innerMeta.userId) {
                const u = await User.findById(innerMeta.userId,
                    { avatarUrl: 1, color: 1, firstName: 1, lastName: 1, authSub: 1 }).lean();
                if (u) {
                    const initials = (((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '')).toUpperCase();
                    res.locals.navUser = {
                        avatarUrl: u.avatarUrl || null,
                        color: u.color || null,
                        initials: initials || null
                    };
                    // Piggybacks on the lookup above rather than costing a query
                    // of its own: record which Auth0 login owns this franchise
                    // the first time we see it, so Manager Logins can tell a
                    // long-standing member from one who was never set up. Runs
                    // after identity-guard, so this session is already vouched
                    // for, and only ever fills a blank. See auth-sub-backfill.
                    if (authSubBackfill.shouldRecord(u, req.oidc.user.sub)) {
                        await authSubBackfill.recordAuthSub(User, innerMeta.userId, req.oidc.user.sub);
                    }
                }
            }
        }
    } catch (e) { /* non-fatal: navbar falls back to the generic icon */ }
    next();
});

const { requiresAuth } = require('express-openid-connect');

app.get('/profile', requiresAuth(), (req, res) => {
  res.send(JSON.stringify(req.oidc.user));
});

// Mint a short-lived signed token the browser uses to authenticate its draft
// socket connection. Requires a real Auth0 session so the identity is trusted.
app.get('/draft-token', requiresAuth(), (req, res) => {
  const ctx = buildUserContext(req.effUser);
  const token = draftToken.sign(
    { userId: ctx.userId, role: ctx.role, name: ctx.firstName, league: leagueCodeFor(req.effUser) },
    process.env.AUTH_SECRET
  );
  res.json({ token });
});

// register the given template engine 
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Configure CFB Data
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;
var rankingsApi = new cfb.RankingsApi();

// Mongoose Setup
const mongoose = require('mongoose');
mongoose.connect(process.env.DATABASE_URL);
const db = mongoose.connection;
db.on('error', (error) => console.error(error));
db.on('open', () => console.log('Connected to Database'));



// Public, no-login landing page for the season announcement. Same source that
// gets published as a claude.ai artifact (docs/announcements/offseason-2026.html),
// but wrapped in a standalone HTML shell and served from our own domain so it
// can actually be emailed/shared and opened on any device — the claude.ai
// artifact is private (owner-only) and 404s for anyone else. authRequired is
// false, and this handler doesn't gate on auth, so it needs no login.
app.get('/season-preview', (req, res) => {
    try {
        const fragment = fs.readFileSync(path.join(__dirname, 'docs/announcements/offseason-2026.html'), 'utf8');
        // Canonical, absolute URLs so link previews (iMessage, Slack, etc.)
        // resolve the image no matter where the page is opened from.
        const SITE = 'https://campusclash.io';
        const TITLE = 'The 2026 Season Is Loaded — Campus Clash';
        const DESC = 'We rebuilt the league from the turf up — new ways to play, '
            + 'new places to go, and a home screen that feels like game day. '
            + "Here's everything worth knowing before kickoff.";
        const OG_IMAGE = SITE + '/images/season-preview-og.png';
        res.type('html').send(
            '<!DOCTYPE html><html lang="en"><head>'
            + '<meta charset="utf-8">'
            + '<meta name="viewport" content="width=device-width, initial-scale=1">'
            + '<meta name="robots" content="noindex">'
            + '<title>Campus Clash — The 2026 Season Is Loaded</title>'
            + '<meta name="description" content="' + DESC + '">'
            // Open Graph (iMessage, Facebook, Slack, LinkedIn, …)
            + '<meta property="og:type" content="website">'
            + '<meta property="og:site_name" content="Campus Clash">'
            + '<meta property="og:url" content="' + SITE + '/season-preview">'
            + '<meta property="og:title" content="' + TITLE + '">'
            + '<meta property="og:description" content="' + DESC + '">'
            + '<meta property="og:image" content="' + OG_IMAGE + '">'
            + '<meta property="og:image:secure_url" content="' + OG_IMAGE + '">'
            + '<meta property="og:image:type" content="image/png">'
            + '<meta property="og:image:width" content="1200">'
            + '<meta property="og:image:height" content="630">'
            + '<meta property="og:image:alt" content="Campus Clash — The 2026 Season Is Loaded">'
            // Twitter/X large-image card
            + '<meta name="twitter:card" content="summary_large_image">'
            + '<meta name="twitter:title" content="' + TITLE + '">'
            + '<meta name="twitter:description" content="' + DESC + '">'
            + '<meta name="twitter:image" content="' + OG_IMAGE + '">'
            + '<style>html,body{margin:0;background:#101322}</style>'
            + '</head><body>' + fragment + '</body></html>'
        );
    } catch (err) {
        res.status(404).send('Announcement not found.');
    }
});

// Dev-only preview of the custom Auth0 login page (auth/login.html). That file
// is the source of truth for the tenant's Custom Login Page, which normally can
// only be seen by pasting it into the Auth0 dashboard and saving — a miserable
// loop to iterate a stylesheet in. This serves it locally with the @@config@@
// placeholder filled in the same shape Auth0 injects, so the layout, fonts,
// motion and error states can be worked on at localhost.
//
// Caveat: the real page is served FROM the Auth0 origin, so webAuth.login()
// reaches /co/authenticate same-origin. Here it is cross-origin, so
// email+password may fail on third-party-cookie grounds even when the markup is
// correct — that failure is an artifact of the preview, not of the page. The
// social buttons are full redirects and behave normally.
if (devRole.DEV) {
    app.get('/dev/login-preview', (req, res) => {
        try {
            const html = fs.readFileSync(path.join(__dirname, 'auth/login.html'), 'utf8');
            const issuer = (process.env.ISSUER_BASE_URL || 'https://example.us.auth0.com')
                .replace(/\/$/, '');
            const stub = {
                auth0Domain: issuer.replace(/^https?:\/\//, ''),
                auth0Tenant: issuer.replace(/^https?:\/\//, '').split('.')[0],
                clientID: process.env.CLIENT_ID || 'preview-client-id',
                callbackURL: (process.env.URL || 'http://localhost:3000') + '/callback',
                callbackOnLocationHash: false,
                authorizationServer: { issuer: issuer + '/' },
                internalOptions: {},
                extraParams: {}
            };
            // Point the absolute production asset URLs at this server, so the
            // preview renders images that only exist locally (a newly exported
            // crest, say) instead of whatever prod last deployed.
            const local = (process.env.URL || 'http://localhost:3000').replace(/\/$/, '');
            res.type('html').send(html
                .split('https://campusclash.io').join(local)
                .replace('@@config@@',
                    Buffer.from(JSON.stringify(stub), 'utf8').toString('base64')));
        } catch (err) {
            res.status(404).send('auth/login.html not found.');
        }
    });
}

// Invite landing page. Public by design — the whole point is that the visitor
// has no account yet. This only stashes the (signed, expiring) token in a cookie
// and explains what happens next; the actual binding runs on the way back from
// Auth0, in the inviteBind middleware above.
app.get('/invite/:token', async (req, res, next) => {
    try {
        const claim = inviteToken.verify(req.params.token, process.env.AUTH_SECRET);
        if (!claim) {
            return res.status(400).render('invite', {
                ok: false,
                heading: 'This invite link isn’t valid',
                message: 'It may have expired, or been copied incompletely. Ask your commissioner for a fresh link.',
                firstName: null, leagueName: null
            });
        }

        const user = await User.findById(claim.userId, { firstName: 1, league: 1 }).lean();
        if (!user) {
            return res.status(404).render('invite', {
                ok: false,
                heading: 'This invite link isn’t valid',
                message: 'It points at a team that no longer exists. Ask your commissioner for a fresh link.',
                firstName: null, leagueName: null
            });
        }

        const league = (res.locals.leagues || LEAGUES).find(l => l.code === user.league);

        // Lax so it survives the redirect back from Auth0; httpOnly because
        // nothing in the browser needs to read it. The token inside is already
        // HMAC-signed, so the cookie itself needs no separate signature.
        res.cookie(INVITE_COOKIE, req.params.token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: String(process.env.URL || '').startsWith('https'),
            maxAge: INVITE_COOKIE_MAX_AGE
        });

        res.render('invite', {
            ok: true,
            heading: null, message: null,
            firstName: user.firstName || null,
            leagueName: (league && league.name) || null
        });
    } catch (err) {
        next(err);
    }
});

// req.isAuthenticated is provided from the auth router
app.get('/', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);

        const userState = safeJson(req.effUser);

        res.render('standings', {user, userState});
    } else {
        // Logged-out root used to 302 straight to /login, which meant sharing
        // campusclash.io anywhere produced no link preview at all — unfurlers
        // follow the redirect and land on Auth0, which has no OG tags of ours.
        // Every other app page is auth-gated the same way, so this is the only
        // place a preview can come from. Serve the tags, then hand humans off to
        // /login via location.replace (not a 302 or meta-refresh) so the hop
        // leaves no history entry and Back still works.
        const SITE = 'https://campusclash.io';
        const TITLE = 'Campus Clash — College Football Fantasy';
        const DESC = 'Fantasy college football where you draft entire programs, not players. '
            + 'Every Saturday counts.';
        const OG_IMAGE = SITE + '/images/campus-clash-og.png';
        res.type('html').send(
            '<!DOCTYPE html><html lang="en"><head>'
            + '<meta charset="utf-8">'
            + '<meta name="viewport" content="width=device-width, initial-scale=1">'
            + '<meta name="robots" content="noindex">'
            + '<title>' + TITLE + '</title>'
            + '<meta name="description" content="' + DESC + '">'
            // Open Graph (iMessage, Facebook, Slack, LinkedIn, …)
            + '<meta property="og:type" content="website">'
            + '<meta property="og:site_name" content="Campus Clash">'
            + '<meta property="og:url" content="' + SITE + '/">'
            + '<meta property="og:title" content="' + TITLE + '">'
            + '<meta property="og:description" content="' + DESC + '">'
            + '<meta property="og:image" content="' + OG_IMAGE + '">'
            + '<meta property="og:image:secure_url" content="' + OG_IMAGE + '">'
            + '<meta property="og:image:type" content="image/png">'
            + '<meta property="og:image:width" content="1200">'
            + '<meta property="og:image:height" content="630">'
            + '<meta property="og:image:alt" content="Campus Clash">'
            // Twitter/X large-image card
            + '<meta name="twitter:card" content="summary_large_image">'
            + '<meta name="twitter:title" content="' + TITLE + '">'
            + '<meta name="twitter:description" content="' + DESC + '">'
            + '<meta name="twitter:image" content="' + OG_IMAGE + '">'
            + '<style>html,body{margin:0;background:#101322;color:#F4F6FB;'
            + 'font-family:sans-serif}a{color:#ED5858}</style>'
            + '</head><body>'
            + '<script>location.replace("/login");</script>'
            + '<noscript><p style="padding:24px"><a href="/login">Continue to Campus Clash</a></p></noscript>'
            + '</body></html>'
        );
    }
});

app.get('/valentine', (req, res) => {
    res.render("valentine");
});

app.get('/standings', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        const userState = safeJson(req.effUser);

        res.render('standings', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/rules', async (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        const userState = safeJson(req.effUser);

        // Show the caller's own league by default. Honor ?league= only when the
        // caller may view that league (Admins: any; League Managers: their own),
        // mirroring the Admin-only league switcher on the other pages — so a URL
        // can't reveal a league the user isn't entitled to. Render the rules from
        // the resolved config so the page can never drift from the engine.
        const ownLeague = leagueCodeFor(req.effUser);
        const requested = req.query.league;
        const canView = LEAGUES.some(l => l.code === requested) && canManageLeague(req, requested);
        const leagueCode = canView ? requested : ownLeague;
        let cfg;
        try {
            const doc = await ScoringConfig.findOne({ league: leagueCode });
            cfg = resolveConfig(leagueCode, doc
                ? { model: doc.model, values: doc.values, combineMode: doc.combineMode, disabled: doc.disabled, enabled: doc.enabled, engagement: doc.engagement, engagementBySeason: doc.engagementBySeason }
                : null);
        } catch (err) {
            cfg = resolveConfig(leagueCode, null);
        }
        const fields = fieldsForModel(cfg.model, cfg.disabled, cfg.enabled);
        // Game-mode (H2H/Captain) settings for the active season, so the rules
        // page can spell out the win/tie bonuses when the league runs H2H.
        const engagement = engagementForSeason(cfg.engagementBySeason, Number(process.env.YEAR));

        res.render('scoringRules', { user, userState, cfg, fields, leagueCode, engagement });
    } else {
        res.redirect("/login");
    }
});

app.get('/draft-room', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        user.isDraft = false;
        const userState = safeJson(req.effUser);

        res.render('draftRoom', {user, userState, year: process.env.YEAR});
    } else {
        res.redirect("/login");
    }
});

app.get('/admin', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        // Only commissioners get the admin page; other members go home.
        // Effective roles so a dev role-spoof is honored.
        const roles = devRole.effectiveRoles(req);
        if (!roles.includes('Admin') && !roles.includes('League Manager')) {
            return res.redirect('/');
        }
        const userState = safeJson(req.effUser);
        const isAdmin = roles.includes('Admin');

        res.render('admin', {user, userState, year: process.env.YEAR, isAdmin});
    } else {
        res.redirect("/login");
    }
});

app.get('/index', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        const userState = safeJson(req.effUser);

        res.render('standings', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/userHome', async function(req, res) {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        const userState = safeJson(req.effUser);

        res.render('userHome', {user, userState, year: process.env.YEAR, cloudinary: cloudinaryConfig()});
    } else {
        res.redirect("/login");
    }
});

app.get('/team', async function(req, res) {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        const userState = safeJson(req.effUser);

        res.render('team', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/hall-of-fame', async function(req, res) {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        const userState = safeJson(req.effUser);

        res.render('history', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.use(express.json());
app.use(express.static('public'));
app.use('/images',  express.static('images'));

// Authorization for state-changing (non-GET) API calls, in two tiers:
//   - Platform-wide data sync, scoring runs, and market odds -> Admin only
//     (requireAdmin).
//   - League-scoped setup (roster, draft, scoring config, league name) -> any
//     commissioner (requireCommissioner); the handlers additionally enforce
//     that a League Manager can only touch their OWN league.
// GET reads stay open to any authenticated member, and the internal token
// passes both tiers so scheduled jobs keep working. /teams/teamLogos is a
// member-safe POST read, so it's exempted.
app.use('/teams', (req, res, next) => {
    if (req.method === 'GET' || (req.method === 'POST' && req.path === '/teamLogos')) return next();
    return requireAdmin(req, res, next);
});
app.use(['/scores', '/records', '/games', '/betting', '/rankings', '/recruiting', '/job-runs', '/audit-log'], (req, res, next) => {
    if (req.method === 'GET') return next();
    return requireAdmin(req, res, next);
});
app.use(['/users', '/draft', '/scoring-config', '/leagues'], (req, res, next) => {
    if (req.method === 'GET') return next();
    // Self-service profile edit is scoped to the caller's own record (identity
    // comes from the session in the handler), so it doesn't need commissioner.
    if (req.method === 'PATCH' && (req.path === '/me/profile' || req.path === '/me/captain')) return next();
    return requireCommissioner(req, res, next);
});

const usersRouter = require('./routes/users');
app.use('/users', requireAuthOrToken, usersRouter);

const teamsRouter = require('./routes/teams');
app.use('/teams', requireAuthOrToken, teamsRouter);

const gamesRouter = require('./routes/games');
app.use('/games', requireAuthOrToken, gamesRouter);

const rankingsRouter = require('./routes/rankings');
app.use('/rankings', requireAuthOrToken, rankingsRouter);

const scoresRouter = require('./routes/scores');
app.use('/scores', requireAuthOrToken, scoresRouter);

const recruitingRouter = require('./routes/recruiting');
app.use('/recruiting', requireAuthOrToken, recruitingRouter);

const recordRouter = require('./routes/records');
app.use('/records', requireAuthOrToken, recordRouter);

const bettingRouter = require('./routes/betting');
app.use('/betting', requireAuthOrToken, bettingRouter);

const draftRouter = require('./routes/draft');
app.use('/draft', requireAuthOrToken, draftRouter);

const scoringConfigRouter = require('./routes/scoringConfig');
app.use('/scoring-config', requireAuthOrToken, scoringConfigRouter);

const leaguesRouter = require('./routes/leagues');
app.use('/leagues', requireAuthOrToken, leaguesRouter);

// Dev-only role spoofing: a real Admin (non-production only) can view the app
// as a League Manager or a regular member to test permissions. Sets/clears the
// cookie the effective-roles resolver reads. Returns 404 in production or for
// anyone who isn't a real Admin, so it can never be an escalation path.
app.post('/dev/spoof', (req, res) => {
    if (!devRole.DEV || !devRole.isRealAdmin(req)) return res.status(404).end();
    const role = (req.body && req.body.role) || '';   // 'Admin' | 'League Manager' | 'member'
    const league = (req.body && req.body.league) || undefined;
    const roles = role === 'member' ? [] : (role ? [role] : []);
    res.cookie(devRole.SPOOF_COOKIE, JSON.stringify({ roles, league }), { sameSite: 'lax', httpOnly: true });
    res.json({ ok: true, roles, league: league || null });
});
app.post('/dev/spoof/reset', (req, res) => {
    if (!devRole.DEV || !devRole.isRealAdmin(req)) return res.status(404).end();
    res.clearCookie(devRole.SPOOF_COOKIE);
    res.json({ ok: true });
});

const jobRunsRouter = require('./routes/jobRuns');
app.use('/job-runs', requireAuthOrToken, jobRunsRouter);

const auditLogRouter = require('./routes/auditLog');
app.use('/audit-log', requireAuthOrToken, auditLogRouter);

const standingsRouter = require('./routes/standings');
app.use('/standings', requireAuthOrToken, standingsRouter);

const historyRouter = require('./routes/history');
app.use('/history', requireAuthOrToken, historyRouter);

app.get('/calculate-team-score/:season/:teamId/:teamName', requireAdmin, async (req, res) => {
    var response = await scoringModule.calculateTeamScores(req.params.season, req.params.teamId, req.params.teamName);

    if (response.status == 200) {
        res.status(200).json(response.updatedTeam);
    } else {
        res.status(400).json("Bad Request");
    }
});

// Terminal handlers — must stay last, after every route and router above, since
// Express matches in registration order and these two claim everything left.
const { notFound, errorHandler } = require('./modules/http-errors');
app.use(notFound);
app.use(errorHandler);

// Wrap Express in an HTTP server so Socket.IO (live draft) can share the port.
const server = http.createServer(app);
const io = new Server(server);
registerDraftSockets(io);

server.listen(process.env.PORT || 3000, () =>{
    console.log('Server Started');

    // Run the score-update jobs in-process on a schedule (America/Chicago),
    // replacing Heroku Scheduler. Gated so it only runs on the deployed dyno,
    // not on local dev machines or in tests.
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_SCHEDULER === 'true') {
        require('./modules/scheduler').start();
        console.log('In-process job scheduler started');
    }
});
