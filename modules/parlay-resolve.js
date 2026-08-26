const Parlay = require('../models/parlay');
const Game = require('../models/game');
const { parlayPayout } = require('./parlay-calc');

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
            const margin = home - away;
            const isHomePick = !sel.includes(game.awayTeam.toLowerCase());
            const covered = isHomePick
                ? margin + leg.line
                : (away - home) + (-leg.line);
            if (covered > 0) return 'win';
            if (covered === 0) return 'push';
            return 'loss';
        }
        case 'moneyline': {
            if (home === away) return 'push';
            const homeWon = home > away;
            const pickedHome = !sel.includes(game.awayTeam.toLowerCase());
            return (homeWon === pickedHome) ? 'win' : 'loss';
        }
        case 'over_under': {
            const isOver = sel.includes('over');
            if (total === leg.line) return 'push';
            const wentOver = total > leg.line;
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
    const pending = await Parlay.find({ status: 'pending' });
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
                parlay.payout = parlayPayout(parlay.wager, parlay.legs);
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

module.exports = { resolveParlays, resolveLeg, deriveParlayStatus };
