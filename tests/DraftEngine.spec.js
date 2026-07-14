const engine = require('../modules/draft-engine');

describe('draft engine (snake logic)', () => {
    const snake = { draftOrder: ['A', 'B', 'C'], totalRounds: 4, snake: true, currentOverall: 1 };

    it('computes total picks', () => {
        expect(engine.totalPicks(snake)).toBe(12);
    });

    it('produces a correct snake pick order', () => {
        const order = engine.pickOrder(snake).map(p => p.userId);
        expect(order).toEqual(['A', 'B', 'C', 'C', 'B', 'A', 'A', 'B', 'C', 'C', 'B', 'A']);
    });

    it('reverses direction on even rounds', () => {
        expect(engine.whoseTurn({ ...snake, currentOverall: 1 }).userId).toBe('A'); // R1 first
        expect(engine.whoseTurn({ ...snake, currentOverall: 3 }).userId).toBe('C'); // R1 last
        expect(engine.whoseTurn({ ...snake, currentOverall: 4 }).userId).toBe('C'); // R2 first (reversed)
        expect(engine.whoseTurn({ ...snake, currentOverall: 6 }).userId).toBe('A'); // R2 last
    });

    it('reports the correct round number', () => {
        expect(engine.whoseTurn({ ...snake, currentOverall: 1 }).round).toBe(1);
        expect(engine.whoseTurn({ ...snake, currentOverall: 4 }).round).toBe(2);
        expect(engine.whoseTurn({ ...snake, currentOverall: 7 }).round).toBe(3);
    });

    it('returns null / complete once all picks are made', () => {
        expect(engine.whoseTurn({ ...snake, currentOverall: 13 })).toBeNull();
        expect(engine.isComplete({ ...snake, currentOverall: 13 })).toBe(true);
        expect(engine.isComplete({ ...snake, currentOverall: 12 })).toBe(false);
    });

    it('supports straight (non-snake) drafts', () => {
        const linear = { draftOrder: ['A', 'B', 'C'], totalRounds: 2, snake: false, currentOverall: 1 };
        expect(engine.pickOrder(linear).map(p => p.userId)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
    });
});
