// Shared team-logo selector (client + server; UMD so both can load this one file).
//
// CFBD's /teams endpoint now returns many logo URLs — 8 sizes × light/dark
// variants, ordered largest-first, e.g.
//   logos/500/333.png, logos-dark/500/333.png, logos/256/333.png, ... logos-dark/16/333.png
// (Older ESPN payloads were just [light-500, dark-500].)
//
// The app is dark-themed, so it wants the DARK variant at the LARGEST size.
// Picking by array POSITION is fragile against this: the codebase used
// `logos.at(-1)`, which was the dark-500 logo on the old 2-element array but
// becomes the dark-*16px* logo on the new one — blurry everywhere. pickLogo
// chooses by variant + resolution instead, so it's correct on both shapes.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccLogo = factory().pickLogo;
}(typeof self !== 'undefined' ? self : this, function () {
    // The pixel size from a logo URL — the path segment before the filename
    // (".../500/333.png" -> 500; ESPN's ".../500-dark/333.png" -> 500). 0 if none.
    function logoSize(url) {
        var seg = String(url == null ? '' : url).split('/').slice(-2)[0] || '';
        var n = parseInt(seg, 10);
        return isFinite(n) ? n : 0;
    }

    // Best logo for a surface: the wanted variant (dark by default, for the dark
    // UI; opts.dark === false picks light, e.g. for emails / light pages) at the
    // highest resolution. Falls back to the full list when a team has only one
    // variant, and to '' for an empty/missing array.
    function pickLogo(logos, opts) {
        var wantDark = !(opts && opts.dark === false);
        var list = Array.isArray(logos) ? logos.filter(Boolean) : [];
        if (!list.length) return '';
        var pref = list.filter(function (u) { return /dark/i.test(u) === wantDark; });
        var pool = pref.length ? pref : list;
        // Largest size wins; on a tie (or no size info at all) prefer the LAST
        // entry, so with variant-less / unsized arrays we fall back to exactly the
        // old `.at(-1)` behavior. pickLogo only ever changes the choice when it can
        // identify a genuinely better (dark, higher-res) logo.
        var best = pool.map(function (u, i) { return { u: u, i: i, s: logoSize(u) }; })
            .sort(function (a, b) { return (b.s - a.s) || (b.i - a.i); })[0];
        return best.u;
    }

    return { pickLogo: pickLogo, logoSize: logoSize };
}));
