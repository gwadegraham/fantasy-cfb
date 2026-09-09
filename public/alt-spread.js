// Alternate-spread ladder and pricing (client + server; UMD so both can load
// this one file).
//
// The group was already betting alt spreads — "LSU -6.5" against a book line of
// LSU -10 — but the bet board only offered the exact DraftKings number, so those
// picks were typed into the Custom box as free text. A custom leg carries no
// gameId semantics the resolver understands, so an admin had to grade every one
// of them by hand. Everything here exists so an alt spread can be a REAL spread
// leg (a team, a number, a price) that modules/parlay-resolve.js grades itself.
//
// Pricing: margin for the picked team is modelled as Normal(-base, SIGMA²), so
// the chance an alt line `alt` covers is Φ((alt - base) / SIGMA). At alt == base
// that's a coin flip, which is what you want — moving off the book's number is
// the only thing that should move the price.
//
// SIGMA is not the raw spread-error standard deviation for college football
// (~16). It's fitted to what DraftKings actually charged this group for the alt
// legs they bet in 2026, because the book's alt ladder is steeper than a plain
// normal — key numbers and the book's own risk both push it:
//
//     base    alt      DK price    implied σ
//     LSU -10   -6.5     -181        12.0
//     Duke -9.5 -2.5     -271        13.5
//     USC -37.5 -30.5    -279        13.2
//
// 13 reproduces those three within ~4% (-174 / -282 / -282). It is a suggestion
// the user can overwrite in the odds box, not a number anything is settled on.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccAltSpread = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    var SIGMA = 13;

    // The hold baked into a standard -110 spread price. Applied multiplicatively
    // so the suggestion lands exactly on -110 when the alt line IS the book line.
    var VIG = (110 / 210) / 0.5;

    // Abramowitz & Stegun 26.2.17 — good to ~7.5e-8, which is far past what a
    // price rounded to the nearest 5 cents can show.
    function normalCdf(z) {
        var t = 1 / (1 + 0.2316419 * Math.abs(z));
        var d = 0.3989422804014327 * Math.exp(-z * z / 2);
        var p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
        return z > 0 ? 1 - p : p;
    }

    // Both spreads are from the PICKED team's perspective: a favorite is
    // negative. Laying more points (alt below base) lowers this.
    function coverProbability(base, alt) {
        if (base == null || alt == null || isNaN(base) || isNaN(alt)) return null;
        return normalCdf((Number(alt) - Number(base)) / SIGMA);
    }

    function probToAmerican(p) {
        if (p == null) return null;
        var q = Math.min(Math.max(p, 0.01), 0.99);
        var raw = q >= 0.5 ? -100 * q / (1 - q) : 100 * (1 - q) / q;
        var rounded = Math.round(raw / 5) * 5;
        // Books don't quote between -100 and +100; nudge a coin flip to the
        // house side rather than emitting an impossible price.
        if (rounded > -100 && rounded < 100) return -110;
        return Math.max(Math.min(rounded, 5000), -5000);
    }

    // Suggested American price for `alt` given the book's `base`. Null when
    // there's no book line to move off of — the UI then asks for a price
    // instead of inventing one.
    function suggestedOdds(base, alt) {
        var p = coverProbability(base, alt);
        if (p == null) return null;
        return probToAmerican(p * VIG);
    }

    // Half-point ladder centred on the book line. Whole numbers stay on the
    // ladder: a pick ON a key number is a legitimate bet that can push, and
    // dropping them would quietly remove -3 and -7.
    function ladder(base, reach) {
        var centre = base == null || isNaN(base) ? 0 : Math.round(Number(base) * 2) / 2;
        var span = reach == null ? 21 : reach;
        var out = [];
        for (var v = centre - span; v <= centre + span + 1e-9; v += 0.5) {
            out.push(Math.round(v * 2) / 2);
        }
        return out;
    }

    // Bet-board rendering of a spread. A zero line is a pick 'em, and reads as
    // one — "Army 0" looks like a typo or a missing number.
    function formatLine(line) {
        if (line == null || isNaN(line)) return '';
        var n = Number(line);
        if (n === 0) return 'PK';
        return (n > 0 ? '+' : '') + (Number.isInteger(n) ? n : n.toFixed(1));
    }

    return {
        SIGMA: SIGMA,
        coverProbability: coverProbability,
        probToAmerican: probToAmerican,
        suggestedOdds: suggestedOdds,
        ladder: ladder,
        formatLine: formatLine
    };
}));
