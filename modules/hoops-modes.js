// The weekly game modes — Captain and head-to-head — on a basketball league.
//
// Football's helpers do the work (modules/captain.js, modules/h2h.js). What is
// here is the part that is genuinely basketball's: WHICH games and WHICH
// weeks the modes cover, and how a basketball tip-off sets the Captain lock.
//
// ---- "regular season only" is a per-GAME test, not a seasonType ----
//
// The /hardwood page promises: "The conference tournaments and March are
// scored without them." CBBD files conference tournament games as seasonType
// 'regular' (see hoops-detectors, trap 3), so seasonType alone would double a
// captained team's run through its conference tournament and decide an H2H
// week on it. A MODE GAME is a regular-season game that is not a conference
// tournament game. Everything else still scores — just without either mode.
//
// ---- which weeks ----
//
// Weeks 1..L, where L is the last week of the schedule that carries a real
// regular-season slate. Two things football's h2hWeekRange does that this
// deliberately does not:
//
//   - it stops at the first THIN week. Christmas week is thin (145 games
//     against a ~305 median on the 2026-27 schedule), and Graham decided on
//     14 Oct 2026 that Christmas is NOT skipped. Football's rule would have
//     ended the H2H season in December.
//   - it counts only drafted teams' games. Counted over the whole schedule
//     instead, the range is the same for every league and cannot move when a
//     roster does.
//
// What it does keep is a guard at the END: a trailing week holding a sliver
// of the median slate (a makeup game parked in conference-tournament week)
// is not a matchup week. Only trailing weeks are trimmed — an interior thin
// week, Christmas, always stays.

const HoopsGame = require('../models/hoopsGame');
const { isConfTournament } = require('./hoops-detectors');
const { easternDay, easternMidnight } = require('./hoops-calendar');
const { captainWeekWindow } = require('./captain');

const DAY_MS = 86400000;

// A trailing week under this share of the median week's mode-game count is
// not a mode week. Measured on the 2026-27 schedule: the real last week
// (1-7 Mar) holds 171 of a ~305 median, 0.56; Christmas 0.48 (interior, so
// never trimmed anyway). 0.25 keeps both with room and drops a week of
// stragglers.
const TRAILING_MIN_SHARE = 0.25;

// Is this game covered by Captain and H2H?
function isModeGame(game) {
    if (!game) return false;
    if (String(game.seasonType || '').toLowerCase() !== 'regular') return false;
    return !isConfTournament(game);
}

// The mode weeks, 1..L, from { [week]: modeGameCount }.
function modeWeeksFrom(countsByWeek) {
    const entries = Object.keys(countsByWeek || {})
        .map(w => ({ week: Number(w), n: Number(countsByWeek[w]) || 0 }))
        .filter(e => Number.isInteger(e.week) && e.week >= 1 && e.n > 0)
        .sort((a, b) => a.week - b.week);
    if (!entries.length) return [];
    const sorted = entries.map(e => e.n).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const floor = median * TRAILING_MIN_SHARE;
    let last = null;
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].n >= floor) { last = entries[i].week; break; }
    }
    // `last` cannot stay null: the median is one of the counts, so at least
    // one week meets a quarter of it.
    const out = [];
    for (let w = 1; w <= last; w++) out.push(w);
    return out;
}

// The mode weeks for a season, from the stored schedule.
//
// Counted IN the database, grouped by exactly the fields isModeGame reads,
// so the test itself still runs here — one definition of a conference
// tournament, not a second one written as a pipeline. The groups are few
// (a week's slate shares a handful of note strings); shipping every row
// instead measured ~500ms per call against the dev cluster, and this runs on
// every basketball scoring pass and every Captain read.
async function seasonModeWeeks(season) {
    const groups = await HoopsGame.aggregate([
        { $match: { season: Number(season), seasonType: 'regular', week: { $ne: null } } },
        { $group: {
            _id: { week: '$week', conferenceGame: '$conferenceGame', tournament: '$tournament', gameNotes: '$gameNotes' },
            n: { $sum: 1 }
        } }
    ]);
    const counts = {};
    groups.forEach(g => {
        if (!isModeGame(Object.assign({ seasonType: 'regular' }, g._id))) return;
        counts[g._id.week] = (counts[g._id.week] || 0) + g.n;
    });
    return modeWeeksFrom(counts);
}

// The instant a basketball game LOCKS a Captain pick.
//
// A firm tip-off is its own time. A TBD one — 75% of the 2026-27 schedule —
// carries a placeholder stamped at midnight Eastern, and its real time is
// often never published before the game. Football can afford to ignore TBD
// kickoffs while a firm one exists (modules/captain.js captainWeekWindow),
// because its placeholders firm up ~12 days out. Basketball's do not: a
// manager whose Tuesday game is TBD and whose Saturday game is firm would
// keep their pick open through Tuesday's result. So a TBD game locks at the
// START of its Eastern day — never late, at the cost of being early.
function lockInstant(game) {
    const start = new Date(game.startDate);
    if (Number.isNaN(start.getTime())) return null;
    if (!game.startTimeTbd) return start;
    const day = easternDay(start);
    return day ? easternMidnight(day) : null;
}

// A stored basketball game in the shape modules/captain.js reads, with the
// lock instant as its start. `tipoff` keeps the real (or TBD) time for
// display.
function captainShape(g) {
    const lock = lockInstant(g);
    return {
        id: g.id,
        week: g.week,
        seasonType: 'regular',
        homeId: g.homeTeamId,
        awayId: g.awayTeamId,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        status: g.status,
        homePoints: g.homePoints,
        awayPoints: g.awayPoints,
        startDate: lock ? lock.toISOString() : null,
        // Already folded into startDate above, so captain.js must not drop
        // these games in favour of a later firm one.
        startTimeTbd: false,
        tipoff: (g.startTimeTbd || !lock) ? null : lock.toISOString()
    };
}

// A manager's mode games for a season, in captain shape.
async function captainGames(season, teamIds, weeks) {
    const ids = (teamIds || []).map(Number).filter(Number.isFinite);
    const range = weeks && weeks.length ? weeks : null;
    if (!ids.length || !range) return [];
    const rows = await HoopsGame.find({
        season: Number(season), seasonType: 'regular',
        week: { $gte: range[0], $lte: range[range.length - 1] },
        $or: [{ homeTeamId: { $in: ids } }, { awayTeamId: { $in: ids } }]
    }, {
        id: 1, week: 1, seasonType: 1, conferenceGame: 1, tournament: 1, gameNotes: 1,
        homeTeamId: 1, awayTeamId: 1, homeTeam: 1, awayTeam: 1, status: 1,
        homePoints: 1, awayPoints: 1, startDate: 1, startTimeTbd: 1, _id: 0
    }).lean();
    return rows.filter(isModeGame).map(captainShape);
}

function byWeek(games) {
    const out = {};
    (games || []).forEach(g => { (out[g.week] = out[g.week] || []).push(g); });
    return out;
}

// The week the Captain picker should offer: the first mode week the manager
// plays whose lock has not passed.
//
// NOT football's captainFocusWeek, which holds a week in focus until its last
// kickoff plus a grace. Basketball weeks run back to back — Sunday night's
// game and Monday's lock can be hours apart — so holding the locked week in
// focus would hide next week's picker until after it had already locked.
// The week that just locked is reported separately (lockedWeek) so the
// picker can still say what is riding this week.
function captainFocus(games, teamIds, nowMs) {
    const weeks = byWeek(games);
    const order = Object.keys(weeks).map(Number).sort((a, b) => a - b);
    for (const w of order) {
        const win = captainWeekWindow(weeks[w], teamIds);
        if (win && nowMs < win.first) return { week: w, first: win.first, last: win.last };
    }
    return null;
}

// The most recent week that has locked and is still being played: locked,
// and its last game's Eastern day has not ended. null otherwise.
function lockedWeek(games, teamIds, nowMs) {
    const weeks = byWeek(games);
    const order = Object.keys(weeks).map(Number).sort((a, b) => b - a);
    for (const w of order) {
        const win = captainWeekWindow(weeks[w], teamIds);
        if (!win || nowMs < win.first) continue;
        const lastDay = easternDay(win.last);
        const over = easternMidnight(new Date(lastDay.getTime() + DAY_MS)).getTime();
        return nowMs < over ? { week: w, first: win.first, last: win.last } : null;
    }
    return null;
}

module.exports = {
    TRAILING_MIN_SHARE, isModeGame, modeWeeksFrom, seasonModeWeeks,
    lockInstant, captainShape, captainGames, captainFocus, lockedWeek
};
