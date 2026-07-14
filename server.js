if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const express = require('express');
const app = express();
const retrieveGamesModule = require('./modules/retrieve-games.js');
const scoringModule = require('./modules/scoring.js');
const schedule = require('node-schedule');
const { auth } = require('express-openid-connect');
const requireAuthOrToken = require('./modules/require-auth');

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

app.get('/rules', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = buildUserContext(req.oidc.user);
        const userState = safeJson(req.oidc.user);

        res.render('scoringRules' + user.league, {user, userState});
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
        const userState = safeJson(req.oidc.user);

        res.render('admin', {user, userState});
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

app.get('/calculate-team-score/:season/:teamId/:teamName', requireAuthOrToken, async (req, res) => {
    var response = await scoringModule.calculateTeamScores(req.params.season, req.params.teamId, req.params.teamName);

    if (response.status == 200) {
        res.status(200).json(response.updatedTeam);
    } else {
        res.status(400).json("Bad Request");
    }
});

app.listen(process.env.PORT || 3000, () =>{
    console.log('Server Started');
});
