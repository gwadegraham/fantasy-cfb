const { logosById, applyLogos, sameLogos } = require('../modules/team-refresh');

describe('logosById', () => {
    test('maps team id -> logos array', () => {
        const map = logosById([
            { id: 333, logos: ['a', 'b'] },
            { id: 239, logos: ['c'] }
        ]);
        expect(map).toEqual({ 333: ['a', 'b'], 239: ['c'] });
    });
    test('skips teams without an id or a logos array', () => {
        expect(logosById([{ id: 1 }, { logos: ['x'] }, null])).toEqual({});
    });
});

describe('sameLogos', () => {
    test('true only when arrays match element-for-element', () => {
        expect(sameLogos(['a', 'b'], ['a', 'b'])).toBe(true);
        expect(sameLogos(['a', 'b'], ['a', 'c'])).toBe(false);
        expect(sameLogos(['a'], ['a', 'b'])).toBe(false);
        expect(sameLogos(undefined, ['a'])).toBe(false);
    });
});

describe('applyLogos', () => {
    const NEW_333 = ['https://cdn.collegefootballdata.com/logos-dark/500/333.png'];

    test('overwrites embedded logos from the map and counts changes', () => {
        const teams = [
            { id: 333, logos: ['http://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png'] },
            { id: 239, logos: ['old-239'] }
        ];
        const map = { 333: NEW_333, 239: ['old-239'] };   // 239 already current
        const changed = applyLogos(teams, map);
        expect(changed).toBe(1);                            // only 333 changed
        expect(teams[0].logos).toEqual(NEW_333);
        expect(teams[1].logos).toEqual(['old-239']);
    });

    test('re-running is a no-op (idempotent)', () => {
        const teams = [{ id: 333, logos: NEW_333.slice() }];
        expect(applyLogos(teams, { 333: NEW_333 })).toBe(0);
    });

    test('leaves teams not in the map untouched', () => {
        const teams = [{ id: 999, logos: ['keep'] }];
        expect(applyLogos(teams, { 333: NEW_333 })).toBe(0);
        expect(teams[0].logos).toEqual(['keep']);
    });

    test('copies the array (no shared reference back to the map)', () => {
        const teams = [{ id: 333, logos: ['old'] }];
        const src = ['x', 'y'];
        applyLogos(teams, { 333: src });
        expect(teams[0].logos).toEqual(src);
        expect(teams[0].logos).not.toBe(src);   // defensive copy
    });

    test('handles empty / missing inputs', () => {
        expect(applyLogos([], { 333: NEW_333 })).toBe(0);
        expect(applyLogos(undefined, {})).toBe(0);
    });
});
