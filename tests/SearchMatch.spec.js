// Ranking behind the app-wide search palette (public/search-match.js).
//
// The whole reason this module exists rather than a `.filter(includes)` is that
// 23 of the 138 FBS school names share their first word. Substring matching in
// collection order answers "arkansas" with Arkansas STATE on top — and Mongo
// really does return Arkansas State first, so that isn't hypothetical. The
// fixtures below are the REAL shapes from the teams collection (aliases
// included, verbatim) so these assertions track the data the palette will
// actually rank.

const match = require('../public/search-match.js');

const TEAMS = [
    { type: 'team', id: 8, name: 'Arkansas', sub: 'SEC', aliases: ['Razorbacks', 'ARK'] },
    { type: 'team', id: 2032, name: 'Arkansas State', sub: 'Sun Belt', aliases: ['Red Wolves', 'ARST'] },
    { type: 'team', id: 12, name: 'Arizona', sub: 'Big 12', aliases: ['Wildcats', 'ARIZ'] },
    { type: 'team', id: 9, name: 'Arizona State', sub: 'Big 12', aliases: ['Sun Devils', 'ASU'] },
    { type: 'team', id: 349, name: 'Army', sub: 'American Athletic', aliases: ['Black Knights'] },
    // Kansas is literally a substring of Arkansas — the cleanest real proof that
    // a prefix hit has to outrank a mid-string one.
    { type: 'team', id: 2305, name: 'Kansas', sub: 'Big 12', aliases: ['Jayhawks', 'KU'] },
    { type: 'team', id: 2306, name: 'Kansas State', sub: 'Big 12', aliases: ['Wildcats', 'KSU'] },
    // Both Miamis, with Miami (FL)'s real alias list.
    { type: 'team', id: 2390, name: 'Miami', sub: 'ACC', aliases: ['Miami (FL)', 'MIA', 'Hurricanes'] },
    { type: 'team', id: 193, name: 'Miami (OH)', sub: 'Mid-American', aliases: ['RedHawks'] },
    { type: 'team', id: 221, name: 'Pittsburgh', sub: 'ACC', aliases: ['Pitt', 'PITT', 'Panthers'] },
    { type: 'team', id: 245, name: 'Texas A&M', sub: 'SEC', aliases: ['TA&M', 'Aggies'] },
    { type: 'team', id: 251, name: 'Texas', sub: 'SEC', aliases: ['Longhorns', 'TEX'] },
    // Same length, same tier for a "t" query — the only thing left to separate
    // them is the alphabetical tie-break.
    { type: 'team', id: 2649, name: 'Temple', sub: 'American Athletic', aliases: ['Owls'] },
    { type: 'team', id: 2649, name: 'Toledo', sub: 'Mid-American', aliases: ['Rockets'] }
];

const MANAGERS = [
    { type: 'manager', id: 'u1', name: 'Garrett Graham', sub: 'Razorback Rejects', aliases: ['Razorback Rejects', 'Garrett', 'Graham'] },
    { type: 'manager', id: 'u2', name: 'Cole Smith', sub: '', aliases: ['Cole', 'Smith'] }
];

const prepared = match.prepare(TEAMS.concat(MANAGERS));
const names = (q) => match.rank(prepared, q).map((x) => x.name);

describe('tiering: the shared-first-word problem', () => {
    // The case that motivated the feature: nobody drafts Arkansas, so the only
    // way to their page was the draft room. Typing the name has to land on the
    // Razorbacks, not the Red Wolves.
    test('an exact name beats a longer name that starts with it', () => {
        expect(names('arkansas')[0]).toBe('Arkansas');
        expect(names('arizona')[0]).toBe('Arizona');
        expect(names('texas')[0]).toBe('Texas');
    });

    test('on a shared prefix the shorter name wins', () => {
        expect(names('ark')).toEqual(['Arkansas', 'Arkansas State']);
        expect(names('ariz')).toEqual(['Arizona', 'Arizona State']);
    });

    test('a prefix hit outranks a mid-string hit', () => {
        // "Kansas" sits inside "Arkansas". Both Kansases are prefix hits and must
        // clear both Arkansases, which only contain the letters.
        expect(names('kansas')).toEqual(['Kansas', 'Kansas State', 'Arkansas', 'Arkansas State']);
    });

    test('inside one tier, ordering is purely by name length', () => {
        const r = names('ar');
        // Every one of these is a prefix hit, so nothing but length separates
        // them — Army (4) through Arkansas State (14).
        expect(r.slice(0, 5)).toEqual(['Army', 'Arizona', 'Arkansas', 'Arizona State', 'Arkansas State']);
        // ...and "GARrett Graham" only contains the letters, so it trails every
        // prefix hit. Tiers outrank type: a manager isn't promoted for being a
        // manager, nor a team for being a team.
        expect(r[5]).toBe('Garrett Graham');
    });

    test('both Miamis come back, the ACC one first', () => {
        expect(names('miami')).toEqual(['Miami', 'Miami (OH)']);
    });

    test('equal tier and equal length fall back to alphabetical', () => {
        // Temple and Toledo are both 6-character prefix hits for "t", so neither
        // tier nor length separates them and the order must still be stable
        // rather than however Mongo happened to return them.
        const r = names('t');
        expect(r.slice(0, 3)).toEqual(['Texas', 'Temple', 'Toledo']);
    });
});

describe('aliases', () => {
    test('an exact alias resolves the school', () => {
        expect(names('pitt')[0]).toBe('Pittsburgh');
    });

    test('mascots are searchable', () => {
        expect(names('razorbacks')).toContain('Arkansas');
        expect(names('redhawks')).toEqual(['Miami (OH)']);
    });

    test('an alias disambiguates the Miamis', () => {
        expect(names('miami fl')).toEqual(['Miami']);
    });
});

describe('punctuation', () => {
    // The two punctuated schools are exactly the ones people type loosely.
    test('typing without the ampersand still finds Texas A&M', () => {
        expect(names('texas am')).toEqual(['Texas A&M']);
        expect(names('tam')).toContain('Texas A&M');
    });

    test('typing without the parens still finds Miami (OH)', () => {
        expect(names('miami oh')).toEqual(['Miami (OH)']);
    });
});

describe('word-start matching', () => {
    test('a non-leading word matches at its own tier', () => {
        expect(names('state').sort()).toEqual(['Arizona State', 'Arkansas State', 'Kansas State']);
    });

    test('a mid-word fragment does not masquerade as a word hit', () => {
        // "tate" is inside "State" but starts no word, so it falls to the loose
        // substring tier rather than ranking with real word hits.
        expect(names('tate').sort()).toEqual(['Arizona State', 'Arkansas State', 'Kansas State']);
    });
});

describe('managers', () => {
    test('managers match by first name, last name and franchise', () => {
        expect(names('garrett')).toContain('Garrett Graham');
        expect(names('graham')).toContain('Garrett Graham');
        expect(names('razorback rejects')).toEqual(['Garrett Graham']);
    });

    test('a manager and a team can match the same query, each still found', () => {
        // "razorback" hits Arkansas' mascot AND Garrett's franchise name. Both
        // must survive — the palette slices per type, so neither can crowd the
        // other out downstream.
        const r = match.rank(prepared, 'razorback');
        expect(r.some((x) => x.type === 'team' && x.name === 'Arkansas')).toBe(true);
        expect(r.some((x) => x.type === 'manager' && x.name === 'Garrett Graham')).toBe(true);
    });
});

describe('the sub field ranks last', () => {
    test('a conference match never outranks a name match', () => {
        const r = names('sec');
        // Texas / Texas A&M / Arkansas are SEC; none of them is named "sec", so
        // they arrive on the lowest tier and no name hit is displaced.
        expect(r).toContain('Texas');
        expect(names('acc')).toContain('Pittsburgh');
    });
});

describe('degenerate input', () => {
    test('an empty or punctuation-only query matches nothing', () => {
        expect(match.rank(prepared, '')).toEqual([]);
        expect(match.rank(prepared, '   ')).toEqual([]);
        expect(match.rank(prepared, '&&&')).toEqual([]);
    });

    test('a query that matches nothing returns an empty list', () => {
        expect(names('zzzzz')).toEqual([]);
    });

    test('prepare tolerates missing fields and leaves the caller\'s items alone', () => {
        const raw = [{ type: 'team', id: 1, name: 'Solo' }];
        const p = match.prepare(raw);
        expect(raw[0]).toEqual({ type: 'team', id: 1, name: 'Solo' });   // untouched
        expect(match.rank(p, 'solo')[0]).toBe(raw[0]);                   // original object back
        expect(match.prepare(null)).toEqual([]);
    });

    test('matching is case and accent insensitive', () => {
        expect(names('ARKANSAS')[0]).toBe('Arkansas');
        expect(match.tight('Málaga')).toBe('malaga');
    });
});
