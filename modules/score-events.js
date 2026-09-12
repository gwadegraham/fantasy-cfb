// Pure detection of the in-game moments worth a push notification.
//
// Fed by modules/scoreboard.js, which already holds BOTH the prior DB state and
// the freshly-normalized scoreboard payload for every game on a tick — so every
// event here is derived from data we were fetching anyway. Zero extra CFBD
// calls, and /scoreboard is not billed at all (see modules/live-poll.js).
//
// Deliberately DB-free and side-effect free: this decides *what happened*,
// modules/push-notify.js decides *who hears about it*. That split is what makes
// the interesting logic (clock math, lead flips, transition edges) unit-testable
// without a Mongo harness or a live slate.
//
// Three event types, chosen because each maps to something that actually moves
// a manager's fantasy total or their read on it:
//
//   score       a rostered team put points on the board. Does NOT change fantasy
//               points on its own — both leagues score on WINS (see
//               modules/scoring-defaults.js) — so this is a "your team is doing
//               something" nudge, and it is the noisiest of the three by an
//               order of magnitude. Roster is 10 teams (draft.totalRounds), so
//               a full Saturday is ~40 of these per manager if left unfiltered.
//   leadChange  the team that is winning flipped from one side to the other.
//               This is the moment a manager's expected points actually invert.
//   closeGame   entered crunch time: 4th quarter (or OT), <= 2:00 on the clock,
//               one score apart. Fires on the TRANSITION into that window, which
//               is what keeps it to once per game with no stored state.
//
// A game going final is handled separately: modules/scoreboard.js already tracks
// `newlyCompleted`, and the notifier needs an async scoring lookup to say how
// many points were banked, which does not belong in a pure module.

// Crunch-time thresholds. Env-overridable because "close" is a taste call and
// the right value is the one that survives a live Saturday, not one argued for
// in advance.
const CLOSE_PERIOD = 4;
const CLOSE_CLOCK_SECONDS = Number(process.env.PUSH_CLOSE_CLOCK_SECONDS || 120);
const CLOSE_MARGIN = Number(process.env.PUSH_CLOSE_MARGIN || 8);

// A one-point jump is an extra point and nothing else — a safety is 2, and even
// a defensive conversion return is 2. CFBD sometimes reports the PAT as its own
// tick a beat after the touchdown, which would otherwise buzz a manager twice
// for one scoring drive, the second time for the least interesting kick in the
// sport. Suppressed at DETECTION rather than when building the notification, so
// nothing downstream has to remember the rule.
//
// Note this suppresses the `score` event only. The extra point still moves the
// stored score, so lead changes and the crunch-time margin continue to see it.
const EXTRA_POINT_DELTA = 1;

// "12:34" -> 754. CFBD sends the clock as a display string, and withholds it
// entirely between periods, so null is normal and must not read as 0:00 —
// that would fire crunch-time on every halftime.
function parseClockSeconds(clock) {
    if (typeof clock !== 'string') return null;
    const m = clock.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const mins = Number(m[1]);
    const secs = Number(m[2]);
    if (secs > 59) return null;
    return mins * 60 + secs;
}

// Which side is ahead: 'home', 'away', or null when tied or unknown. null for a
// tie matters — it keeps 0-0 -> 7-0 out of leadChange, because that is a team
// taking a lead, not taking it *from* anyone, and `score` already covers it.
function leaderOf(homePoints, awayPoints) {
    if (typeof homePoints !== 'number' || typeof awayPoints !== 'number') return null;
    if (homePoints > awayPoints) return 'home';
    if (awayPoints > homePoints) return 'away';
    return null;
}

// Is this game inside the crunch-time window right now?
function inCloseWindow(period, clockSeconds, homePoints, awayPoints) {
    if (typeof period !== 'number' || period < CLOSE_PERIOD) return false;
    if (clockSeconds == null || clockSeconds > CLOSE_CLOCK_SECONDS) return false;
    if (typeof homePoints !== 'number' || typeof awayPoints !== 'number') return false;
    return Math.abs(homePoints - awayPoints) <= CLOSE_MARGIN;
}

// Detect events between a game's prior state and this tick's state.
//
// `prev` is the last state we stored (may be null the very first time we see a
// game); `next` is the output of normalizeScoreboardGame. Both use the same
// field names as the Game schema.
//
// Returns [] for a completed game: a final is not a live moment, and the
// `final` notification is driven off `newlyCompleted` where the banked points
// can be looked up. Returning [] here also stops CFBD's habit of re-sending a
// finished game's payload from re-firing crunch-time.
function detectEvents(prev, next) {
    if (!next || next.completed) return [];

    const events = [];
    const nextHome = typeof next.homePoints === 'number' ? next.homePoints : null;
    const nextAway = typeof next.awayPoints === 'number' ? next.awayPoints : null;

    // Nothing to compare against on first sight of a game. Emitting here would
    // mean a dyno restart mid-slate re-announces every score already on the
    // board, so an unknown prior state is treated as "no news".
    if (!prev) return events;

    const prevHome = typeof prev.homePoints === 'number' ? prev.homePoints : null;
    const prevAway = typeof prev.awayPoints === 'number' ? prev.awayPoints : null;
    if (nextHome == null || nextAway == null || prevHome == null || prevAway == null) return events;

    // --- score ---------------------------------------------------------------
    // Only increases. CFBD does occasionally revise a score downward (a TD comes
    // off the board on review), and announcing that as a score would be wrong.
    const homeDelta = nextHome - prevHome;
    const awayDelta = nextAway - prevAway;
    if (homeDelta > 0 && homeDelta !== EXTRA_POINT_DELTA) {
        events.push({ type: 'score', side: 'home', delta: homeDelta, homePoints: nextHome, awayPoints: nextAway, period: next.period, clock: next.clock });
    }
    if (awayDelta > 0 && awayDelta !== EXTRA_POINT_DELTA) {
        events.push({ type: 'score', side: 'away', delta: awayDelta, homePoints: nextHome, awayPoints: nextAway, period: next.period, clock: next.clock });
    }

    // --- leadChange ----------------------------------------------------------
    // Only a genuine flip between two teams. home -> null (a tie) is not a lead
    // change, it is a tie, and the score event that caused it already fired.
    const prevLeader = leaderOf(prevHome, prevAway);
    const nextLeader = leaderOf(nextHome, nextAway);
    if (prevLeader && nextLeader && prevLeader !== nextLeader) {
        events.push({ type: 'leadChange', side: nextLeader, homePoints: nextHome, awayPoints: nextAway, period: next.period, clock: next.clock });
    }

    // --- closeGame -----------------------------------------------------------
    // Transition edge only: outside the window last tick, inside it now. This is
    // what makes it fire once per game without a seen-set, and it survives a
    // process restart degrading to "silent" rather than "repeats".
    const wasClose = inCloseWindow(prev.period, parseClockSeconds(prev.clock), prevHome, prevAway);
    const isClose = inCloseWindow(next.period, parseClockSeconds(next.clock), nextHome, nextAway);
    if (isClose && !wasClose) {
        events.push({ type: 'closeGame', homePoints: nextHome, awayPoints: nextAway, period: next.period, clock: next.clock });
    }

    return events;
}

module.exports = {
    detectEvents,
    // exported for reuse/tests:
    parseClockSeconds, leaderOf, inCloseWindow,
    CLOSE_PERIOD, CLOSE_CLOCK_SECONDS, CLOSE_MARGIN, EXTRA_POINT_DELTA
};
