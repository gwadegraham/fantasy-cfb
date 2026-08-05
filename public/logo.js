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
    if (typeof module === 'object' && module.exports) { module.exports = factory(); }
    else {
        var cc = factory();
        root.ccLogo = cc.pickLogo;
        root.ccTeamColor = cc.teamColor;    // strong: legible as text on dark
        root.ccTeamAccent = cc.teamAccent;  // hue-true: accent bars/tints
        root.ccTeamTint = cc.teamTint;      // rgba wash of the accent color
    }
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

    // ---- Team colors ---------------------------------------------------------
    // CFBD gives each team a `color`/`alt_color` hex (sometimes without the '#').
    // The app is dark-themed, so a raw navy/black team color would disappear.
    // teamColor() lightens very dark colors until they read on #101322 (mirrors
    // team.js readableOnDark), and teamTint() returns an rgba wash of it. Used as
    // an *accent* only (bars, tints) — never for body text or large fills.
    function hexToRgb(hex) {
        if (typeof hex !== 'string') return null;
        var m = hex.trim().replace('#', '');
        if (m.length === 3) m = m.split('').map(function (c) { return c + c; }).join('');
        if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
        return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
    }
    function luminance(r, g, b) {
        var a = [r, g, b].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
    }
    // Lighten toward white until the color clears `minLum`. A high floor makes a
    // color readable as *text* (but desaturates strong-but-dark hues like scarlet
    // into pink); a low floor just rescues near-black/navy while keeping saturated
    // colors true — right for a decorative accent bar/tint.
    function lift(hex, minLum, step) {
        var rgb = hexToRgb(hex);
        if (!rgb) return null;
        var r = rgb.r, g = rgb.g, b = rgb.b, guard = 0;
        while (luminance(r, g, b) < minLum && guard < 14) {
            r = r + (255 - r) * step; g = g + (255 - g) * step; b = b + (255 - b) * step; guard++;
        }
        var h = function (v) { return Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'); };
        return '#' + h(r) + h(g) + h(b);
    }
    function teamColor(hex) { return lift(hex, 0.22, 0.18); }   // legible as text
    function teamAccent(hex) { return lift(hex, 0.10, 0.12); }  // hue-true bar/tint
    function teamTint(hex, alpha) {
        var rgb = hexToRgb(teamAccent(hex));
        if (!rgb) return '';
        return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (alpha == null ? 0.16 : alpha) + ')';
    }

    return { pickLogo: pickLogo, logoSize: logoSize, teamColor: teamColor, teamAccent: teamAccent, teamTint: teamTint };
}));
