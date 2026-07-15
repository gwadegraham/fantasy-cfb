const { dedupeGamesById, massCreateInputError, gamesResponseError } = require('../modules/retrieve-games');

describe('dedupeGamesById', () => {
    it('removes games with duplicate ids (distinct object references)', () => {
        // Regression: two league teams can play each other, so the same game is
        // collected twice as separate objects. [...new Set(objects)] did NOT
        // dedupe these because Set keys on reference identity.
        const a = { id: 1, homeTeam: 'A' };
        const b = { id: 1, homeTeam: 'A' }; // same game, different object
        const c = { id: 2, homeTeam: 'B' };

        const result = dedupeGamesById([a, b, c]);

        expect(result).toHaveLength(2);
        expect(result.map(g => g.id)).toEqual([1, 2]);
    });

    it('keeps the first occurrence of each id', () => {
        const first = { id: 7, note: 'first' };
        const dup = { id: 7, note: 'second' };

        expect(dedupeGamesById([first, dup])).toEqual([{ id: 7, note: 'first' }]);
    });

    it('returns an empty array for empty input', () => {
        expect(dedupeGamesById([])).toEqual([]);
    });

    it('leaves an already-unique list unchanged', () => {
        const games = [{ id: 1 }, { id: 2 }, { id: 3 }];
        expect(dedupeGamesById(games)).toEqual(games);
    });
});

describe('massCreateInputError', () => {
    it('rejects a missing week (the dropdown-unselected case that crashed the server)', () => {
        expect(massCreateInputError('', 'regular')).toBe('week and seasonType are required');
        expect(massCreateInputError(undefined, 'regular')).toBe('week and seasonType are required');
    });

    it('rejects a missing seasonType', () => {
        expect(massCreateInputError('5', '')).toBe('week and seasonType are required');
    });

    it('passes valid inputs', () => {
        expect(massCreateInputError('5', 'regular')).toBeNull();
        expect(massCreateInputError('1', 'postseason')).toBeNull();
    });
});

describe('gamesResponseError', () => {
    it('flags a non-OK CFBD response and surfaces its message', () => {
        // What CFBD returns for an empty week: 400 + a JSON object, not an array.
        const body = { message: 'Validation Failed', details: { week: {} } };
        expect(gamesResponseError(false, 400, body)).toBe('Validation Failed');
    });

    it('flags a non-array body even on a 200 (would otherwise be "not iterable")', () => {
        expect(gamesResponseError(true, 200, { unexpected: 'shape' })).toBe('CFBD request failed (200)');
    });

    it('falls back to a status message when there is no error message', () => {
        expect(gamesResponseError(false, 500, null)).toBe('CFBD request failed (500)');
    });

    it('passes a normal array of games', () => {
        expect(gamesResponseError(true, 200, [{ id: 1 }, { id: 2 }])).toBeNull();
        expect(gamesResponseError(true, 200, [])).toBeNull();
    });
});
