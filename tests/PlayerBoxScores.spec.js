const {
    normalizePassing, normalizeRushing, normalizeReceiving,
    normalizeDefensive, normalizeKicking, normalizePunting,
    normalizePlayerStats, collectAthletes, LIMITS
} = require('../modules/player-box-scores');

// ---- collectAthletes -------------------------------------------------------

describe('collectAthletes', () => {
    it('merges multiple stat types into one object per athlete', () => {
        const types = [
            { name: 'YDS', athletes: [{ name: 'QB1', stat: '250' }] },
            { name: 'TD', athletes: [{ name: 'QB1', stat: '3' }] },
            { name: 'INT', athletes: [{ name: 'QB1', stat: '1' }] },
        ];
        const map = collectAthletes(types);
        expect(map.get('QB1')).toEqual({ name: 'QB1', YDS: '250', TD: '3', INT: '1' });
    });

    it('handles missing/empty types gracefully', () => {
        expect(collectAthletes(undefined).size).toBe(0);
        expect(collectAthletes([]).size).toBe(0);
    });
});

// ---- individual normalizers ------------------------------------------------

describe('normalizePassing', () => {
    const types = [
        { name: 'C/ATT', athletes: [
            { name: 'QB1', stat: '22/30' },
            { name: 'QB2', stat: '3/5' },
            { name: 'RB1', stat: '0/0' },
        ]},
        { name: 'YDS', athletes: [
            { name: 'QB1', stat: '280' },
            { name: 'QB2', stat: '45' },
            { name: 'RB1', stat: '0' },
        ]},
        { name: 'TD', athletes: [
            { name: 'QB1', stat: '3' },
            { name: 'QB2', stat: '0' },
        ]},
        { name: 'INT', athletes: [
            { name: 'QB1', stat: '1' },
        ]},
        { name: 'QBR', athletes: [
            { name: 'QB1', stat: '145.2' },
        ]},
    ];

    it('normalizes passing stats and sorts by yards descending', () => {
        const result = normalizePassing(types);
        expect(result).toHaveLength(2); // RB1 filtered (0 att)
        expect(result[0].name).toBe('QB1');
        expect(result[0]).toMatchObject({ c: 22, att: 30, yds: 280, td: 3, int: 1, qbr: 145.2 });
        expect(result[1].name).toBe('QB2');
    });

    it('respects the LIMITS cap', () => {
        const manyQBs = Array.from({ length: 5 }, (_, i) => ({
            name: 'C/ATT',
            athletes: [{ name: `QB${i}`, stat: `${10 + i}/${20 + i}` }]
        })).concat(Array.from({ length: 5 }, (_, i) => ({
            name: 'YDS',
            athletes: [{ name: `QB${i}`, stat: String(100 + i * 50) }]
        })));
        const result = normalizePassing(manyQBs);
        expect(result.length).toBeLessThanOrEqual(LIMITS.passing);
    });
});

describe('normalizeRushing', () => {
    it('normalizes rushing stats and filters out zero carries', () => {
        const types = [
            { name: 'CAR', athletes: [{ name: 'RB1', stat: '18' }, { name: 'WR1', stat: '0' }] },
            { name: 'YDS', athletes: [{ name: 'RB1', stat: '105' }] },
            { name: 'TD', athletes: [{ name: 'RB1', stat: '1' }] },
            { name: 'LONG', athletes: [{ name: 'RB1', stat: '32' }] },
        ];
        const result = normalizeRushing(types);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ name: 'RB1', car: 18, yds: 105, td: 1, lng: 32 });
    });
});

describe('normalizeReceiving', () => {
    it('normalizes receiving stats', () => {
        const types = [
            { name: 'REC', athletes: [{ name: 'WR1', stat: '8' }] },
            { name: 'YDS', athletes: [{ name: 'WR1', stat: '120' }] },
            { name: 'TD', athletes: [{ name: 'WR1', stat: '2' }] },
            { name: 'LONG', athletes: [{ name: 'WR1', stat: '45' }] },
        ];
        const result = normalizeReceiving(types);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ name: 'WR1', rec: 8, yds: 120, td: 2, lng: 45 });
    });
});

describe('normalizeDefensive', () => {
    it('normalizes defensive stats and sorts by total tackles', () => {
        const types = [
            { name: 'TOT', athletes: [
                { name: 'LB1', stat: '10' },
                { name: 'LB2', stat: '6' },
            ]},
            { name: 'SOLO', athletes: [
                { name: 'LB1', stat: '7' },
                { name: 'LB2', stat: '4' },
            ]},
            { name: 'TFL', athletes: [
                { name: 'LB1', stat: '2' },
            ]},
            { name: 'SACKS', athletes: [
                { name: 'LB1', stat: '1.0' },
            ]},
            { name: 'INT', athletes: [
                { name: 'LB2', stat: '1' },
            ]},
        ];
        const result = normalizeDefensive(types);
        expect(result[0].name).toBe('LB1');
        expect(result[0]).toMatchObject({ tot: 10, solo: 7, tfl: 2, sacks: 1 });
        expect(result[1]).toMatchObject({ name: 'LB2', tot: 6, int: 1 });
    });
});

describe('normalizeKicking', () => {
    it('parses FG and XP fraction strings', () => {
        const types = [
            { name: 'FG', athletes: [{ name: 'K1', stat: '2/3' }] },
            { name: 'LONG', athletes: [{ name: 'K1', stat: '47' }] },
            { name: 'XP', athletes: [{ name: 'K1', stat: '4/4' }] },
            { name: 'PTS', athletes: [{ name: 'K1', stat: '10' }] },
        ];
        const result = normalizeKicking(types);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ fgm: 2, fga: 3, pct: 66.7, lng: 47, xpm: 4, xpa: 4, pts: 10 });
    });
});

describe('normalizePunting', () => {
    it('normalizes punting stats', () => {
        const types = [
            { name: 'NO', athletes: [{ name: 'P1', stat: '5' }] },
            { name: 'YDS', athletes: [{ name: 'P1', stat: '215' }] },
            { name: 'AVG', athletes: [{ name: 'P1', stat: '43.0' }] },
            { name: 'LONG', athletes: [{ name: 'P1', stat: '52' }] },
            { name: 'TB', athletes: [{ name: 'P1', stat: '1' }] },
            { name: 'In 20', athletes: [{ name: 'P1', stat: '2' }] },
        ];
        const result = normalizePunting(types);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ name: 'P1', no: 5, yds: 215, avg: 43, lng: 52, tb: 1, in20: 2 });
    });
});

// ---- normalizePlayerStats (top-level) -------------------------------------

describe('normalizePlayerStats', () => {
    it('routes each category through its normalizer', () => {
        const categories = [
            { name: 'passing', types: [
                { name: 'C/ATT', athletes: [{ name: 'QB1', stat: '15/20' }] },
                { name: 'YDS', athletes: [{ name: 'QB1', stat: '200' }] },
            ]},
            { name: 'rushing', types: [
                { name: 'CAR', athletes: [{ name: 'RB1', stat: '12' }] },
                { name: 'YDS', athletes: [{ name: 'RB1', stat: '80' }] },
            ]},
        ];
        const result = normalizePlayerStats(categories);
        expect(result.passing).toHaveLength(1);
        expect(result.passing[0].name).toBe('QB1');
        expect(result.rushing).toHaveLength(1);
        expect(result.rushing[0].name).toBe('RB1');
    });

    it('ignores unknown categories (e.g. interceptions, fumbles)', () => {
        const categories = [
            { name: 'interceptions', types: [{ name: 'INT', athletes: [{ name: 'DB1', stat: '1' }] }] },
            { name: 'fumbles', types: [{ name: 'FUM', athletes: [{ name: 'RB1', stat: '1' }] }] },
        ];
        const result = normalizePlayerStats(categories);
        expect(result.interceptions).toBeUndefined();
        expect(result.fumbles).toBeUndefined();
    });

    it('returns empty object for non-array input', () => {
        expect(normalizePlayerStats(null)).toEqual({});
        expect(normalizePlayerStats(undefined)).toEqual({});
    });
});
