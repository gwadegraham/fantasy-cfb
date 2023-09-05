if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config()
}

const { default: axios } = require('axios');
const express = require('express');
const app = express();
const retrieveGamesModule = require('./retrieve-games.js');
const scoringModule = require('./scoring.js');
const schedule = require('node-schedule');




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

// Routing
const path = require('path')

app.use(express.json());
app.use(express.static('public'));
app.use('/images',  express.static('images'));

const usersRouter = require('./routes/users');
app.use('/users', usersRouter);

const teamsRouter = require('./routes/teams');
app.use('/teams', teamsRouter);

const gamesRouter = require('./routes/games');
const { printTeams } = require('./retrieve-games.js');
app.use('/games', gamesRouter);

app.get('/top-25', (req, res) => {
    var year = process.env.YEAR;
    var opts = {
        'week': 1,
        'seasonType': "regular", // {String} Season type filter (regular or postseason)
    };

    rankingsApi.getRankings(year, opts).then(data => res.json(data[0].polls[0]));
});

app.post('/games-api', (req, res) => {
    var gamesApi = new cfb.GamesApi();
    var year = process.env.YEAR;
    var opts = {
        'week': 1,
        'division': "fbs",
        'team': req.body.team
    };

    gamesApi.getGames(year, opts).then(data => res.json(data));
});



const job = schedule.scheduleJob('0 3 * * *', async function(){

    var gamesApi = new cfb.GamesApi();
    var calendar = await gamesApi.getCalendar(process.env.YEAR);
    var weekNumber = 1;
    var isPostseason = false;

    if (calendar) {
        for (const calendarWeek of calendar) {
            var startDate = new Date(calendarWeek.firstGameStart);
            var endDate = new Date(calendarWeek.lastGameStart);
            var currentDate = new Date();

            if ((currentDate > startDate) && (currentDate < endDate)) {
                weekNumber = calendarWeek.week;
                if (calendarWeek.seasonType == "postseason") {
                    isPostseason = true;
                }
                break;
            }
        }
    }

    console.log("It is currently Week", weekNumber);
    console.log("Is it the postseason yet? ", isPostseason);

    if (isPostseason) {
        var teams = await retrieveGamesModule.retrieveTeams();
        console.log("number of returned teams", teams.length);

        var games = await retrieveGamesModule.retrievePostseasonGames(teams, 1);
        console.log("number of returned games", games.length);

        await retrieveGamesModule.saveGames(games);
        await scoringModule.updateScores("postseason", 1);
        await scoringModule.updateCumulativeScores();
    } else {
        var teams = await retrieveGamesModule.retrieveTeams();
        console.log("number of returned teams", teams.length);

        var games = await retrieveGamesModule.retrieveGames(teams, weekNumber);
        console.log("number of returned games", games.length);

        await retrieveGamesModule.saveGames(games);
        await scoringModule.updateScores("regular", weekNumber);
        await scoringModule.updateCumulativeScores();
    }
});

app.listen(process.env.PORT || 3000, () =>{
    console.log('Server Started');
});