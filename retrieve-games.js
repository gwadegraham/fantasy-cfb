// Configure API key authorization: ApiKeyAuth
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

var gamesApi = new cfb.GamesApi();

module.exports = {

    retrieveTeams: async () => {
        var response = await fetch(`${process.env.URL}/users/season/${process.env.YEAR}`, {
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
        var uniqueGames;
        var year = process.env.YEAR;
        var opts = {
            'week': week,
            'seasonType': "regular",
            'division': "fbs"
        };

        for (const team of teams) {
            opts.team = team;

            var response = await gamesApi.getGames(year, opts);
            var gameData = await response;

            for (let x = 0; x < gameData.length; x++) {
                allGameData.push(gameData[x]);
            }
        }

        uniqueGames = [...new Set(allGameData)];
        return uniqueGames;
    },
    
    massRetrieveGames: async (week, seasonType) => {

        const response = await fetch(`${process.env.URL}/games/week/mass-create`, {
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

        response.json().then(data => {
            if (response.status == 201) {
                console.log("New Games Successfully Saved");
                return data;
            } else {
                console.log("Failed to save new games");
            }
        });
    },

    retrievePostseasonGames: async (teams, week) => {
        var allGameData = [];
        var uniqueGames;
        var year = process.env.YEAR;
        var opts = {
            'week': week,
            'seasonType': "postseason",
            'division': "fbs"
        };

        for (const team of teams) {
            opts.team = team;

            var response = await gamesApi.getGames(year, opts);
            var gameData = await response;

            for (let x = 0; x < gameData.length; x++) {
                allGameData.push(gameData[x]);
            }
        }

        uniqueGames = [...new Set(allGameData)];
        return uniqueGames;
    },

    retrieveGameBySeasonWeekTeam: async (season, week, team) => {
        var gamePromise = await fetch(process.env.URL + `/games/seasonType/${season}/week/${week}/team/${team.school}`, {
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
            var savedGamePromise = await fetch(process.env.URL + "/games", {
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
    }
};