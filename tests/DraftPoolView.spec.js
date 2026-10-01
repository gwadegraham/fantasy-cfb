// The draft room's team pool, per sport (#320).
//
// public/draftRoom.js has no tests — it is a browser global with no exports —
// and the pool table inside it was five hardcoded football assumptions: the
// column list, every cell, the mobile card, the sort, and the xWins bar.
//
// FOOTBALL'S HALF IS A CHARACTERISATION TEST. Its draft is the one that has
// actually run, so these pin what it renders TODAY, field by field, and the
// extraction is only safe because they do. Anything that changes here is a
// regression, not a design choice.

const view = require('../public/draft-pool-view');

const SEASON = 2026;

const team = (over = {}) => Object.assign({
    id: 333, school: 'Alabama', logos: ['a.png'], alternateNames: [],
    seasons: [
        { season: 2025, conference: 'SEC', cumulativeScoreV1: 100, cumulativeScoreV2: 180, spRating: 11.1, spRank: 12 },
        { season: 2026, conference: 'SEC', expectedWins: 9.4, spRating: 14.1, spRank: 7 }
    ]
}, over);

const hoops = (over = {}) => Object.assign({
    id: 10, school: 'Duke', logos: ['d.png'], conference: 'ACC',
    rank: 1, barthag: 0.9629, adjOE: 120.8, adjDE: 91, projectedRecord: '26-6'
}, over);

describe('football — unchanged, field for field', () => {
    test('a team becomes the row the table has always rendered', () => {
        const [row] = view.buildPool('football', [team()], [], SEASON, 'V2');
        expect(row).toEqual({
            id: 333, name: 'Alabama', logos: ['a.png'], conf: 'SEC',
            score: 180, xwins: 9.4, rank: null, sp: 14.1, spRank: 7, scoreYear: 2025
        });
    });

    test('V1 leagues read the other cumulative score', () => {
        // claunts-league scores on V1. Reading the wrong one shows every
        // manager someone else's season total.
        const [row] = view.buildPool('football', [team()], [], SEASON, 'V1');
        expect(row.score).toBe(100);
    });

    test('conference comes from the LAST season, not the current one', () => {
        // Ported as-is: a team with no entry for the active season still shows
        // a conference rather than a dash.
        const t = team({ seasons: [{ season: 2024, conference: 'Pac-12' }, { season: 2025, conference: 'Big Ten' }] });
        expect(view.buildPool('football', [t], [], SEASON, 'V2')[0].conf).toBe('Big Ten');
    });

    test('the preseason fallback uses last season\'s SP+ until this one publishes', () => {
        // Before the enrichment job runs, the current season has no rating.
        // Falling through to a dash would empty the column every August.
        const t = team({ seasons: [
            { season: 2025, conference: 'SEC', spRating: 11.1, spRank: 12 },
            { season: 2026, conference: 'SEC', expectedWins: 9.4 }
        ] });
        const [row] = view.buildPool('football', [t], [], SEASON, 'V2');
        expect(row.sp).toBe(11.1);
        expect(row.spRank).toBe(12);
    });

    test('a recruiting rank matches on the school OR an alternate name', () => {
        const t = team({ alternateNames: ['Bama'] });
        expect(view.buildPool('football', [t], [{ team: 'Bama', rank: 3 }], SEASON, 'V2')[0].rank).toBe(3);
        expect(view.buildPool('football', [t], [{ team: 'Alabama', rank: 5 }], SEASON, 'V2')[0].rank).toBe(5);
        expect(view.buildPool('football', [t], [{ team: 'Auburn', rank: 1 }], SEASON, 'V2')[0].rank).toBeNull();
    });

    test('a team with no seasons at all still produces a row', () => {
        const [row] = view.buildPool('football', [{ id: 1, school: 'New', logos: [] }], [], SEASON, 'V2');
        expect(row).toMatchObject({ conf: '-', score: null, xwins: 0, sp: null, scoreYear: null });
    });

    test('the columns are the ones the table shows today', () => {
        expect(view.columnsFor('football').map(c => c.key))
            .toEqual(['name', 'conf', 'sp', 'rank', 'score', 'xwins', 'draft']);
        // `draft` included: it carries no number, but .num is what
        // right-aligns the Draft button, and dropping it moved every button
        // in the table to the left.
        expect(view.columnsFor('football').filter(c => c.num).map(c => c.key))
            .toEqual(['sp', 'rank', 'score', 'xwins', 'draft']);
    });

    test('an unknown sport falls back to football, never to an empty table', () => {
        expect(view.columnsFor(undefined).map(c => c.key)).toEqual(view.columnsFor('football').map(c => c.key));
    });
});

describe('basketball', () => {
    test('a team becomes a row carrying the Torvik metrics', () => {
        const [row] = view.buildPool('basketball', [hoops()], [], 2027);
        expect(row).toEqual({
            id: 10, name: 'Duke', logos: ['d.png'], conf: 'ACC',
            rank: 1, barthag: 0.9629, adjOE: 120.8, adjDE: 91, projectedRecord: '26-6'
        });
    });

    test('its columns are its own, with no football metric among them', () => {
        const keys = view.columnsFor('basketball').map(c => c.key);
        expect(keys).toEqual(['name', 'conf', 'rank', 'barthag', 'adjOE', 'adjDE', 'proj', 'draft']);
        expect(keys).not.toContain('sp');
        expect(keys).not.toContain('xwins');
    });

    test('a team with no conference shows a dash rather than undefined', () => {
        expect(view.buildPool('basketball', [hoops({ conference: null })], [], 2027)[0].conf).toBe('-');
    });
});

describe('sorting', () => {
    test('a missing value sinks to the bottom of ITS OWN column', () => {
        // Three different sentinels, deliberately: a team with no score must
        // sort below one that scored zero, an unranked recruiting class below
        // #300, and no SP+ below the worst rating. One shared sentinel would
        // reorder all three.
        expect(view.sortValue({ score: null }, 'score')).toBeLessThan(view.sortValue({ score: 0 }, 'score'));
        expect(view.sortValue({ rank: null }, 'rank')).toBeGreaterThan(view.sortValue({ rank: 300 }, 'rank'));
        expect(view.sortValue({ sp: null }, 'sp')).toBeLessThan(view.sortValue({ sp: -50 }, 'sp'));
        // xWins is football's, and its sentinel was the one left untested —
        // flipping it to 999 kept all seventeen tests green.
        expect(view.sortValue({ xwins: null }, 'xwins')).toBeLessThan(view.sortValue({ xwins: 0 }, 'xwins'));
    });

    test('name and conference sort case-insensitively', () => {
        expect(view.sortValue({ name: 'alabama' }, 'name')).toBe(view.sortValue({ name: 'Alabama' }, 'name'));
    });

    test('defence sorts the way defence works — lower is better', () => {
        // The one basketball column where a smaller number is a better team.
        // An unrated team must not land at the top of it.
        expect(view.sortValue({ adjDE: 91 }, 'adjDE')).toBeLessThan(view.sortValue({ adjDE: 110 }, 'adjDE'));
        expect(view.sortValue({ adjDE: null }, 'adjDE')).toBeGreaterThan(view.sortValue({ adjDE: 120 }, 'adjDE'));
    });

    test('an unknown column is inert rather than throwing', () => {
        expect(view.sortValue({}, 'nonsense')).toBe(0);
    });
});

describe('the column the table opens on', () => {
    test('football waits for SP+ to exist before defaulting to it', () => {
        // Before the enrichment job runs, every rating is null and sorting on
        // it is meaningless — so it stays on xWins, which is where the table
        // has always opened.
        //
        // The first version of this test asserted `rank` and described that
        // as the existing behaviour. It was not: origin/main initialises
        // poolSort to { xwins, -1 } and only ever upgrades it to sp. The test
        // was pinning a regression it was written to prevent.
        const unrated = [{ sp: null }, { sp: null }];
        expect(view.defaultSort('football', unrated)).toEqual({ key: 'xwins', dir: -1 });
        expect(view.defaultSort('football', [{ sp: null }, { sp: 12 }])).toEqual({ key: 'sp', dir: -1 });
    });

    test('basketball opens on the T-Rank, best first', () => {
        // The pool IS the top N of that ranking, so any other default hides
        // which teams are in it.
        expect(view.defaultSort('basketball', [{ rank: 1 }])).toEqual({ key: 'rank', dir: 1 });
    });
});
