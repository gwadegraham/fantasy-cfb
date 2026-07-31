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
const { leagueCodeFor, canManageLeague } = require('./modules/league-access');
const ScoringConfig = require('./models/scoringConfig');
const User = require('./models/user');
const League = require('./models/league');
const { resolveConfig, fieldsForModel, LEAGUES } = require('./modules/scoring-defaults');
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
                    { avatarUrl: 1, color: 1, firstName: 1, lastName: 1 }).lean();
                if (u) {
                    const initials = (((u.firstName || '')[0] || '') + ((u.lastName || '')[0] || '')).toUpperCase();
                    res.locals.navUser = {
                        avatarUrl: u.avatarUrl || null,
                        color: u.color || null,
                        initials: initials || null
                    };
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



// req.isAuthenticated is provided from the auth router
app.get('/', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);

        const userState = safeJson(req.effUser);

        res.render('standings', {user, userState});
    } else {
        res.redirect("/login");
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
                ? { model: doc.model, values: doc.values, combineMode: doc.combineMode, disabled: doc.disabled, enabled: doc.enabled }
                : null);
        } catch (err) {
            cfg = resolveConfig(leagueCode, null);
        }
        const fields = fieldsForModel(cfg.model, cfg.disabled, cfg.enabled);

        res.render('scoringRules', { user, userState, cfg, fields, leagueCode });
    } else {
        res.redirect("/login");
    }
});

app.get('/draft-room', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.effUser);
        user.isDraft = false;
        const userState = safeJson(req.effUser);

        res.render('draftRoom', {user, userState});
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
app.use(['/scores', '/records', '/games', '/betting', '/rankings', '/recruiting', '/job-runs'], (req, res, next) => {
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
