// Pregame win probability for a basketball game, from Torvik's barthag (#503).
//
// barthag is Torvik's own headline number: the chance a team beats an
// AVERAGE D-I team on a neutral floor. Two of them combine through log5 —
// Bill James's formula for "A beats B" from each side's rate against the
// average — and home court shifts the odds by a constant factor.
//
// HOME_ODDS is THE home-court multiplier for basketball: the game preview
// here and the projection engine (modules/hoops-projection.js) both read
// this one constant, so the two cannot drift apart.
//
// 1.55 turns a coin flip into ~61% for the home side. Fitted by maximum
// likelihood on the 5,647 final D-I vs D-I games of 2025-26 with the
// PRESEASON barthags (scripts/hoops-projection-backtest.js): best 1.55, and
// 1.62 / 1.53 when the season is split at New Year. The 1.4 this replaced
// (the dev season simulation's guess, #320) is ruled out: home teams won
// 64.4% of 5,045 non-neutral games, 1.4 expected 62.4%, 1.55 expects 64.4%.
// Anything from 1.5 to 1.6 is within 0.0001 of the best log loss. It is a
// preview number here, shown as such, and never scores anything.

const HOME_ODDS = 1.55;

function log5(a, b) {
    return (a - a * b) / (a + b - 2 * a * b);
}

// The HOME side's chance to win, or null when either rating is missing or
// unusable (a non-D-I opponent has none).
function homeWinProb(homeBarthag, awayBarthag, neutralSite) {
    const a = Number(homeBarthag), b = Number(awayBarthag);
    if (!(a > 0 && a < 1) || !(b > 0 && b < 1)) return null;
    const base = log5(a, b);
    if (neutralSite) return base;
    const odds = (base / (1 - base)) * HOME_ODDS;
    return odds / (1 + odds);
}

module.exports = { homeWinProb, log5, HOME_ODDS };
