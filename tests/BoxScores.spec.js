const {
    normalizeTeamStats, parseStatValue, parsePenalties, fetchBoxScores,
    ingestBoxScores, STAT_MAP
} = require('../modules/box-scores');

jest.mock('../models/game', () => ({ updateOne: jest.fn(() => Promise.resolve({})) }));
const Game = require('../models/game');

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


// Every key in STAT_MAP has to be a string CFBD actually sends. A key that
// matches nothing is skipped silently by normalizeTeamStats, so a typo reads as
// "this team had none of that stat" instead of as an error — which is exactly
// how 'tackles For Loss' and 'penalties' sat unnoticed.
describe('STAT_MAP keys match CFBD category names', () => {
    // Verbatim category list from a real /games/teams response (2026 week 1).
    const CFBD_CATEGORIES = [
        'rushingTDs', 'puntReturnYards', 'puntReturnTDs', 'puntReturns', 'passingTDs',
        'kickReturnYards', 'kickReturnTDs', 'kickReturns', 'kickingPoints',
        'fumblesRecovered', 'totalFumbles', 'tacklesForLoss', 'defensiveTDs', 'tackles',
        'sacks', 'qbHurries', 'passesDeflected', 'possessionTime', 'interceptions',
        'fumblesLost', 'turnovers', 'totalPenaltiesYards', 'yardsPerRushAttempt',
        'rushingAttempts', 'rushingYards', 'yardsPerPass', 'completionAttempts',
        'netPassingYards', 'totalYards', 'fourthDownEff', 'thirdDownEff', 'firstDowns'
    ];

    it('every mapped key is a category CFBD sends', () => {
        const unknown = Object.keys(STAT_MAP).filter(k => !CFBD_CATEGORIES.includes(k));
        expect(unknown).toEqual([]);
    });

    it('maps tacklesForLoss, which the game detail comparison shows as TFL', () => {
        expect(normalizeTeamStats([{ category: 'tacklesForLoss', stat: '6' }]).tacklesForLoss).toBe(6);
    });
});

describe('parsePenalties', () => {
    it('splits CFBD\'s "count-yards" into both schema fields', () => {
        expect(parsePenalties('5-35')).toEqual({ penalties: 5, totalPenaltiesYards: 35 });
        expect(parsePenalties('8-71')).toEqual({ penalties: 8, totalPenaltiesYards: 71 });
    });

    it('handles a clean sheet', () => {
        expect(parsePenalties('0-0')).toEqual({ penalties: 0, totalPenaltiesYards: 0 });
    });

    it('returns nothing for a shape it does not recognise', () => {
        expect(parsePenalties(null)).toEqual({});
        expect(parsePenalties('12')).toEqual({});
        expect(parsePenalties('a-b')).toEqual({});
    });

    it('fills both penalty fields through normalizeTeamStats', () => {
        const out = normalizeTeamStats([{ category: 'totalPenaltiesYards', stat: '5-35' }]);
        expect(out.penalties).toBe(5);
        expect(out.totalPenaltiesYards).toBe(35);
    });
});

describe('fetchBoxScores request shape', () => {
    const OLD_ENV = process.env;
    beforeEach(() => {
        process.env = { ...OLD_ENV, CFBD_API_KEY: 'Bearer test' };
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            headers: { get: () => '29000' },
            json: () => Promise.resolve([])
        }));
    });
    afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

    // CFBD rejects a gameId-only request with 400 "either week, team, or
    // conference are required", which is what silently broke every ingest.
    it('asks by week and season type, never by game id alone', async () => {
        await fetchBoxScores(2026, 1, 'regular');
        const url = global.fetch.mock.calls[0][0];
        expect(url).toContain('year=2026');
        expect(url).toContain('week=1');
        expect(url).toContain('seasonType=regular');
        expect(url).not.toContain('gameId');
    });

    it('defaults an unknown season type to regular and passes postseason through', async () => {
        await fetchBoxScores(2026, 1);
        expect(global.fetch.mock.calls[0][0]).toContain('seasonType=regular');
        await fetchBoxScores(2026, 1, 'postseason');
        expect(global.fetch.mock.calls[1][0]).toContain('seasonType=postseason');
    });

    it('surfaces a non-ok response as an error rather than an empty result', async () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: false, status: 400,
            text: () => Promise.resolve('{"message":"Validation Failed"}')
        }));
        await expect(fetchBoxScores(2026, 1, 'regular')).rejects.toThrow(/400/);
    });
});

describe('ingestBoxScores', () => {
    const OLD_ENV = process.env;
    const weekResponse = [
        { id: 1, teams: [
            { homeAway: 'home', points: 54, stats: [{ category: 'totalYards', stat: '562' }] },
            { homeAway: 'away', points: 14, stats: [{ category: 'totalYards', stat: '198' }] }
        ] },
        { id: 2, teams: [
            { homeAway: 'home', points: 20, stats: [{ category: 'totalYards', stat: '300' }] },
            { homeAway: 'away', points: 13, stats: [{ category: 'totalYards', stat: '280' }] }
        ] }
    ];

    beforeEach(() => {
        process.env = { ...OLD_ENV, CFBD_API_KEY: 'Bearer test' };
        Game.updateOne.mockClear();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            headers: { get: () => '29000' },
            json: () => Promise.resolve(weekResponse)
        }));
    });
    afterEach(() => { process.env = OLD_ENV; jest.restoreAllMocks(); });

    // The week request comes back with the whole slate, so the id filter has to
    // happen locally — CFBD ignores gameId once a week is supplied.
    it('writes only the requested games when ids are given', async () => {
        const res = await ingestBoxScores(2026, 1, 'regular', [2]);
        expect(res.ingested).toBe(1);
        expect(Game.updateOne).toHaveBeenCalledTimes(1);
        expect(Game.updateOne.mock.calls[0][0]).toEqual({ id: 2 });
    });

    it('writes the whole week when no ids are given (backfill)', async () => {
        const res = await ingestBoxScores(2026, 1, 'regular');
        expect(res.ingested).toBe(2);
        expect(Game.updateOne).toHaveBeenCalledTimes(2);
    });

    it('spends one CFBD call regardless of how many games are wanted', async () => {
        await ingestBoxScores(2026, 1, 'regular', [1, 2]);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('records each side and the opponent points', async () => {
        await ingestBoxScores(2026, 1, 'regular', [1]);
        const written = Game.updateOne.mock.calls[0][1].$set.teamStats;
        expect(written.home.totalYards).toBe(562);
        expect(written.home.pointsAllowed).toBe(14);
        expect(written.away.totalYards).toBe(198);
        expect(written.away.pointsAllowed).toBe(54);
    });
});
