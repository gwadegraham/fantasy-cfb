// Pure detection of the basketball moments worth a push notification (#557) —
// football's modules/score-events.js, for CBBD's scoreboard.
//
// Fed by modules/hoops-scoreboard.js, which already holds the stored row and
// the change a poll is about to write for every game on a tick, so every event
// here comes from data we were fetching anyway. /scoreboard is quota-free.
//
// DB-free and side-effect free: this decides WHAT happened,
// modules/push-notify.js decides WHO hears about it.
//
// Two live events. A game going final is the third alert, and it is driven
// off the scoreboard's `newlyFinal` instead, because saying what it banked
// needs an async scoring lookup.
//
//   tipoff     the game went from not started to in progress.
//   closeGame  entered crunch time: 2nd half or overtime, <= 4:00 on the clock,
//              within 5 points. Fires on the TRANSITION into that window.
//
// Deliberately absent: score and lead-change. Basketball scores every
// possession and its lead can change a dozen times a half, so either would
// buzz a manager hundreds of times a night (decided on #557).
//
// Transition edges are not enough on their own for crunch time: a basketball
// margin crosses 5 back and forth in the last four minutes, and each crossing
// would be a new edge. The once-per-game guarantee is a claim on the game row,
// made by modules/push-notify.js before it sends.

// Crunch-time thresholds. Period 2 is the second half; 3+ is overtime, which
// is close by definition and counts. 4:00 and 5 points are the numbers decided
// on #557 ("about 4:00 or less, within 5"). Both edges are inclusive.
const CLOSE_PERIOD = 2;
const CLOSE_CLOCK_SECONDS = 240;
const CLOSE_MARGIN = 5;

// A game first seen in progress past this period is not a tip-off: the poller
// was down at the tip, and announcing one in the second half would be wrong.
const TIPOFF_MAX_PERIOD = 1;

// The clock as seconds left, or null when it can't be read. CBBD's /scoreboard
// clock is unverified against a live game (see modules/hoops-scoreboard.js),
// so this accepts each format a basketball feed is known to send:
//   "12:34", "04:00", "0:45.3"   minutes:seconds, tenths optional
//   "45.3", "9"                  seconds only, which is how the final minute
//                                is often shown
//   "PT04M00.00S"                ISO-8601 duration
// null is normal between halves and must not read as 0:00, or every halftime
// of a close game would be crunch time.
function parseClockSeconds(clock) {
    if (typeof clock === 'number') return Number.isFinite(clock) && clock >= 0 ? clock : null;
    if (typeof clock !== 'string') return null;
    const s = clock.trim();
    let m = s.match(/^(\d{1,2}):(\d{2})(?:\.\d+)?$/);
    if (m) {
        const secs = Number(m[2]);
        return secs > 59 ? null : Number(m[1]) * 60 + secs;
    }
    m = s.match(/^(\d{1,2})(?:\.(\d+))?$/);
    if (m) return Number(m[1]) + (m[2] ? Number(`0.${m[2]}`) : 0);
    m = s.match(/^PT(?:(\d+)M)?(\d+(?:\.\d+)?)S$/i);
    if (m) return Number(m[1] || 0) * 60 + Number(m[2]);
    return null;
}

function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

// Is this game inside the crunch-time window right now?
function inCloseWindow(period, clockSeconds, homePoints, awayPoints) {
    if (!isNum(period) || period < CLOSE_PERIOD) return false;
    if (clockSeconds == null || clockSeconds > CLOSE_CLOCK_SECONDS) return false;
    if (!isNum(homePoints) || !isNum(awayPoints)) return false;
    return Math.abs(homePoints - awayPoints) <= CLOSE_MARGIN;
}

function status(g) { return String((g && g.status) || '').toLowerCase(); }

// Events between a game's stored state (`prev`) and the state this poll is
// about to write (`next`: the stored row with the poll's changes applied).
// Field names are the HoopsGame schema's.
//
// [] when `prev` is unknown — a game we have never stored has nothing to
// compare against — and [] for a final, which is its own alert.
function detectHoopsEvents(prev, next) {
    if (!prev || !next) return [];
    if (status(next) !== 'in_progress') return [];

    const events = [];
    const base = { homePoints: next.homePoints, awayPoints: next.awayPoints, period: next.period, clock: next.clock };

    // --- tipoff -------------------------------------------------------------
    // Into in_progress from anything but in_progress or final. A stored final
    // is never walked back (hoops-scoreboard.js), so 'final' here is defence.
    const was = status(prev);
    if (was !== 'in_progress' && was !== 'final'
        && (next.period == null || next.period <= TIPOFF_MAX_PERIOD)) {
        events.push(Object.assign({ type: 'tipoff' }, base));
    }

    // --- closeGame ----------------------------------------------------------
    const wasClose = inCloseWindow(prev.period, parseClockSeconds(prev.clock), prev.homePoints, prev.awayPoints);
    const isClose = inCloseWindow(next.period, parseClockSeconds(next.clock), next.homePoints, next.awayPoints);
    if (isClose && !wasClose) events.push(Object.assign({ type: 'closeGame' }, base));

    return events;
}

module.exports = {
    detectHoopsEvents, parseClockSeconds, inCloseWindow,
    CLOSE_PERIOD, CLOSE_CLOCK_SECONDS, CLOSE_MARGIN, TIPOFF_MAX_PERIOD
};
