const { internalFetch } = require('./internal-api');

// Configure CFB Data
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

const { getCalendar } = require('./cfbd-calendar');
const retrieveGamesModule = require('./retrieve-games.js');
const scoringModule = require('./scoring.js');
const teamScoringModule = require('./team-scoring.js');
const recordsModule = require('./records.js');
const bettingModule = require('./betting.js');

// Distinct postseason weeks present in a mass-pull result, ascending. The
// 12-team CFP spreads across several postseason weeks and scoring keys entries
// by (season, week), so we score each one. Falls back to [1] when no weeks are
// present (e.g. schedule not loaded yet) to preserve the historical behavior.
function postseasonWeeksToScore(massResult) {
    const games = [].concat((massResult && massResult.newGames) || [], (massResult && massResult.existingGames) || []);
    const weeks = [...new Set(games.map(g => g.week).filter(w => w != null))].sort((a, b) => a - b);
    return weeks.length ? weeks : [1];
}

// At most one bracket pull per day. The facts scoring reads — which game is which
// round, the seeds, the first-round byes — are fixed when the bracket publishes on
// selection day; only `outcome` / `champion` move as games finish, and nothing
// reads those yet. So a daily pull is plenty, and the alternative is expensive:
// EVERY caller of runFullUpdate hits this, including the game-day live poller
// (modules/live-poll.js), which fires every 10 minutes while a postseason game is
// live and budgets itself at ~1 CFBD call per poll.
const BRACKET_MAX_AGE_HOURS = 24;

// Refreshes the season's CFP bracket — one CFBD call at most once a day, and only
// on postseason runs, so it costs nothing outside December/January.
//
// Never throws. Before selection day there's no bracket to store and the refresh
// answers 400; that's the normal state for most of the postseason window, not a
// failure worth aborting a scoring run over. Postseason scoring reads the
// bracket when it's there and falls back to CFBD's game notes when it isn't.
async function refreshCfpBracket(season) {
    try {
        const response = await internalFetch(`${process.env.URL}/playoffs/cfp/${season}/refresh`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxAgeHours: BRACKET_MAX_AGE_HOURS })
        });
        const data = await response.json();
        if (response.status == 201) {
            console.log(`✅ CFP bracket refreshed: ${data.games} games (${data.status})`);
        } else if (data && data.skipped) {
            console.log(`CFP bracket already ${data.ageHours}h old, not re-pulling`);
        } else {
            console.log(`ℹ️ CFP bracket not stored (${response.status}): ${data && data.message}`);
        }
        return data;
    } catch (err) {
        console.log('ℹ️ CFP bracket refresh failed, scoring from game notes:', err.message);
        return null;
    }
}

// The shared "update everything for the current week" pipeline that the daily /
// Saturday / Sunday jobs all run. Determines the current week from the CFBD
// calendar, ensures rankings exist, pulls games, then updates scores, cumulative
// scores, team scores and records. `withBetting` also refreshes betting lines —
// only the daily job did that historically, so it stays opt-in.
// Returns { week, seasonType } for logging.
async function runFullUpdate({ withBetting = false } = {}) {

    // Cached per-season (modules/cfbd-calendar.js): the week windows are static
    // intra-day, so frequent polls reuse one fetch instead of spending a CFBD
    // call each time just to compute the current week.
    var calendar = await getCalendar(process.env.YEAR);
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
    var remainingCalls;

    if (isPostseason) {
        // One CFBD call pulls the whole postseason slate (all CFP rounds).
        var games = await retrieveGamesModule.massRetrieveGames(null, "postseason");
        gamesNew = games.newGames.length;
        gamesUpdated = games.existingGames.length;
        remainingCalls = games.remainingCalls;
        console.log("number of returned new games", gamesNew);
        console.log("number of returned existing games", gamesUpdated);

        // Before scoring, not after: the bracket is what tells scoring which
        // round each game is.
        await refreshCfpBracket(season);

        // The 12-team CFP spans several postseason weeks, and scoring keys each
        // entry by (season, week) — so score every week present, not just week 1.
        var postWeeks = postseasonWeeksToScore(games);
        for (const pw of postWeeks) {
            await scoringModule.updateScores("postseason", pw);
        }
        week = postWeeks[postWeeks.length - 1];   // report the latest for logging

        // H2H bonuses are regular-season only, but the pass still runs here: a
        // postseason update is often the first job after a late regular week
        // settles, and the pass is a no-op once everything is already applied.
        await scoringModule.applyH2HBonuses();
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
        remainingCalls = games.remainingCalls;
        console.log("number of returned new games", gamesNew);
        console.log("number of returned existing games", gamesUpdated);

        await scoringModule.updateScores("regular", weekNumber);
        // Between weekly scoring and cumulative totals: the bonus is folded into
        // the weekly scores that updateCumulativeScores then sums.
        await scoringModule.applyH2HBonuses();
        await scoringModule.updateCumulativeScores();
        await teamScoringModule.updateAllTeamScores();
        await recordsModule.updateAllTeamRecords();
        if (withBetting) await bettingModule.updateAllBettingLines();
    }

    return { week, seasonType, teams: teamCount, gamesNew, gamesUpdated, remainingCalls };
}

module.exports = { runFullUpdate, postseasonWeeksToScore, refreshCfpBracket, BRACKET_MAX_AGE_HOURS };
