const { internalFetch } = require('./internal-api');
const { withRetry } = require('./retry');

// Configure CFB Data
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

const retrieveGamesModule = require('./retrieve-games.js');
const scoringModule = require('./scoring.js');
const teamScoringModule = require('./team-scoring.js');
const recordsModule = require('./records.js');
const bettingModule = require('./betting.js');

// The shared "update everything for the current week" pipeline that the daily /
// Saturday / Sunday jobs all run. Determines the current week from the CFBD
// calendar, ensures rankings exist, pulls games, then updates scores, cumulative
// scores, team scores and records. `withBetting` also refreshes betting lines —
// only the daily job did that historically, so it stays opt-in.
// Returns { week, seasonType } for logging.
async function runFullUpdate({ withBetting = false } = {}) {

    var gamesApi = new cfb.GamesApi();
    var calendar = await withRetry(() => gamesApi.getCalendar(process.env.YEAR), { label: 'getCalendar' });
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
            } else if ((currentDate < startDate) && (calendarWeek.week == 1)) {
                weekNumber = 1;
                break;
            } else if ((currentDate < startDate) && (calendarWeek.week > 1)) {
                weekNumber = (calendarWeek.week - 1);
                break;
            }
        }
    }

    console.log("It is currently Week", weekNumber);
    console.log("Is it the postseason yet? ", isPostseason);

    const season = process.env.YEAR;
    var seasonType = '';
    var week = weekNumber;

    if (!isPostseason) {
        seasonType = "regular";
    } else {
        seasonType = "postseason";
        week = 1;
    }

    var response = await internalFetch(`${process.env.URL}/rankings/${season}/${week}/${seasonType}`, {
        method: 'GET',
        headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
        }
    });

    var rankings = await response;

    if (rankings.status == 200) {
        console.log(`Rankings already in system for Season: ${season}, Season Type: ${seasonType}, Week: ${week}`);
    } else {
        const response = await internalFetch(`${process.env.URL}/rankings/retrieveRankings`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "season": "${season}",
            "seasonType": "${seasonType}",
            "week": "${week}"
            }`,
        });

        await response.json().then(data => {
            if (response.status == 201) {
                console.log("New Rankings", data);
            } else {
                console.log(response.status + " Rankings could not be retrieved");
            }
        });
    }

    var teamCount = 0;
    var gamesNew = 0;
    var gamesUpdated = 0;

    if (isPostseason) {
        var teams = await retrieveGamesModule.retrieveTeams();
        teamCount = teams.length;
        console.log("number of returned teams", teamCount);

        var games = await retrieveGamesModule.retrievePostseasonGames(teams, 1);
        gamesNew = games.length;
        console.log("number of returned games", gamesNew);

        await retrieveGamesModule.saveGames(games);
        await scoringModule.updateScores("postseason", 1);
        await scoringModule.updateCumulativeScores();
        await teamScoringModule.updateAllTeamScores();
        await recordsModule.updateAllTeamRecords();
        if (withBetting) await bettingModule.updateAllBettingLines();
    } else {
        var teams = await retrieveGamesModule.retrieveTeams();
        teamCount = teams.length;
        console.log("number of returned teams", teamCount);

        var games = await retrieveGamesModule.massRetrieveGames(weekNumber, "regular");
        gamesNew = games.newGames.length;
        gamesUpdated = games.existingGames.length;
        console.log("number of returned new games", gamesNew);
        console.log("number of returned existing games", gamesUpdated);

        await scoringModule.updateScores("regular", weekNumber);
        await scoringModule.updateCumulativeScores();
        await teamScoringModule.updateAllTeamScores();
        await recordsModule.updateAllTeamRecords();
        if (withBetting) await bettingModule.updateAllBettingLines();
    }

    return { week, seasonType, teams: teamCount, gamesNew, gamesUpdated };
}

module.exports = { runFullUpdate };
