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

// Asks the app whether a regular-season week still has drafted-team games that
// kicked off and aren't final (see modules/admin-status.js pendingRegularWeek).
// Goes through the API like every other step so it works in-process and from a
// standalone job run alike. A failed check degrades to the old behaviour —
// postseason only — and the next run tries again, so it never blocks scoring.
async function fetchPendingRegularWeek(season) {
    try {
        const res = await internalFetch(`${process.env.URL}/scores/pending-regular/${season}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        const data = await res.json();
        if (res.status == 200 && data && data.week != null) return Number(data.week);
    } catch (err) {
        console.log('Could not check for a trailing regular week:', err.message);
    }
    return null;
}

// Which week + phase the pipeline should score right now, from a CFBD calendar.
//
// CFBD's calendar is a list of CONTIGUOUS windows: each entry's lastGameStart is
// the next entry's firstGameStart, and the final entry closes weeks after the
// national championship. So "the current week" is simply the last window that
// has opened. Returns:
//
//   { week, seasonType }  a window covers `now`
//   { skip: reason }      before the first window, or after the last one closed
//
// and THROWS when the calendar is unusable. That last part is the point of this
// function. It replaced a loop that initialized `weekNumber = 1` and could not
// tell "it is week 1" apart from "no window matched" — so an empty calendar (a
// CFBD hiccup, or an empty response served from cache) silently rescored week 1
// mid-season while reporting success, and every offseason run did the same for
// months. Guessing a week is worse than failing: a failed run records a JobRun
// error and emails, a wrong week quietly leaves the real week unscored.
//
// `seasonType` comes from the matched entry rather than being inferred, so the
// postseason is recognized however CFBD numbers its weeks.
function resolveCurrentWeek(calendar, now) {
    if (!Array.isArray(calendar) || !calendar.length) {
        throw new Error('CFBD calendar unavailable or empty — refusing to guess the current week');
    }

    // Sorted by start rather than trusting array order, and entries without a
    // parseable kickoff boundary are dropped — a single garbled row must not be
    // able to shift which week gets scored.
    const windows = calendar
        .map(c => ({
            week: c && c.week,
            seasonType: (c && c.seasonType) === 'postseason' ? 'postseason' : 'regular',
            start: Date.parse((c && c.firstGameStart) || ''),
            end: Date.parse((c && c.lastGameStart) || '')
        }))
        .filter(w => w.week != null && !Number.isNaN(w.start))
        .sort((a, b) => a.start - b.start);

    if (!windows.length) {
        throw new Error('CFBD calendar has no usable week windows — refusing to guess the current week');
    }

    const t = now.getTime();
    const opened = windows.filter(w => w.start <= t);
    if (!opened.length) {
        return { skip: 'preseason — the first week has not started' };
    }

    // In a gap between windows this lands on the week that just ended, which is
    // the one that still needs finalizing.
    const current = opened[opened.length - 1];
    const isFinalWindow = current === windows[windows.length - 1];
    if (isFinalWindow && !Number.isNaN(current.end) && t > current.end) {
        return { skip: 'season over — the last calendar week has closed' };
    }

    return { week: current.week, seasonType: current.seasonType };
}

// Only one full update at a time in this process.
//
// The scheduler and the live poller share the one web dyno, and their rules
// collide by construction: saturday-scores fires at 15:00/18:00/22:00 on the
// minute, and the live poller fires on every :00 mark. So three times every
// Saturday two full updates ran concurrently — two CFBD pulls of the same slate
// (double spend against the monthly budget) and two passes reading, mutating and
// writing back the same weeklyScore arrays.
//
// In-process only. A standalone `node update-daily-scores-job.js` on another host
// isn't covered; the unique index on Game.id is what makes the ingest itself safe
// regardless of who is running it.
let inFlight = null;

function runFullUpdate(opts) {
    if (inFlight) {
        console.log('A full update is already running — skipping this one');
        return Promise.resolve({
            skipped: 'a full update was already running', week: null, seasonType: null,
            teams: 0, gamesNew: 0, gamesUpdated: 0
        });
    }
    inFlight = doFullUpdate(opts || {}).finally(() => { inFlight = null; });
    return inFlight;
}

// The shared "update everything for the current week" pipeline that the daily /
// Saturday / Sunday jobs all run. Determines the current week from the CFBD
// calendar, ensures rankings exist, pulls games, then updates scores, cumulative
// scores, team scores and records. `withBetting` also refreshes betting lines —
// only the daily job did that historically, so it stays opt-in.
// Returns { week, seasonType } for logging, or { skipped } out of season.
async function doFullUpdate({ withBetting = false } = {}) {

    // Cached per-season (modules/cfbd-calendar.js): the week windows are static
    // intra-day, so frequent polls reuse one fetch instead of spending a CFBD
    // call each time just to compute the current week.
    var calendar = await getCalendar(process.env.YEAR);
    var resolved = resolveCurrentWeek(calendar, new Date());

    if (resolved.skip) {
        console.log(`Nothing to score — ${resolved.skip}`);
        return { skipped: resolved.skip, week: null, seasonType: null, teams: 0, gamesNew: 0, gamesUpdated: 0 };
    }

    var weekNumber = resolved.week;
    var isPostseason = resolved.seasonType === 'postseason';

    console.log("It is currently Week", weekNumber);
    console.log("Is it the postseason yet? ", isPostseason);

    const season = process.env.YEAR;
    var seasonType = resolved.seasonType;
    var week = isPostseason ? 1 : weekNumber;

    // Make sure the rankings doc the ENGINE will actually read exists.
    //
    // Regular season only. Postseason games are scored against the LATEST
    // regular-season poll (modules/scoring.js getRankingsForGame) — a doc written
    // months earlier, during the season — so a postseason run has nothing to
    // create. And no postseason rule reads a rank anyway; they all key off notes
    // or home/away.
    //
    // This used to ask for a `postseason` rankings doc. CFBD publishes none until
    // after the title game (`/rankings?year=2026&week=1&seasonType=postseason`
    // returns []), so retrieveRankings threw on data[0].polls and 400'd — every
    // run, all bowl season. With live polling at postseason cadence that is a CFBD
    // call every 10 minutes against a 1,000/month budget, for a document nothing
    // would ever read.
    if (!isPostseason) {
        var rankingsRes = await internalFetch(`${process.env.URL}/rankings/${season}/${weekNumber}/regular`, {
            method: 'GET',
            headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
            }
        });
        // Drain the body — an unread response body holds its socket open, and
        // this runs on every poll.
        await rankingsRes.json().catch(() => null);

        if (rankingsRes.status == 200) {
            console.log(`Rankings already in system for Season: ${season}, Season Type: regular, Week: ${weekNumber}`);
        } else {
            const created = await internalFetch(`${process.env.URL}/rankings/retrieveRankings`, {
                method: 'POST',
                headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
                },
                body: JSON.stringify({ season: String(season), seasonType: 'regular', week: String(weekNumber) }),
            });

            const data = await created.json().catch(() => null);
            if (created.status == 201) {
                console.log("New Rankings", data);
            } else {
                console.log(created.status + " Rankings could not be retrieved");
            }
        }
    }

    var teamCount = 0;
    var gamesNew = 0;
    var gamesUpdated = 0;
    var remainingCalls;

    if (isPostseason) {
        // CFBD's postseason window OPENS BEFORE the regular season's last game
        // kicks off: in 2026 the week-15 window closes 2026-12-12T07:59Z while
        // Army–Navy (a week-15 regular-season game) kicks off at 20:00Z that same
        // day. The postseason pull below is `seasonType=postseason`, which never
        // contains that game — so without this the trailing week keeps the 0 it
        // was seeded with and the result is silently lost.
        //
        // Runs FIRST so the shared applyH2HBonuses / updateCumulativeScores /
        // team-score passes below fold in both phases. Costs nothing once the
        // trailing week's games are final: the endpoint answers null and this
        // whole block is skipped.
        var trailingWeek = await fetchPendingRegularWeek(season);
        if (trailingWeek != null) {
            console.log(`Regular week ${trailingWeek} still has games to finalize — pulling it alongside the postseason`);
            var trailing = await retrieveGamesModule.massRetrieveGames(trailingWeek, "regular");
            if (trailing) {
                gamesNew += (trailing.newGames || []).length;
                gamesUpdated += (trailing.existingGames || []).length;
            }
            await scoringModule.updateScores("regular", trailingWeek);
        }

        // One CFBD call pulls the whole postseason slate (all CFP rounds).
        var games = await retrieveGamesModule.massRetrieveGames(null, "postseason");
        gamesNew += games.newGames.length;
        gamesUpdated += games.existingGames.length;
        remainingCalls = games.remainingCalls;
        console.log("number of returned new games", gamesNew);
        console.log("number of returned existing games", gamesUpdated);

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

module.exports = {
    runFullUpdate, postseasonWeeksToScore, resolveCurrentWeek,
    // Exported so a test can prove the overlap guard releases; nothing in the app
    // should need to clear it.
    _clearInFlight: () => { inFlight = null; }
};
