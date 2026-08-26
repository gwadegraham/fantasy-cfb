function americanToDecimal(odds) {
    if (odds >= 100) return 1 + (odds / 100);
    if (odds <= -100) return 1 + (100 / Math.abs(odds));
    return 1;
}

function parlayDecimalOdds(legs) {
    return legs.reduce((acc, leg) => {
        if (leg.result === 'push') return acc;
        return acc * americanToDecimal(leg.odds);
    }, 1);
}

function parlayPayout(wager, legs) {
    if (!wager || !legs || !legs.length) return 0;
    return Math.round(wager * parlayDecimalOdds(legs) * 100) / 100;
}

function decimalToAmerican(decimal) {
    if (decimal >= 2) return Math.round((decimal - 1) * 100);
    if (decimal > 1) return Math.round(-100 / (decimal - 1));
    return 0;
}

function combinedAmericanOdds(legs) {
    const activLegs = legs.filter(l => l.result !== 'push');
    if (!activLegs.length) return 0;
    return decimalToAmerican(parlayDecimalOdds(activLegs));
}

module.exports = {
    americanToDecimal,
    parlayDecimalOdds,
    parlayPayout,
    decimalToAmerican,
    combinedAmericanOdds
};
