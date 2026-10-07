// Basketball season stats: team and player, from CBBD, for the team page (#494).
//
// Two billable calls per import — /stats/team/season and /stats/player/season
// each answer for every team at once. Measured for 2026: 727 team rows and
// 10,030 player rows (~8 MB), across D-I and the lower divisions CBBD also
// tracks. Only teams with a hoopsteams row for the season are kept, which is
// the 365 D-I programmes.
//
// The season is CBBD's ENDING year (2027 is 2026-27), the same convention the
// schedule ingest and models use, so it is passed straight through.

const cbbd = require('./cbbd-client');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsTeamStats = require('../models/hoopsTeamStats');

function num(v) {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}

// CBBD sends a player's true shooting as a FRACTION (0.546) and a team's as
// a PERCENT (60.4). Stored as a percent everywhere so the page never has to
// know which is which. Converted by WHICH FIELD it is, not by size: a
// player's fraction can exceed 1 on a tiny sample (one made three on one
// shot is 1.5), and a "<= 1 means fraction" guess stored that as 1.5%.
function fractionToPercent(v) {
    const n = num(v);
    return n === undefined ? undefined : Math.round(n * 1000) / 10;
}

function slimSide(s) {
    if (!s) return undefined;
    const fg = s.fieldGoals || {};
    const three = s.threePointFieldGoals || {};
    const ff = s.fourFactors || {};
    const pts = s.points || {};
    const fga = num(fg.attempted);
    const threeA = num(three.attempted);
    return {
        possessions: num(s.possessions),
        rating: num(s.rating),
        trueShooting: num(s.trueShooting),                // already a percent
        fgPct: num(fg.pct),
        threePct: num(three.pct),
        threeRate: fga ? Math.round((threeA / fga) * 1000) / 10 : undefined,
        ftPct: num((s.freeThrows || {}).pct),
        efgPct: num(ff.effectiveFieldGoalPct),
        tovRatio: num(ff.turnoverRatio),
        orbPct: num(ff.offensiveReboundPct),
        ftRate: num(ff.freeThrowRate),
        points: num(pts.total),
        paintPoints: num(pts.inPaint),
        fastBreakPoints: num(pts.fastBreak),
        assists: num(s.assists),
        steals: num(s.steals),
        blocks: num(s.blocks),
        rebounds: num((s.rebounds || {}).total)
    };
}

function slimTeam(row) {
    return {
        games: num(row.games),
        wins: num(row.wins),
        losses: num(row.losses),
        pace: num(row.pace),
        team: slimSide(row.teamStats),
        opponent: slimSide(row.opponentStats)
    };
}

function slimPlayer(p) {
    return {
        athleteId: num(p.athleteId),
        name: p.name,
        position: p.position || undefined,
        games: num(p.games),
        starts: num(p.starts),
        minutes: num(p.minutes),
        points: num(p.points),
        rebounds: num((p.rebounds || {}).total),
        assists: num(p.assists),
        steals: num(p.steals),
        blocks: num(p.blocks),
        threeMade: num((p.threePointFieldGoals || {}).made),
        threePct: num((p.threePointFieldGoals || {}).pct),
        trueShootingPct: fractionToPercent(p.trueShootingPct),
        usage: num(p.usage),
        netRating: num(p.netRating),
        winShares: num((p.winShares || {}).total)
    };
}

// One upsert per D-I team, built from the two payloads. Pure, so the shape
// is testable without CBBD or Mongo.
//
// A team CBBD has stats for but no players (or the reverse) still gets a
// row: the page shows what exists rather than nothing.
function buildOps(season, teamRows, playerRows, d1Ids, now = new Date()) {
    const keep = new Set([...d1Ids].map(Number));
    const byTeam = new Map();
    const slot = (id) => {
        if (!byTeam.has(id)) byTeam.set(id, { players: [] });
        return byTeam.get(id);
    };
    for (const row of teamRows || []) {
        const id = num(row.teamId);
        if (id === undefined || !keep.has(id)) continue;
        Object.assign(slot(id), slimTeam(row));
    }
    for (const p of playerRows || []) {
        const id = num(p.teamId);
        if (id === undefined || !keep.has(id) || !p.name) continue;
        slot(id).players.push(slimPlayer(p));
    }
    const ops = [];
    for (const [teamId, doc] of byTeam) {
        doc.players.sort((a, b) => (b.points || 0) - (a.points || 0));
        ops.push({
            updateOne: {
                filter: { season, teamId },
                update: { $set: Object.assign({ season, teamId, fetchedAt: now }, doc) },
                upsert: true
            }
        });
    }
    return ops;
}

async function importSeason(season) {
    const yr = Number(season);
    if (!Number.isInteger(yr)) throw new Error(`hoops-stats: season must be a year, got ${JSON.stringify(season)}`);

    const d1 = await HoopsTeam.distinct('id', { season: yr });
    // No teams ingested means nothing to attach stats to — and two billable
    // calls spent on a payload that would all be filtered out.
    if (!d1.length) return { season: yr, skippedReason: 'no hoops teams ingested', teams: 0, players: 0 };

    const [teams, players] = await Promise.all([
        cbbd.cbbdGet('/stats/team/season', { season: yr }),
        cbbd.cbbdGet('/stats/player/season', { season: yr })
    ]);
    const ops = buildOps(yr, teams.data, players.data, d1);
    if (ops.length) await HoopsTeamStats.bulkWrite(ops, { ordered: false });
    const playerCount = ops.reduce((n, op) => n + op.updateOne.update.$set.players.length, 0);
    return {
        season: yr, teams: ops.length, players: playerCount,
        remainingCalls: players.remainingCalls != null ? players.remainingCalls : teams.remainingCalls
    };
}

module.exports = { importSeason, buildOps, slimTeam, slimPlayer, fractionToPercent };
