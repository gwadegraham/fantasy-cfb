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

// Books round a payout UP to the cent: today's real ticket worked out to
// $108.8043 and FanDuel paid $108.81. Ceiling raw floats would be a bug of its
// own — an exact $57.76 arrives as 57.760000000000005 and would round to
// $57.77 — so snap off the float noise before taking the ceiling.
function toCents(amount) {
    return Math.ceil(Number((amount * 100).toFixed(6))) / 100;
}

function parlayPayout(wager, legs) {
    if (!wager || !legs || !legs.length) return 0;
    return toCents(wager * parlayDecimalOdds(legs));
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

// Books boost the PROFIT, not the stake: a 50% boost on +355 pays
// 1 + 3.55 * 1.5 = 6.325, i.e. +532. Both DraftKings ("Profit Boost") and
// FanDuel ("Parlay Boost") work this way, so one formula covers the group's
// two books.
function boostDecimalOdds(decimal, boostPct) {
    if (!boostPct) return decimal;
    return 1 + ((decimal - 1) * (1 + (boostPct / 100)));
}

function boostedAmericanOdds(parlayOdds, boostPct) {
    if (!parlayOdds || !boostPct) return null;
    return decimalToAmerican(boostDecimalOdds(americanToDecimal(parlayOdds), boostPct));
}

// The promos cap the stake they'll boost ("Max $10.00 wager"), and the group
// always plays a $20 ticket, so the cap usually bites. Anything over the cap
// rides at the unboosted number, which makes the ticket's real odds a blend of
// the two — not the boosted number the slip advertises.
function boostedStake(wager, boostCap) {
    if (!wager) return 0;
    if (boostCap == null || boostCap === '' || !(boostCap > 0)) return wager;
    return Math.min(Number(boostCap), wager);
}

// Total returned (stake included) on a winning ticket, honoring the boost and
// its stake cap. `decimal` is the ticket's true decimal odds — prefer the
// number off the bet slip over the product of the legs, since the book rounds.
// `boostedDecimal` overrides the derived boost when the admin typed the boosted
// number off the slip — the book rounds its own display, and paying what the
// slip says beats paying what the percentage implies.
function boostedReturn(wager, decimal, boostPct, boostCap, boostedDecimal) {
    if (!wager || !decimal) return 0;
    const boosted = boostedStake(wager, boostCap);
    const plain = wager - boosted;
    const boostedDec = boostedDecimal || boostDecimalOdds(decimal, boostPct);
    const total = (boosted * boostedDec) + (plain * decimal);
    return toCents(total);
}

// The blended American odds a capped boost actually pays. With no cap (or a cap
// at or above the wager) this is just the boosted number.
function effectiveAmericanOdds(wager, decimal, boostPct, boostCap, boostedDecimal) {
    const total = boostedReturn(wager, decimal, boostPct, boostCap, boostedDecimal);
    if (!total || !wager) return 0;
    return decimalToAmerican(total / wager);
}

// No board quotes American odds between -100 and +100, and americanToDecimal
// returns a flat 1 for them — which would price a WINNING ticket at stake-back
// and write that to parlay.payout. Treat anything in that gap as not a price.
function isRealAmericanOdds(odds) {
    return typeof odds === 'number' && !isNaN(odds) && Math.abs(odds) >= 100;
}

// The ticket's true decimal odds, from whichever source can be trusted.
//
// The book's own number is the price the bet actually pays, so a typed
// parlayOdds wins. The leg product is used only to recover the precision that
// number loses: American odds are displayed whole, so a FanDuel ticket priced
// at 4.552171 shows as "+355" (4.55), and computing off the display cost 11
// cents on $20.
//
// The catch is that the product is not always the same bet. A real DraftKings
// slip has legs of -160/-163/-140/-250 — the prices locked at placement —
// multiplying to +529 against a ticket the book priced at +355. Whatever the
// book is doing there, +355 is what pays, and a 174-point "correction" is not
// a rounding fix.
//
// So the two must agree before the product is trusted: round it back to
// American odds and compare. Equal means the legs really are the ticket, and
// the exact product is the better number. Unequal means the legs don't price
// this bet, and the book's number stands.
function ticketDecimalOdds(parlay) {
    const all = parlay.legs || [];
    const active = all.filter(l => l.result !== 'push');
    const priced = active.length > 0 && active.every(l => isRealAmericanOdds(l.odds));
    const legDecimal = priced ? parlayDecimalOdds(active) : 0;

    // A push re-prices the ticket without that leg, so parlayOdds — which
    // priced it — is out of the question no matter what the legs say.
    if (all.length !== active.length) return legDecimal;

    if (isRealAmericanOdds(parlay.parlayOdds)) {
        if (legDecimal && decimalToAmerican(legDecimal) === Math.round(Number(parlay.parlayOdds))) {
            return legDecimal;
        }
        return americanToDecimal(parlay.parlayOdds);
    }
    return legDecimal;
}

// The one place that decides what a settled parlay paid. A hand-typed
// totalPayout always wins — it's the admin copying the real number off the
// book — then the boost math, then the plain leg product.
function settledPayout(parlay) {
    if (!parlay || !parlay.wager) return 0;
    if (parlay.totalPayout) return parlay.totalPayout;
    // ticketDecimalOdds has already decided what this ticket is worth per $1 —
    // leg product, else the slip price. Falling back to parlayPayout() here
    // would silently re-price off the legs alone, and an unpriced leg
    // multiplies by 1.0: a $20 ticket at a typed +398 paid $32.50 instead of
    // $99.60 when one member hadn't filled their odds in. Nothing usable means
    // nothing to pay, not the stake back.
    const decimal = ticketDecimalOdds(parlay);
    if (decimal <= 1) return 0;
    if (parlay.boostPct || parlay.boostedOdds) {
        // boostPct reproduces the book's own arithmetic; the stored boostedOdds
        // is only the rounded display, so it's the fallback, not the source.
        const boostedDec = (!parlay.boostPct && isRealAmericanOdds(parlay.boostedOdds))
            ? americanToDecimal(parlay.boostedOdds)
            : null;
        return boostedReturn(parlay.wager, decimal, parlay.boostPct, parlay.boostCap, boostedDec);
    }
    return toCents(parlay.wager * decimal);
}

module.exports = {
    toCents,
    americanToDecimal,
    parlayDecimalOdds,
    parlayPayout,
    decimalToAmerican,
    combinedAmericanOdds,
    isRealAmericanOdds,
    ticketDecimalOdds,
    boostDecimalOdds,
    boostedAmericanOdds,
    boostedStake,
    boostedReturn,
    effectiveAmericanOdds,
    settledPayout
};
