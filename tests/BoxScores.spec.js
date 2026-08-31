const { normalizeTeamStats, parseStatValue, STAT_MAP } = require('../modules/box-scores');

describe('parseStatValue', () => {
    it('parses plain numbers', () => {
        expect(parseStatValue('totalYards', '385')).toBe(385);
        expect(parseStatValue('turnovers', '2')).toBe(2);
        expect(parseStatValue('rushingYards', 142)).toBe(142);
    });

    it('parses possession time MM:SS to seconds', () => {
        expect(parseStatValue('possessionTime', '32:15')).toBe(32 * 60 + 15);
        expect(parseStatValue('possessionTime', '27:45')).toBe(27 * 60 + 45);
    });

    it('parses efficiency fractions to percentages', () => {
        expect(parseStatValue('thirdDownEff', '5-12')).toBeCloseTo(41.67, 1);
        expect(parseStatValue('fourthDownEff', '2-3')).toBeCloseTo(66.67, 1);
        expect(parseStatValue('thirdDownEff', '0-5')).toBe(0);
    });

    it('returns undefined for garbage', () => {
        expect(parseStatValue('totalYards', null)).toBeUndefined();
        expect(parseStatValue('totalYards', 'abc')).toBeUndefined();
        expect(parseStatValue('possessionTime', 'bad')).toBeUndefined();
        expect(parseStatValue('thirdDownEff', 'x-y')).toBeUndefined();
    });

    it('handles zero-attempt efficiency without dividing by zero', () => {
        expect(parseStatValue('thirdDownEff', '0-0')).toBeUndefined();
    });
});

describe('normalizeTeamStats', () => {
    it('maps CFBD stat categories to schema fields', () => {
        const cfbd = [
            { category: 'totalYards', stat: '420' },
            { category: 'netPassingYards', stat: '285' },
            { category: 'rushingYards', stat: '135' },
            { category: 'turnovers', stat: '2' },
            { category: 'possessionTime', stat: '31:10' },
            { category: 'thirdDownEff', stat: '6-14' },
        ];
        const result = normalizeTeamStats(cfbd);
        expect(result.totalYards).toBe(420);
        expect(result.netPassingYards).toBe(285);
        expect(result.rushingYards).toBe(135);
        expect(result.turnovers).toBe(2);
        expect(result.possessionSeconds).toBe(31 * 60 + 10);
        expect(result.thirdDownPct).toBeCloseTo(42.86, 1);
    });

    it('skips unmapped categories', () => {
        const cfbd = [
            { category: 'totalYards', stat: '300' },
            { category: 'kickReturnYards', stat: '85' },
        ];
        const result = normalizeTeamStats(cfbd);
        expect(result.totalYards).toBe(300);
        expect(result.kickReturnYards).toBeUndefined();
    });

    it('returns empty object for non-array input', () => {
        expect(normalizeTeamStats(null)).toEqual({});
        expect(normalizeTeamStats(undefined)).toEqual({});
    });

    it('handles zero values', () => {
        const cfbd = [{ category: 'turnovers', stat: '0' }];
        expect(normalizeTeamStats(cfbd).turnovers).toBe(0);
    });
});
