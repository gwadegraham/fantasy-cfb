// A basketball game's box score, on demand (#503).
//
// CBBD traps, measured 7 Oct 2026 — each one cost a billable call to learn:
//
//   - /games/teams IGNORES gameId. ?gameId=209788 returned 3,000 rows of
//     unrelated games, no error. The game is found by TEAM plus a date
//     window, then by matching gameId in the rows.
//   - A date window with no team needs the season, or it returns nothing.
//   - /games/players with team= returns only THAT team's players, so a game
//     is one /games/teams call (both sides) plus one /games/players per team.
//   - UNITS differ from the season endpoint: per game, turnoverRatio and a
//     player's trueShootingPct are PERCENTS (15.2, 73.5); per season they
//     were fractions. Nothing here converts — the per-game values are stored
//     as sent.
//
// Only a FINAL game is fetched, and it is stored, so its calls are spent once.
// A game still to play or in progress has no box here; a live box would cost
// 3 calls a view.

const cbbd = require('./cbbd-client');
const HoopsBoxScore = require('../models/hoopsBoxScore');
const { isFinal } = require('./hoops-scoring-pass');

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function num(v) {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

function slimSide(teamId, s, players) {
    s = s || {};
    const fg = s.fieldGoals || {}, three = s.threePointFieldGoals || {}, ft = s.freeThrows || {};
    const pts = s.points || {}, ff = s.fourFactors || {};
    return {
        teamId,
        byPeriod: Array.isArray(pts.byPeriod) ? pts.byPeriod.map(Number) : [],
        points: num(pts.total),
        efgPct: num(ff.effectiveFieldGoalPct),
        tovPct: num(ff.turnoverRatio),
        orbPct: num(ff.offensiveReboundPct),
        ftRate: num(ff.freeThrowRate),
        fgMade: num(fg.made), fgAtt: num(fg.attempted),
        threeMade: num(three.made), threeAtt: num(three.attempted),
        ftMade: num(ft.made), ftAtt: num(ft.attempted),
        rebounds: num((s.rebounds || {}).total),
        assists: num(s.assists), steals: num(s.steals), blocks: num(s.blocks),
        turnovers: num((s.turnovers || {}).total),
        paintPoints: num(pts.inPaint), fastBreakPoints: num(pts.fastBreak),
        pointsOffTurnovers: num(pts.offTurnovers), largestLead: num(pts.largestLead),
        players: (players || []).filter(p => p && p.name).map(p => ({
            athleteId: num(p.athleteId), name: p.name, position: p.position || undefined,
            starter: !!p.starter, minutes: num(p.minutes), points: num(p.points),
            rebounds: num((p.rebounds || {}).total), assists: num(p.assists),
            steals: num(p.steals), blocks: num(p.blocks), turnovers: num(p.turnovers), fouls: num(p.fouls),
            fgMade: num((p.fieldGoals || {}).made), fgAtt: num((p.fieldGoals || {}).attempted),
            threeMade: num((p.threePointFieldGoals || {}).made), threeAtt: num((p.threePointFieldGoals || {}).attempted),
            ftMade: num((p.freeThrows || {}).made), ftAtt: num((p.freeThrows || {}).attempted)
        }))
    };
}

// The box score document for a game, from the three CBBD payloads. Pure.
// null when CBBD has no row for this game — a wrong window or a game it
// has not boxed yet — so nothing half-built is ever stored.
function buildBox(game, teamRows, homePlayerRows, awayPlayerRows) {
    const id = Number(game.id);
    const home = Number(game.homeTeamId);
    const rows = (teamRows || []).filter(r => Number(r.gameId) === id);
    // CBBD may answer from either side's point of view; a row whose
    // OPPONENT is our home team has the home stats in opponentStats.
    const homeRow = rows.find(r => Number(r.teamId) === home) || rows.find(r => Number(r.opponentId) === home);
    if (!homeRow) return null;
    const homeIsTeam = Number(homeRow.teamId) === home;
    const homeStats = homeIsTeam ? homeRow.teamStats : homeRow.opponentStats;
    const awayStats = homeIsTeam ? homeRow.opponentStats : homeRow.teamStats;
    const playersOf = (list) => {
        const row = (list || []).find(r => Number(r.gameId) === id);
        return row ? row.players : [];
    };
    return {
        gameId: id,
        season: Number(game.season),
        pace: num(homeRow.pace),
        home: slimSide(home, homeStats, playersOf(homePlayerRows)),
        away: slimSide(Number(game.awayTeamId), awayStats, playersOf(awayPlayerRows))
    };
}

// A final game CBBD has not boxed yet. Asked again after RETRY_MS — the box
// usually lands within the hour — but not on every view in between, which
// is 3 billable calls a view on a busy night. Per process, so a restart
// costs one extra try at most.
const RETRY_MS = 30 * 60 * 1000;
const triedAt = new Map();
// Past this age, a game with no box never gets one: the miss is stored and
// never asked again.
const MISSING_AFTER_MS = 3 * DAY_MS;
function clearRetryCache() { triedAt.clear(); }

// The stored box score, or — for a final game not yet stored — fetch, store
// and return it. Never throws: a CBBD failure is { box: null, unavailable }
// and is NOT stored, so a later view tries again.
async function getBox(game, now = Date.now()) {
    if (!game) return { box: null };
    const stored = await HoopsBoxScore.findOne({ gameId: Number(game.id) }, { _id: 0, __v: 0 }).lean();
    if (stored) return stored.missing ? { box: null, missing: true } : { box: stored };
    if (!isFinal(game)) return { box: null };
    const last = triedAt.get(Number(game.id));
    if (last && now - last < RETRY_MS) return { box: null };
    triedAt.set(Number(game.id), now);

    // A day either side: a TBD tip is stamped midnight EASTERN, which is
    // the previous day in UTC, and the window is cheap insurance against
    // either reading of "the day".
    const start = new Date(game.startDate).getTime();
    const window = { season: Number(game.season), startDateRange: ymd(start - DAY_MS), endDateRange: ymd(start + DAY_MS) };
    try {
        const [teams, home, away] = await Promise.all([
            cbbd.cbbdGet('/games/teams', Object.assign({ team: game.homeTeam }, window)),
            cbbd.cbbdGet('/games/players', Object.assign({ team: game.homeTeam }, window)),
            cbbd.cbbdGet('/games/players', Object.assign({ team: game.awayTeam }, window))
        ]);
        const box = buildBox(game, teams.data, home.data, away.data);
        if (!box) {
            if (now - new Date(game.startDate).getTime() > MISSING_AFTER_MS) {
                await HoopsBoxScore.updateOne({ gameId: Number(game.id) },
                    { $set: { gameId: Number(game.id), season: Number(game.season), missing: true, fetchedAt: new Date(now) } },
                    { upsert: true });
                return { box: null, missing: true };
            }
            return { box: null };
        }
        await HoopsBoxScore.updateOne({ gameId: box.gameId }, { $set: Object.assign({ fetchedAt: new Date() }, box) }, { upsert: true });
        return { box };
    } catch (err) {
        console.error(`hoops box score ${game.id}: ${err.message}`);
        return { box: null, unavailable: true };
    }
}

module.exports = { getBox, buildBox, slimSide, clearRetryCache, RETRY_MS, MISSING_AFTER_MS };
