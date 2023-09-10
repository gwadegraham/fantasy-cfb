// Configure CFB Data
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

const retrieveGamesModule = require('./retrieve-games.js');
const scoringModule = require('./scoring.js');

async function updateScores () {

    var gamesApi = new cfb.GamesApi();
    var calendar = await gamesApi.getCalendar(process.env.YEAR);
    var weekNumber = 1;
    var isPostseason = false;

    console.log("calendar => ", calendar);

    if (calendar) {
        for (const calendarWeek of calendar) {
            var startDate = new Date(calendarWeek.firstGameStart);
            var endDate = new Date(calendarWeek.lastGameStart);
            var currentDate = new Date();

            console.log("currentDate", currentDate);
            console.log("startDate", startDate);
            console.log("endDate", endDate);
            console.log("(currentDate > startDate) && (currentDate < endDate)", (currentDate > startDate) && (currentDate < endDate));

            if ((currentDate > startDate) && (currentDate < endDate)) {
                console.log("calendarWeek.week", calendarWeek.week);
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
}

updateScores();