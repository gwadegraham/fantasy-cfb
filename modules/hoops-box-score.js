// Basketball box scores (#503), ingested in a nightly batch — the same shape
// football uses (modules/box-scores.js + player-box-scores.js): pull a window
// of finished games in one call per endpoint, filter to our games locally,
// store. The game page only ever READS what is stored; it never calls CBBD.
//
// Two calls a batch, whatever the number of games: /games/teams answers for
// every game in a date window (both sides in one row), /games/players for
// every team's lines. Measured 7 Oct 2026: one day of 2025-26 (25 games) is
// 50 rows each, 383 KB of players. The busiest real day is 152 games, ~2.3 MB
// — under the 3,000-row cap even across the 3-day lookback.
//
// CBBD traps, each measured:
//   - /games/teams IGNORES gameId (?gameId=209788 returned 3,000 unrelated
//     rows, no error), so it is never sent; games are matched by id locally.
//   - A date window needs the season, or it returns nothing.
//   - UNITS differ from the season endpoint: per game, turnoverRatio and a
//     player's trueShootingPct are PERCENTS (15.2, 73.5). Stored as sent.

const cbbd = require('./cbbd-client');
const HoopsGame = require('../models/hoopsGame');
const HoopsBoxScore = require('../models/hoopsBoxScore');
const { isFinal } = require('./hoops-scoring-pass');

const DAY_MS = 24 * 60 * 60 * 1000;
// Re-look at the last few days each night: a late West Coast final, a box
// CBBD posts the next morning, a missed night. Re-storing a box is free.
const LOOKBACK_MS = 3 * DAY_MS;
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

// One game's box score from the window's payloads. Pure. null when CBBD has
// no team row for the game — nothing half-built is ever stored.
//
// Player rows are matched on game AND team: a window's /games/players holds
// a row per side per game, and matching on the game alone handed the home
// side whichever row came first.
function buildBox(game, teamRows, playerRows) {
    const id = Number(game.id);
    const home = Number(game.homeTeamId), away = Number(game.awayTeamId);
    const rows = (teamRows || []).filter(r => Number(r.gameId) === id);
    // CBBD may answer from either side's point of view; a row whose
    // OPPONENT is our home team has the home stats in opponentStats.
    const homeRow = rows.find(r => Number(r.teamId) === home) || rows.find(r => Number(r.opponentId) === home);
    if (!homeRow) return null;
    const homeIsTeam = Number(homeRow.teamId) === home;
    const playersOf = (teamId) => {
        const row = (playerRows || []).find(r => Number(r.gameId) === id && Number(r.teamId) === teamId);
        return row ? row.players : [];
    };
    return {
        gameId: id,
        season: Number(game.season),
        pace: num(homeRow.pace),
        home: slimSide(home, homeIsTeam ? homeRow.teamStats : homeRow.opponentStats, playersOf(home)),
        away: slimSide(away, homeIsTeam ? homeRow.opponentStats : homeRow.teamStats, playersOf(away))
    };
}

// The nightly batch: every game that went final in the lookback window gets
// its box stored (or refreshed). Two CBBD calls, or none when nothing went
// final. Throws on a CBBD failure so the job records it.
// `gameIds` narrows the batch to those games — what the live poller passes
// for the cluster that just finished, so a flush on a busy Saturday fetches
// tonight's window for those games rather than re-downloading and rewriting
// three days of boxes every few minutes. Still 2 calls a batch either way.
async function ingestRecent(season, { now = Date.now(), gameIds = null } = {}) {
    const yr = Number(season);
    const since = new Date(now - LOOKBACK_MS);
    const query = { season: yr, status: 'final', startDate: { $gte: since, $lte: new Date(now) } };
    if (Array.isArray(gameIds)) query.id = { $in: gameIds.map(Number) };
    const games = (await HoopsGame.find(query).lean()).filter(isFinal);
    if (!games.length) return { season: yr, games: 0, stored: 0, skippedReason: 'nothing final' };

    // A day either side of the games' own dates: a TBD tip is stamped
    // midnight EASTERN, which is the previous day in UTC.
    const times = games.map(g => new Date(g.startDate).getTime());
    const window = {
        season: yr,
        startDateRange: ymd(Math.min(...times) - DAY_MS),
        endDateRange: ymd(Math.max(...times) + DAY_MS)
    };
    const [teams, players] = await Promise.all([
        cbbd.cbbdGet('/games/teams', window),
        cbbd.cbbdGet('/games/players', window)
    ]);
    // At the cap the window cannot be trusted to be whole (the /games trap,
    // cbbd-client.js). Store what came, and say so in the job summary.
    const capped = teams.data.length >= cbbd.PAGE_CAP || players.data.length >= cbbd.PAGE_CAP;

    const ops = [];
    for (const g of games) {
        const box = buildBox(g, teams.data, players.data);
        if (!box) continue;
        ops.push({ updateOne: { filter: { gameId: box.gameId },
            update: { $set: Object.assign({ fetchedAt: new Date(now) }, box) }, upsert: true } });
    }
    if (ops.length) await HoopsBoxScore.bulkWrite(ops, { ordered: false });
    return {
        season: yr, games: games.length, stored: ops.length, capped,
        remainingCalls: players.remainingCalls != null ? players.remainingCalls : teams.remainingCalls
    };
}

// The stored box score for a game, or null. Never calls CBBD.
async function getBox(gameId) {
    return HoopsBoxScore.findOne({ gameId: Number(gameId) }, { _id: 0, __v: 0 }).lean();
}

module.exports = { ingestRecent, getBox, buildBox, slimSide, LOOKBACK_MS };
