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
const ScoringConfig = require('./models/scoringConfig');
const { resolveConfig, fieldsForModel } = require('./modules/scoring-defaults');
const draftToken = require('./modules/draft-token');
const registerDraftSockets = require('./modules/draft-socket');

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

// auth router attaches /login, /logout, and /callback routes to the baseURL
app.use(auth(config));

const { requiresAuth } = require('express-openid-connect');

app.get('/profile', requiresAuth(), (req, res) => {
  res.send(JSON.stringify(req.oidc.user));
});

// Mint a short-lived signed token the browser uses to authenticate its draft
// socket connection. Requires a real Auth0 session so the identity is trusted.
app.get('/draft-token', requiresAuth(), (req, res) => {
  const ctx = buildUserContext(req.oidc.user);
  const token = draftToken.sign(
    { userId: ctx.userId, role: ctx.role, name: ctx.firstName },
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
        const user = buildUserContext(req.oidc.user);

        const userState = safeJson(req.oidc.user);

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
        const user = buildUserContext(req.oidc.user);
        const userState = safeJson(req.oidc.user);

        res.render('standings', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/rules', async (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.oidc.user);
        const userState = safeJson(req.oidc.user);

        // Render the rules from the league's scoring config so the page can
        // never drift from the engine.
        const leagueCode = user.league === 'gg' ? 'graham-league' : 'claunts-league';
        let cfg;
        try {
            const doc = await ScoringConfig.findOne({ league: leagueCode });
            cfg = resolveConfig(leagueCode, doc
                ? { model: doc.model, values: doc.values, combineMode: doc.combineMode, disabled: doc.disabled }
                : null);
        } catch (err) {
            cfg = resolveConfig(leagueCode, null);
        }
        const fields = fieldsForModel(cfg.model, cfg.disabled);

        res.render('scoringRules', { user, userState, cfg, fields });
    } else {
        res.redirect("/login");
    }
});

app.get('/draft-room', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.oidc.user);
        user.isDraft = false;
        const userState = safeJson(req.oidc.user);

        res.render('draftRoom', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/admin', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.oidc.user);
        // Only commissioners get the admin page; other members go home.
        const roles = (req.oidc.user && req.oidc.user.user_metadata && req.oidc.user.user_metadata.roles) || [];
        if (!roles.includes('Admin') && !roles.includes('League Manager')) {
            return res.redirect('/');
        }
        const userState = safeJson(req.oidc.user);

        res.render('admin', {user, userState, year: process.env.YEAR});
    } else {
        res.redirect("/login");
    }
});

app.get('/index', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.oidc.user);
        const userState = safeJson(req.oidc.user);

        res.render('standings', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/userHome', async function(req, res) {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.oidc.user);
        const userState = safeJson(req.oidc.user);

        res.render('userHome', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/team', async function(req, res) {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.oidc.user);
        const userState = safeJson(req.oidc.user);

        res.render('team', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.use(express.json());
app.use(express.static('public'));
app.use('/images',  express.static('images'));

// Authorization: state-changing (non-GET) API calls require a commissioner
// session or the internal token. Reads stay open to any authenticated member.
// /teams/teamLogos is a POST but a member-safe read, so it's exempted.
app.use('/teams', (req, res, next) => {
    if (req.method === 'GET' || (req.method === 'POST' && req.path === '/teamLogos')) return next();
    return requireCommissioner(req, res, next);
});
app.use(['/users', '/scores', '/records', '/games', '/betting', '/rankings', '/recruiting', '/draft', '/scoring-config', '/job-runs'], (req, res, next) => {
    if (req.method === 'GET') return next();
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

const jobRunsRouter = require('./routes/jobRuns');
app.use('/job-runs', requireAuthOrToken, jobRunsRouter);

const standingsRouter = require('./routes/standings');
app.use('/standings', requireAuthOrToken, standingsRouter);

app.get('/calculate-team-score/:season/:teamId/:teamName', requireCommissioner, async (req, res) => {
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
