const { internalFetch } = require('./internal-api');

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
//
// seasonType is always required. A week is required for regular-season pulls (we
// fetch one week at a time), but NOT for postseason: CFBD returns the whole
// postseason slate in one call when week is omitted, and it can span several
// weeks (12-team CFP), so we pull every round at once.
function massCreateInputError(week, seasonType) {
    if (!seasonType) return 'seasonType is required';
    if (seasonType !== 'postseason' && !week) return 'week is required for regular-season requests';
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

    // Ingest a whole slate in ONE CFBD call via the /games/week/mass-create
    // route. Regular season fetches a single week; postseason omits the week to
    // pull every CFP round at once. Returns { newGames, existingGames,
    // remainingCalls } — remainingCalls comes from CFBD's x-calllimit-remaining
    // header so callers can track the budget for free.
    massRetrieveGames: async (week, seasonType) => {
        const payload = { seasonType };
        if (week != null && week !== '') payload.week = String(week);

        const response = await internalFetch(`${process.env.URL}/games/week/mass-create`, {
            method: 'POST',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
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

    retrieveGameBySeasonWeekTeam: async (season, week, team) => {
        var gamePromise = await internalFetch(process.env.URL + `/games/seasonType/${season}/week/${week}/team/${team.id}`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json'
            }
        });
    
        var game = await gamePromise;
        var response = await game.json();

        // The route answers "no game this week" with 200 + [], so a non-200 here
        // is a real failure (500 / network) rather than an empty slate.
        if (game.status == 200) {
            return response;
        }

        console.error(`Could not load games for ${team.school}: ${response.message}`);
        return [];
    },

    // Exported for testing.
    dedupeGamesById: dedupeGamesById,
    massCreateInputError: massCreateInputError,
    gamesResponseError: gamesResponseError
};