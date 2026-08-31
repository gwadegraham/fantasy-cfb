const { internalFetch } = require('./internal-api');

// Configure CFB Data
const CFBD_API_KEY = process.env.CFBD_API_KEY;
var cfb = require('cfb.js');
var defaultClient = cfb.ApiClient.instance;
var ApiKeyAuth = defaultClient.authentications['ApiKeyAuth'];
ApiKeyAuth.apiKey = CFBD_API_KEY;

const Game = require('../models/game');
const { getCalendar } = require('./cfbd-calendar');
const retrieveGamesModule = require('./retrieve-games.js');
const scoringModule = require('./scoring.js');
const teamScoringModule = require('./team-scoring.js');
const recordsModule = require('./records.js');
const bettingModule = require('./betting.js');
const { updateFromScoreboard } = require('./scoreboard');
const { ingestBoxScores } = require('./box-scores');

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

// How early to start looking, relative to the first postseason game. The bracket
// publishes on Selection Sunday, which lands BEFORE the postseason calendar
// window opens — in 2026, ~Dec 6 against a window that opens Dec 12. Waiting for
// the window would leave it unfetched for its first six days, so we start
// checking two weeks out and let the pull itself discover when it's live.
const BRACKET_LOOKAHEAD_DAYS = 14;

// Is it worth asking CFBD for the bracket yet? True from BRACKET_LOOKAHEAD_DAYS
// before the first postseason game through the last one — so it covers selection
// day, the whole bowl/CFP run, and nothing else in the year.
//
// Deliberately NOT derived from resolveCurrentWeek. That answers "which week is it
// now", and on selection weekend the correct answer is still the regular season —
// this needs the different question "how close is the postseason", which is a
// lookahead the current-week resolver can't express. So it reads the postseason
// entry's own window instead.
function bracketWindowOpen(calendar, now, lookaheadDays = BRACKET_LOOKAHEAD_DAYS) {
    if (!Array.isArray(calendar)) return false;
    const post = calendar.find(w => w && w.seasonType === 'postseason' && w.firstGameStart);
    if (!post) return false;

    const start = new Date(post.firstGameStart).getTime();
    if (!Number.isFinite(start)) return false;
    const t = now.getTime();
    if (t < (start - lookaheadDays * 86400000)) return false;

    // An unusable end date leaves the window open rather than closed — better to
    // spend the daily call than to silently stop pulling mid-tournament.
    const end = new Date(post.lastGameStart).getTime();
    return !Number.isFinite(end) || t <= end;
}

// Last time we ASKED, whatever the answer. The route's maxAgeHours check compares
// against a stored bracket, so it can't throttle the pre-release period when
// there's nothing stored yet — and that period includes conference championship
// Saturday, when the live poller is firing every 10 minutes. In-process is enough:
// the jobs run inside the one long-lived web dyno (see modules/cfbd-calendar.js),
// and if it restarts, the route's stored-age check covers the post-release case.
let lastBracketAttemptMs = 0;
function resetBracketThrottle() { lastBracketAttemptMs = 0; }

// Refreshes the season's CFP bracket — one CFBD call, at most once a day, and only
// inside the bracket window, so it costs nothing outside December/January.
//
// Never throws. Before selection day there's no bracket to store and the refresh
// answers 400; that's the normal state for the first stretch of the window, not a
// failure worth aborting a scoring run over. Postseason scoring reads the
// bracket when it's there and falls back to CFBD's game notes when it isn't.
async function refreshCfpBracket(season) {
    const gapMs = BRACKET_MAX_AGE_HOURS * 3600000;
    if (lastBracketAttemptMs && (Date.now() - lastBracketAttemptMs) < gapMs) {
        return { skipped: true, reason: 'asked recently' };
    }
    lastBracketAttemptMs = Date.now();

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

    // Before any scoring, and NOT gated on isPostseason: the bracket publishes
    // while the calendar still says regular season, and it's worth having from
    // the day it drops rather than from the first bowl game.
    if (bracketWindowOpen(calendar, new Date())) {
        await refreshCfpBracket(season);
    }

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

    try {
        const { resolveParlays } = require('./parlay-resolve');
        await resolveParlays();
    } catch (err) {
        console.log('Parlay resolution failed (non-fatal):', err.message);
    }

    return { week, seasonType, teams: teamCount, gamesNew, gamesUpdated, remainingCalls };
}

// Lightweight live-update pipeline: fetch the CFBD /scoreboard (1 call),
// write in-progress scores + game state to Game docs, then re-score the
// current week so standings and H2H reflect the live state. Skips the
// full runFullUpdate overhead (calendar resolution, rankings, full game
// pull) since the poller only needs fresh scores.
//
// When a game newly completes, the full scoring pipeline runs for that
// week so final fantasy points, H2H bonuses, and parlays are settled.
// On ticks where nothing completed, we still re-score so in-progress
// fantasy points feed the live H2H win-probability bar.
async function doLiveUpdate() {
    const season = Number(process.env.YEAR);
    const result = await updateFromScoreboard();

    if (!result.updated) {
        return { updated: 0, remainingCalls: result.remainingCalls };
    }

    // Determine what week/seasonType to re-score from the calendar.
    const calendar = await getCalendar(season);
    const resolved = resolveCurrentWeek(calendar, new Date());
    if (resolved.skip) {
        return { updated: result.updated, skipped: resolved.skip, remainingCalls: result.remainingCalls };
    }

    const { week, seasonType } = resolved;
    const isPostseason = seasonType === 'postseason';

    if (isPostseason) {
        // Postseason can span multiple weeks; score all that have games.
        const games = await Game.find({ season, seasonType: 'postseason' }, { week: 1 }).lean();
        const weeks = [...new Set(games.map(g => g.week).filter(w => w != null))].sort((a, b) => a - b);
        for (const pw of (weeks.length ? weeks : [1])) {
            await scoringModule.updateScores('postseason', pw);
        }
    } else {
        await scoringModule.updateScores('regular', week);
    }

    // H2H bonuses + cumulative only when a game completed (they're heavier
    // and only matter once a result is locked in).
    if (result.newlyCompleted.length) {
        // Fetch box scores for newly completed games (1 CFBD call) so stat-based
        // parlay legs can resolve in the same pass as score-based ones.
        try {
            const season = Number(process.env.YEAR);
            const bs = await ingestBoxScores(result.newlyCompleted, season);
            if (typeof bs.remainingCalls === 'number') {
                result.remainingCalls = bs.remainingCalls;
            }
        } catch (err) {
            console.log('Box score ingestion failed (non-fatal):', err.message);
        }

        await scoringModule.applyH2HBonuses();
        await scoringModule.updateCumulativeScores();
        await teamScoringModule.updateAllTeamScores();
        await recordsModule.updateAllTeamRecords();

        try {
            const { resolveParlays } = require('./parlay-resolve');
            await resolveParlays();
        } catch (err) {
            console.log('Parlay resolution failed (non-fatal):', err.message);
        }
    }

    return {
        updated: result.updated,
        newlyCompleted: result.newlyCompleted.length,
        week, seasonType,
        remainingCalls: result.remainingCalls
    };
}

let liveInFlight = null;

function runLiveUpdate() {
    if (liveInFlight) {
        console.log('A live update is already running — skipping');
        return Promise.resolve({ skipped: 'a live update was already running' });
    }
    if (inFlight) {
        console.log('A full update is running — skipping live update');
        return Promise.resolve({ skipped: 'a full update is running' });
    }
    liveInFlight = doLiveUpdate().finally(() => { liveInFlight = null; });
    return liveInFlight;
}

module.exports = {
    runFullUpdate, runLiveUpdate, postseasonWeeksToScore, resolveCurrentWeek,
    refreshCfpBracket, bracketWindowOpen, resetBracketThrottle,
    BRACKET_MAX_AGE_HOURS, BRACKET_LOOKAHEAD_DAYS,
    _clearInFlight: () => { inFlight = null; liveInFlight = null; }
};
