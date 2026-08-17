// Shared search ranking (client + server; UMD so both can load this one file,
// same as logo.js).
//
// Why this isn't a one-line `.filter(includes)`: 23 of the 138 FBS school names
// share their first word — Arkansas/Arkansas State, Arizona/Arizona State,
// Miami/Miami (OH), and so on. A substring filter in collection order answers
// "arkansas" with Arkansas STATE on top, which is the wrong team. So matches are
// TIERED (exact beats prefix beats word-start beats loose substring, and the
// primary name beats an alias), and inside a tier the SHORTER name wins. That
// pairing is what makes "ark" + Enter land on the Razorbacks.
//
// Items are uniform across types so teams and managers rank through one code
// path:
//   { type, id, name, sub, image, initials, color, aliases: [] }
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ccSearchMatch = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    // Match key: lowercase, strip accents, drop EVERYTHING non-alphanumeric.
    // Punctuation has to vanish rather than become a space, because the two
    // punctuated schools are the ones people type loosely — "texas am" has to
    // find "Texas A&M", and "miami oh" has to find "Miami (OH)". Collapsing to
    // spaces would leave "texas a m" and neither query would hit.
    function tight(s) {
        return String(s == null ? '' : s)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    // The same string as separate words, for word-start matching: "arkansas
    // state" -> ["arkansas", "state"], so "state" surfaces the State schools
    // without also matching every name with "st" buried inside it.
    function words(s) {
        return String(s == null ? '' : s)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
    }

    // Tiers. Lower sorts first. An exact ALIAS hit ranks with a primary prefix
    // hit: "pitt" is precisely Pittsburgh's alias and should not lose to some
    // longer school that merely contains the letters.
    var T = {
        EXACT: 0,
        PREFIX: 1,
        ALIAS_EXACT: 1,
        WORD: 2,
        SUB: 3,
        ALIAS_PREFIX: 4,
        ALIAS_SUB: 5,
        SUB_FIELD: 6      // conference / franchise name — useful, but never above a name hit
    };

    // Precompute the match keys once per session instead of re-normalizing 138
    // rows on every keystroke. Returns NEW objects; the caller's items are left
    // untouched.
    function prepare(items) {
        return (Array.isArray(items) ? items : []).map(function (it) {
            return {
                item: it,
                k: tight(it && it.name),
                w: words(it && it.name),
                a: ((it && it.aliases) || []).filter(Boolean).map(tight).filter(function (x) { return x.length > 0; }),
                s: tight(it && it.sub),
                len: String((it && it.name) || '').length
            };
        });
    }

    // Best (lowest) tier this entry earns for the query, or -1 for no match.
    function tierOf(e, q) {
        if (e.k === q) return T.EXACT;
        if (e.k.indexOf(q) === 0) return T.PREFIX;

        var i;
        for (i = 0; i < e.a.length; i++) {
            if (e.a[i] === q) return T.ALIAS_EXACT;
        }
        for (i = 1; i < e.w.length; i++) {          // from 1: word 0 is the PREFIX case above
            if (e.w[i].indexOf(q) === 0) return T.WORD;
        }
        if (e.k.indexOf(q) > 0) return T.SUB;
        for (i = 0; i < e.a.length; i++) {
            if (e.a[i].indexOf(q) === 0) return T.ALIAS_PREFIX;
        }
        for (i = 0; i < e.a.length; i++) {
            if (e.a[i].indexOf(q) > 0) return T.ALIAS_SUB;
        }
        if (e.s && e.s.indexOf(q) === 0) return T.SUB_FIELD;
        return -1;
    }

    // Ranked matches for a query, best first. Returns the ORIGINAL item objects.
    // No limit here — the caller slices per section, so a flood of conference
    // matches can't starve the managers out of the list.
    function rank(prepared, query) {
        var q = tight(query);
        if (!q) return [];

        var hits = [];
        for (var i = 0; i < prepared.length; i++) {
            var t = tierOf(prepared[i], q);
            if (t >= 0) hits.push({ e: prepared[i], t: t, i: i });
        }

        hits.sort(function (a, b) {
            if (a.t !== b.t) return a.t - b.t;
            // Shorter name first: Arkansas above Arkansas State.
            if (a.e.len !== b.e.len) return a.e.len - b.e.len;
            var an = String(a.e.item.name || ''), bn = String(b.e.item.name || '');
            return an.localeCompare(bn) || (a.i - b.i);
        });

        return hits.map(function (h) { return h.e.item; });
    }

    return { prepare: prepare, rank: rank, tight: tight, words: words, TIERS: T };
}));
