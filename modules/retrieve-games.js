const { internalFetch } = require('./internal-api');
const { withRetry } = require('./retry');
// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

var gamesApi = new cfb.GamesApi();

// Dedupes games by id. Two teams in the same league can play each other, so the
// same game gets collected twice; [...new Set(objects)] does NOT dedupe those
// because each API result is a distinct object reference.
function dedupeGamesById(games) {
    var seen = new Set();
    return games.filter(function (game) {
        if (seen.has(game.id)) {
            return false;
        }
        seen.add(game.id);
        return true;
    });
}

// Guards for the /games/week/mass-create route. Kept pure (no req/res/DB) so
// they can be unit-tested. Return an error message to send as a 400, or null
// when the request is good to process.

// A missing week/seasonType (e.g. the admin dropdown left unselected) must be
// rejected BEFORE calling CFBD: an empty week makes CFBD return a 400 JSON
// object instead of an array, and iterating that object throws "not iterable"
// — an unhandled rejection that crashes the Node process.
function massCreateInputError(week, seasonType) {
    if (!week || !seasonType) return 'week and seasonType are required';
    return null;
}

// Even with valid inputs the CFBD call can fail (rate limit, bad params, etc.),
// returning a non-OK status and a JSON object rather than a games array.
function gamesResponseError(responseOk, status, gameData) {
    if (!responseOk || !Array.isArray(gameData)) {
        return (gameData && gameData.message) ? gameData.message : `CFBD request failed (${status})`;
    }
    return null;
}

module.exports = {

    retrieveTeams: async () => {
        var response = await internalFetch(`${process.env.URL}/users/season/${process.env.YEAR}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });

        var allTeams = [];
        var uniqueTeams;
        var userData = await response.json();

        for (const user of userData) {
            for (const team of user.seasons[0].teams) {
                allTeams.push(team.school);
            }
        }

        uniqueTeams = [...new Set(allTeams)];        
        return uniqueTeams;
    },

    retrieveGames: async (teams, week) => {
        var allGameData = [];
        var year = process.env.YEAR;
        var opts = {
            'week': week,
            'seasonType': "regular",
            'division': "fbs"
        };

        for (const team of teams) {
            opts.team = team;

            try {
                var gameData = await withRetry(() => gamesApi.getGames(year, opts), { label: `getGames(${team})` });
                for (let x = 0; x < gameData.length; x++) {
                    allGameData.push(gameData[x]);
                }
            } catch (err) {
                console.log(`❌ Skipping team ${team} after repeated getGames failures: ${err.message || err}`);
            }
        }

        return dedupeGamesById(allGameData);
    },

    massRetrieveGames: async (week, seasonType) => {

        const response = await internalFetch(`${process.env.URL}/games/week/mass-create`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: `{
            "week": "${week}",
            "seasonType": "${seasonType}"
            }`
        });

        var dataToReturn;

        await response.json().then(data => {
            if (response.status == 201) {
                console.log("New Games Successfully Saved");
                dataToReturn = data;
            } else {
                console.log("Failed to save new games");
            }
        });

        return dataToReturn;
    },

    retrievePostseasonGames: async (teams, week) => {
        var allGameData = [];
        var year = process.env.YEAR;
        var opts = {
            'week': week,
            'seasonType': "postseason",
            'division': "fbs"
        };

        for (const team of teams) {
            opts.team = team;

            try {
                var gameData = await withRetry(() => gamesApi.getGames(year, opts), { label: `getGames(${team})` });
                for (let x = 0; x < gameData.length; x++) {
                    allGameData.push(gameData[x]);
                }
            } catch (err) {
                console.log(`❌ Skipping team ${team} after repeated getGames failures: ${err.message || err}`);
            }
        }

        return dedupeGamesById(allGameData);
    },

    retrieveGameBySeasonWeekTeam: async (season, week, team) => {
        var gamePromise = await internalFetch(process.env.URL + `/games/seasonType/${season}/week/${week}/team/${team.id}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });
    
        var game = await gamePromise;
        var response = await game.json();
    
        var games = new Array();
    
    
        if (game.status == 200) {
            for (const game of response) {
                games.push(game);
            }
        } else {
            console.log(response.message);
        }
    
        return games;
    },

    saveGames: async (games) => {

        for (const game of games) {
            var savedGamePromise = await internalFetch(process.env.URL + "/games", {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: JSON.stringify(game),
            });

            var savedGame = await savedGamePromise;
            var response = await savedGame.json();

            if (savedGame.status == 201) {
                console.log("successfully created game with ID: ", response.id);
            } else {
                console.log(response.message);
            }
        }
    },

    // Exported for testing.
    dedupeGamesById: dedupeGamesById,
    massCreateInputError: massCreateInputError,
    gamesResponseError: gamesResponseError
};