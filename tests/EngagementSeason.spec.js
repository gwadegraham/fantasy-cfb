const { engagementForSeason, normalizeEngagement, ENGAGEMENT_DEFAULTS, resolveConfig } = require('../modules/scoring-defaults');

describe('normalizeEngagement', () => {
    test('fills defaults and coerces types', () => {
        expect(normalizeEngagement()).toEqual(ENGAGEMENT_DEFAULTS);
        expect(normalizeEngagement({})).toEqual(ENGAGEMENT_DEFAULTS);
        expect(normalizeEngagement({ h2hEnabled: 1, captainEnabled: 'yes' }))
            .toEqual({ h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: true, captainMultiplier: 2 });
    });

    test('keeps provided numeric bonus / tie bonus / multiplier', () => {
        expect(normalizeEngagement({ h2hEnabled: true, h2hWinBonus: 5, h2hTieBonus: 2, captainEnabled: true, captainMultiplier: 3 }))
            .toEqual({ h2hEnabled: true, h2hWinBonus: 5, h2hTieBonus: 2, captainEnabled: true, captainMultiplier: 3 });
    });
});

describe('engagementForSeason', () => {
    const bySeason = {
        '2026': { h2hEnabled: true, h2hWinBonus: 3, captainEnabled: true, captainMultiplier: 2 },
        '2027': { h2hEnabled: true, h2hWinBonus: 4, captainEnabled: false, captainMultiplier: 2 }
    };

    test('returns the exact season entry', () => {
        expect(engagementForSeason(bySeason, '2026'))
            .toEqual({ h2hEnabled: true, h2hWinBonus: 3, h2hTieBonus: 0, captainEnabled: true, captainMultiplier: 2 });
    });

    test('seasons are independent — 2027 has Captain off while 2026 has it on', () => {
        expect(engagementForSeason(bySeason, '2026').captainEnabled).toBe(true);
        expect(engagementForSeason(bySeason, '2027').captainEnabled).toBe(false);
        expect(engagementForSeason(bySeason, '2027').h2hWinBonus).toBe(4);
    });

    test('a season with no entry is fully OFF (so a rescore adds no bonus)', () => {
        expect(engagementForSeason(bySeason, '2025')).toEqual(ENGAGEMENT_DEFAULTS);
        expect(engagementForSeason(bySeason, 2025)).toEqual(ENGAGEMENT_DEFAULTS);
    });

    test('handles number/string season keys and an empty/absent map', () => {
        expect(engagementForSeason(bySeason, 2026).h2hEnabled).toBe(true);   // number lookup
        expect(engagementForSeason({}, '2026')).toEqual(ENGAGEMENT_DEFAULTS);
        expect(engagementForSeason(undefined, '2026')).toEqual(ENGAGEMENT_DEFAULTS);
        expect(engagementForSeason(null, 2026)).toEqual(ENGAGEMENT_DEFAULTS);
    });
});

describe('resolveConfig passes engagementBySeason through', () => {
    test('carries the raw map so engagementForSeason can read it', () => {
        const bySeason = { '2026': { h2hEnabled: true } };
        const cfg = resolveConfig('graham-league', { engagementBySeason: bySeason });
        expect(cfg.engagementBySeason).toBe(bySeason);
        expect(engagementForSeason(cfg.engagementBySeason, '2026').h2hEnabled).toBe(true);
        expect(engagementForSeason(cfg.engagementBySeason, '2025').h2hEnabled).toBe(false);
    });

    test('defaults engagementBySeason to an empty object when absent', () => {
        expect(resolveConfig('graham-league', null).engagementBySeason).toEqual({});
    });
});
