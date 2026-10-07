// Pregame win probability for a basketball game, from Torvik's barthag (#503).
//
// barthag is Torvik's own headline number: the chance a team beats an
// AVERAGE D-I team on a neutral floor. Two of them combine through log5 —
// Bill James's formula for "A beats B" from each side's rate against the
// average — and home court shifts the odds by a constant factor.
//
// HOME_ODDS 1.4 is the factor the dev season simulation has used since #320
// (scripts/.dev-hoops-season.js): it turns a coin flip into ~58% for the home
// side, in line with the ~3-point home edge efficiency systems assume. It is
// a preview number, shown as such, and never scores anything.

const HOME_ODDS = 1.4;

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
