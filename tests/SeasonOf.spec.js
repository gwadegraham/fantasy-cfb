// Coverage for public/season-of.js — the one way to read a manager's entry for
// a given season.
//
// The fixture that matters most here is `fullDoc`: a real manager document with
// four seasons in ascending order, where index 0 is 2023. Every assertion that
// uses it is guarding the bug this module exists to prevent — 35 call sites used
// to read index 0 and were correct only because a route had already narrowed the
// array with $elemMatch.

const { sameSeason, seasonOf, seasonOrEmpty, payloadSeasonEntry, payloadSeason } = require('../public/season-of');

// As stored: ascending, so seasons[0] is the OLDEST. This is the real shape in
// Mongo for every manager who has played since 2023.
const fullDoc = {
    _id: 'u1',
    seasons: [
        { season: 2023, cumulativeScore: 10, teams: [{ id: 1 }] },
        { season: 2024, cumulativeScore: 20, teams: [{ id: 2 }] },
        { season: 2025, cumulativeScore: 30, teams: [{ id: 3 }] },
        { season: 2026, cumulativeScore: 40, teams: [{ id: 4 }] }
    ]
};

// As a route returns it: seasons: { $elemMatch: { season } } leaves one entry.
const projected = { _id: 'u1', seasons: [{ season: 2026, cumulativeScore: 40 }] };

describe('sameSeason', () => {
    // This has to match how MONGO matched, not just look reasonable. Every
    // feeding query passes process.env.YEAR (a string) into `season: Number`,
    // and Mongoose casts it — so the document was selected numerically. A
    // String()-only comparison here would be narrower than the query that
    // fetched the doc, and the entry would come back null on a padded YEAR.
    test('matches numerically, the way the casting query did', () => {
        expect(sameSeason(2026, '2026')).toBe(true);
        expect(sameSeason('2026', 2026)).toBe(true);
        expect(sameSeason(2026, 2026)).toBe(true);
    });

    test('tolerates a padded or oddly formatted YEAR, which Mongo also matched', () => {
        // Not theoretical: this repo already ships `CFBD_API_KEY= Bearer …`
        // with a leading space, so a padded config var is a live possibility.
        expect(sameSeason(2026, '2026 ')).toBe(true);
        expect(sameSeason(2026, ' 2026')).toBe(true);
        expect(sameSeason(2026, '2026.0')).toBe(true);
        expect(sameSeason(2026, '+2026')).toBe(true);
    });

    test('still says no to a different season', () => {
        expect(sameSeason(2026, 2025)).toBe(false);
        expect(sameSeason(2026, '2025')).toBe(false);
    });

    test('never treats an empty or blank string as the number zero', () => {
        expect(sameSeason('', 0)).toBe(false);
        expect(sameSeason(0, '')).toBe(false);
        // A deliberate, unreachable divergence from Mongoose, which casts ''
        // to null and whitespace-only to 0. Being NARROWER than the cast is the
        // bug this module was fixed for — but only for values that can actually
        // reach it, and no call site passes a blank season (they pass YEAR, a
        // route param, Number(...), or a team doc's numeric season). Matching
        // "   " to season 0 would be the more surprising answer here.
        expect(sameSeason('   ', 0)).toBe(false);
    });

    test('falls back to exact string equality for non-numeric values', () => {
        expect(sameSeason('postseason', 'postseason')).toBe(true);
        expect(sameSeason('postseason', 'regular')).toBe(false);
        // Identical strings name the same thing, which is why NaN/NaN matches
        // on the string shortcut. Harmless — a NaN never matches a real season,
        // which is the property that actually protects a lookup.
        expect(sameSeason(NaN, 2026)).toBe(false);
        expect(sameSeason(2026, NaN)).toBe(false);
        expect(sameSeason(undefined, 2026)).toBe(false);
    });
});

describe('seasonOf', () => {
    test('picks the requested season out of a full document, not index 0', () => {
        expect(seasonOf(fullDoc, 2026).cumulativeScore).toBe(40);
        expect(seasonOf(fullDoc, 2023).cumulativeScore).toBe(10);
        // The whole point: index 0 would have answered 10 for the active season.
        expect(fullDoc.seasons[0].season).toBe(2023);
    });

    test('compares across types, since `season` is a Number but YEAR is a string', () => {
        expect(seasonOf(fullDoc, '2026').cumulativeScore).toBe(40);
        expect(seasonOf({ seasons: [{ season: '2026', cumulativeScore: 7 }] }, 2026).cumulativeScore).toBe(7);
    });

    test('finds the entry even when YEAR carries stray whitespace', () => {
        // The doc was selected by a query that cast '2026 ' to 2026, so the
        // lookup must not be stricter than the query — returning null here is
        // what would leave the scoring PATCH with nothing to write to.
        expect(seasonOf(fullDoc, '2026 ').cumulativeScore).toBe(40);
    });

    test('works the same on a projected one-element payload', () => {
        expect(seasonOf(projected, 2026).cumulativeScore).toBe(40);
    });

    test('returns null for a season the manager never played', () => {
        expect(seasonOf(fullDoc, 2022)).toBeNull();
        expect(seasonOf(projected, 2025)).toBeNull();
    });

    test('requires an explicit season — an implicit "current" is the bug being removed', () => {
        expect(seasonOf(fullDoc, null)).toBeNull();
        expect(seasonOf(fullDoc, undefined)).toBeNull();
    });

    test('survives missing and malformed input', () => {
        expect(seasonOf(null, 2026)).toBeNull();
        expect(seasonOf({}, 2026)).toBeNull();
        expect(seasonOf({ seasons: [] }, 2026)).toBeNull();
        expect(seasonOf({ seasons: [null, { season: 2026, teams: [] }] }, 2026).teams).toEqual([]);
    });
});

describe('seasonOrEmpty', () => {
    test('is seasonOf with a safe shape for callers that read a field straight off', () => {
        expect(seasonOrEmpty(fullDoc, 2025).cumulativeScore).toBe(30);
        expect(seasonOrEmpty(fullDoc, 2022)).toEqual({});
        expect(seasonOrEmpty(null, 2026)).toEqual({});
        // The common downstream shape: `.teams || []` rather than a throw.
        expect(seasonOrEmpty(fullDoc, 2022).teams).toBeUndefined();
    });
});

describe('payloadSeasonEntry', () => {
    test('reads the single entry a projected payload carries', () => {
        expect(payloadSeasonEntry(projected).cumulativeScore).toBe(40);
    });

    test('does not need the entry to carry a `season` field', () => {
        // Some callers only ever read weeklyScore/cumulativeScore off the
        // projection, so requiring `season` here would be a new failure mode.
        expect(payloadSeasonEntry({ seasons: [{ cumulativeScore: 5 }] }).cumulativeScore).toBe(5);
    });

    test('returns an empty shape rather than throwing', () => {
        expect(payloadSeasonEntry(null)).toEqual({});
        expect(payloadSeasonEntry({ seasons: [] })).toEqual({});
    });
});

describe('payloadSeason', () => {
    test('names which season a payload is about', () => {
        expect(payloadSeason([projected])).toBe(2026);
        expect(payloadSeason(projected)).toBe(2026);
    });

    test('skips managers with nothing projected and reads the first that has one', () => {
        expect(payloadSeason([{ seasons: [] }, projected])).toBe(2026);
    });

    test('is null when there is nothing to read', () => {
        expect(payloadSeason([])).toBeNull();
        expect(payloadSeason(null)).toBeNull();
        expect(payloadSeason([{ seasons: [{ cumulativeScore: 5 }] }])).toBeNull();
    });

    test('reports a past season when that is what the route projected', () => {
        // GET /users/league/:code?season=2024 — the payload defines the season,
        // and substituting the active year here is what would break that view.
        const past = { seasons: [{ season: 2024, cumulativeScore: 20 }] };
        expect(payloadSeason([past])).toBe(2024);
    });
});
