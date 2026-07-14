const { dedupeGamesById } = require('../modules/retrieve-games');

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
