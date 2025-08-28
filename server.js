if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const { default: axios } = require('axios');
const express = require('express');
const app = express();
const retrieveGamesModule = require('./modules/retrieve-games.js');
const scoringModule = require('./modules/scoring.js');
const schedule = require('node-schedule');
const { auth } = require('express-openid-connect');

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
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false
        };

        const userState = JSON.stringify(req.oidc.user);

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
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false
        };
        const userState = JSON.stringify(req.oidc.user);

        res.render('standings', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/rules', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false
        };
        const userState = JSON.stringify(req.oidc.user);

        res.render('scoringRules' + req.oidc.user.user_metadata.metadata.league, {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/draft-room', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false,
            isDraft: false
        };
        const userState = JSON.stringify(req.oidc.user);

        res.render('draftRoom', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/admin', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false
        };
        const userState = JSON.stringify(req.oidc.user);

        res.render('admin', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/index', (req, res) => {
    if (req.oidc.isAuthenticated()) {
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false
        };
        const userState = JSON.stringify(req.oidc.user);

        res.render('standings', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/userHome', async function(req, res) {
    if (req.oidc.isAuthenticated()) {
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false
        };
        const userState = JSON.stringify(req.oidc.user);

        res.render('userHome', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.get('/team', async function(req, res) {
    if (req.oidc.isAuthenticated()) {
        const user = {
            firstName: req.oidc.user.name,
            role: req.oidc.user.user_metadata.roles.length > 0 ? req.oidc.user.user_metadata.roles[0] : '',
            userId: req.oidc.user.user_metadata.metadata.userId,
            isMaintenance: false
        };
        const userState = JSON.stringify(req.oidc.user);

        res.render('team', {user, userState});
    } else {
        res.redirect("/login");
    }
});

app.use(express.json());
app.use(express.static('public'));
app.use('/images',  express.static('images'));

const usersRouter = require('./routes/users');
app.use('/users', usersRouter);

const teamsRouter = require('./routes/teams');
app.use('/teams', teamsRouter);

const gamesRouter = require('./routes/games');
app.use('/games', gamesRouter);

const rankingsRouter = require('./routes/rankings');
app.use('/rankings', rankingsRouter);

const scoresRouter = require('./routes/scores');
app.use('/scores', scoresRouter);

const recruitingRouter = require('./routes/recruiting');
app.use('/recruiting', recruitingRouter);

const recordRouter = require('./routes/records');
app.use('/records', recordRouter);

const bettingRouter = require('./routes/betting');
app.use('/betting', bettingRouter);

app.get('/calculate-team-score/:season/:teamId/:teamName', async (req, res) => {
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