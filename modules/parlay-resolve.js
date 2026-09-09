const Parlay = require('../models/parlay');
const Game = require('../models/game');
const { parlayPayout } = require('./parlay-calc');

// Which team a spread/moneyline leg backs. Legs written since the alt-spread
// board carry it outright; older ones only have the selection text ("LSU -3"),
// so fall back to matching the away team's name in it. That fallback is a guess
// — it reads "Miami" as the away side of Miami @ Miami (OH) — which is why the
// stored side wins whenever it's there.
function pickedHomeSide(leg, game) {
    if (leg.teamSide === 'home') return true;
    if (leg.teamSide === 'away') return false;
    const sel = (leg.selection || '').toLowerCase();
    return !sel.includes((game.awayTeam || '').toLowerCase());
}

function resolveLeg(leg, game) {
    if (leg.result !== 'pending') return leg.result;
    if (!game || !game.completed) return 'pending';
    if (game.homePoints == null || game.awayPoints == null) return 'pending';

    const home = game.homePoints;
    const away = game.awayPoints;
    const total = home + away;
    const sel = (leg.selection || '').toLowerCase();

    switch (leg.betType) {
        case 'spread': {
            if (leg.line == null || isNaN(leg.line)) return 'pending';
            // `line` is from the picked team's point of view, so the same
            // arithmetic grades the book's number and any alternate off it:
            // add the points you were given (or lay the ones you took) to your
            // own margin. A whole number can land on zero, which is a push.
            const pickedHome = pickedHomeSide(leg, game);
            const margin = pickedHome ? (home - away) : (away - home);
            const covered = margin + Number(leg.line);
            if (covered > 0) return 'win';
            if (covered === 0) return 'push';
            return 'loss';
        }
        case 'moneyline': {
            if (home === away) return 'push';
            const homeWon = home > away;
            return (homeWon === pickedHomeSide(leg, game)) ? 'win' : 'loss';
        }
        case 'over_under': {
            const isOver = sel.includes('over');
            if (total === leg.line) return 'push';
            const wentOver = total > leg.line;
            return (wentOver === isOver) ? 'win' : 'loss';
        }
        case 'stat_over_under': {
            if (!leg.statCategory || !leg.statTeamSide) return 'pending';
            const stats = game.teamStats && game.teamStats.get
                ? game.teamStats.get(leg.statTeamSide)
                : game.teamStats && game.teamStats[leg.statTeamSide];
            if (!stats) return 'pending';
            const actual = stats[leg.statCategory];
            if (actual == null) return 'pending';
            // Match " over " as a word to avoid false positives on "turnovers"
            const isOver = /\bover\b/.test(sel);
            if (actual === leg.line) return 'push';
            const wentOver = actual > leg.line;
            return (wentOver === isOver) ? 'win' : 'loss';
        }
        default:
            return 'pending';
    }
}

function deriveParlayStatus(legs) {
    if (legs.some(l => l.result === 'loss')) return 'lost';
    const nonPush = legs.filter(l => l.result !== 'push');
    if (nonPush.some(l => l.result === 'pending')) return 'pending';
    if (!nonPush.length) return 'push';
    if (nonPush.every(l => l.result === 'win')) return 'won';
    return 'pending';
}

async function resolveParlays() {
    const pending = await Parlay.find({ 'legs.result': 'pending' });
    let resolved = 0;

    for (const parlay of pending) {
        if (!parlay.legs || !parlay.legs.length) continue;

        const pendingLegs = parlay.legs.filter(l => l.result === 'pending' && l.gameId);
        if (!pendingLegs.length) continue;

        const gameIds = pendingLegs.map(l => l.gameId);
        const games = await Game.find({ id: { $in: gameIds } }).lean();
        const gameMap = new Map(games.map(g => [g.id, g]));

        let changed = false;
        for (const leg of parlay.legs) {
            if (leg.result !== 'pending' || !leg.gameId) continue;
            const game = gameMap.get(leg.gameId);
            const result = resolveLeg(leg, game);
            if (result !== 'pending') {
                leg.result = result;
                leg.resolvedAt = new Date();
                changed = true;
            }
        }

        if (changed) {
            const newStatus = deriveParlayStatus(parlay.legs);
            parlay.status = newStatus;

            if (newStatus === 'won' && parlay.wager) {
                parlay.payout = parlay.totalPayout || parlayPayout(parlay.wager, parlay.legs);
            } else if (newStatus === 'lost') {
                parlay.payout = 0;
            } else if (newStatus === 'push') {
                parlay.payout = parlay.wager || 0;
            }

            parlay.updatedAt = new Date();
            await parlay.save();
            resolved++;
        }
    }

    if (resolved) console.log(`Resolved ${resolved} parlay(s)`);
    return resolved;
}

const CALL_BUFFER = 100;

async function retryPendingStatLegs(season) {
    const parlays = await Parlay.find({
        'legs.result': 'pending',
        'legs.betType': 'stat_over_under'
    });

    const gameIds = new Set();
    for (const p of parlays) {
        for (const leg of p.legs) {
            if (leg.result === 'pending' && leg.betType === 'stat_over_under' && leg.gameId) {
                gameIds.add(leg.gameId);
            }
        }
    }
    if (!gameIds.size) return { retried: 0, resolved: 0 };

    const games = await Game.find({
        id: { $in: [...gameIds] },
        completed: true
    }).lean();
    const needBoxScores = games.filter(g => !g.teamStats || !Object.keys(g.teamStats).length);
    if (!needBoxScores.length) {
        const resolved = await resolveParlays();
        return { retried: 0, resolved };
    }

    // /games/teams is fetched a week at a time (see box-scores.js), so group the
    // games that still need one and spend a single call per distinct week rather
    // than one per game. Legs on the same slate collapse to one call.
    const { ingestBoxScores } = require('./box-scores');
    const byWeek = new Map();
    for (const g of needBoxScores) {
        const key = `${g.seasonType || 'regular'}:${g.week}`;
        if (!byWeek.has(key)) byWeek.set(key, { week: g.week, seasonType: g.seasonType, ids: [] });
        byWeek.get(key).ids.push(g.id);
    }

    let ingested = 0;
    let remainingCalls = null;
    for (const { week, seasonType, ids } of byWeek.values()) {
        const bs = await ingestBoxScores(season, week, seasonType, ids);
        ingested += bs.ingested;
        if (bs.remainingCalls != null) remainingCalls = bs.remainingCalls;
        // Stop before the budget floor rather than after — the remaining weeks
        // retry on the next run, and the calls left are worth more to the live
        // poller than to a backfill.
        if (remainingCalls != null && remainingCalls <= CALL_BUFFER) {
            console.log(`retryPendingStatLegs: ${remainingCalls} CFBD calls left — at budget ceiling, stopping`);
            break;
        }
    }

    const resolved = await resolveParlays();
    console.log(`retryPendingStatLegs: fetched box scores for ${ingested} game(s), resolved ${resolved} parlay(s)`);
    return { retried: ingested, resolved, remainingCalls };
}

module.exports = { resolveParlays, resolveLeg, pickedHomeSide, deriveParlayStatus, retryPendingStatLegs };
