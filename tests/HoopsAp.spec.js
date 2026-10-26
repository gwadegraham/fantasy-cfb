// The basketball AP Top 25: the rank shown beside team names. Display only —
// nothing that scores reads it (modules/hoops-ap.js).
//
// These pin what would show a wrong number quietly: the unranked "others
// receiving votes" rows, a team dropped from a corrected poll, which poll is
// in force on a given night, and that the job's failure is an error row AND
// an email. CBBD is always stubbed.

const { useMongo } = require('./helpers/mongo');
const hoopsAp = require('../modules/hoops-ap');
const job = require('../modules/hoops-ap-job');
const cbbd = require('../modules/cbbd-client');
const jobLogger = require('../modules/job-logger');
const jobMailer = require('../modules/job-mailer');
const HoopsApRank = require('../models/hoopsApRank');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const SEASON = 2027;
const PRESEASON = '2026-10-19T00:00:00.000Z';
const WEEK2 = '2026-11-09T00:00:00.000Z';

// CBBD's /rankings row, cut down to what the ingest reads.
const row = (week, pollDate, teamId, team, ranking, o = {}) => Object.assign({
    season: SEASON, seasonType: 'regular', week, pollDate, pollType: 'AP Top 25',
    teamId, team, conference: 'X', ranking, points: 1000, firstPlaceVotes: 0
}, o);

function stubCbbd(data) {
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async () => {
        if (data instanceof Error) throw data;
        return { data, remainingCalls: 29000 };
    });
}

beforeEach(() => {
    hoopsAp.clearCache();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('ingest', () => {
    test('one /rankings call for the whole season, AP only, ranked rows only', async () => {
        const get = stubCbbd([
            row(1, PRESEASON, 87, 'Florida', 1, { firstPlaceVotes: 47 }),
            row(1, PRESEASON, 72, 'Duke', 2),
            row(1, PRESEASON, 120, 'Purdue', null),                    // receiving votes
            row(1, PRESEASON, 50, 'Kansas', 9, { pollType: 'Coaches Poll' })
        ]);
        const r = await hoopsAp.ingest(SEASON);
        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/rankings', { season: SEASON, pollType: 'ap' });
        expect(r).toMatchObject({ polls: 1, rows: 2 });
        const stored = await HoopsApRank.find({}).sort({ rank: 1 }).lean();
        expect(stored.map(s => [s.teamId, s.rank])).toEqual([[87, 1], [72, 2]]);
        expect(stored[0]).toMatchObject({ school: 'Florida', firstPlaceVotes: 47, week: 1, seasonType: 'regular' });
    });

    test('a re-run rewrites the poll: a team CBBD has since dropped leaves it', async () => {
        stubCbbd([row(1, PRESEASON, 87, 'Florida', 1), row(1, PRESEASON, 72, 'Duke', 2)]);
        await hoopsAp.ingest(SEASON);
        jest.restoreAllMocks();
        stubCbbd([row(1, PRESEASON, 72, 'Duke', 1), row(2, WEEK2, 72, 'Duke', 3)]);
        await hoopsAp.ingest(SEASON);
        const stored = await HoopsApRank.find({}).sort({ week: 1 }).lean();
        expect(stored.map(s => [s.week, s.teamId, s.rank])).toEqual([[1, 72, 1], [2, 72, 3]]);
    });

    test('a fresh ingest is read at once, not after the cache expires', async () => {
        stubCbbd([row(1, PRESEASON, 72, 'Duke', 4)]);
        expect(await hoopsAp.cachedPolls(SEASON)).toEqual([]);
        await hoopsAp.ingest(SEASON);
        const polls = await hoopsAp.cachedPolls(SEASON);
        expect(polls).toHaveLength(1);
        expect(polls[0].ranks).toEqual({ 72: 4 });
    });
});

// CBBD stamps a poll at Monday 00:00 UTC — Sunday evening Central, with late
// games still on. A Sunday tip must read the poll out when it tipped.
test('a late Sunday tip keeps the poll it tipped under, though CBBD stamps the next one Sunday evening Central', async () => {
    await HoopsApRank.create([
        { season: SEASON, seasonType: 'regular', week: 1, pollDate: new Date('2026-11-09T00:00:00Z'), teamId: 72, rank: 3 },
        { season: SEASON, seasonType: 'regular', week: 2, pollDate: new Date('2026-11-16T00:00:00Z'), teamId: 72, rank: 12 }
    ]);
    const list = await hoopsAp.polls(SEASON);
    expect(hoopsAp.rankAt(list, 72, '2026-11-16T00:30:00Z')).toBe(3);    // Sun 15 Nov, 18:30 CST tip
    expect(hoopsAp.rankAt(list, 72, '2026-11-16T23:00:00Z')).toBe(12);   // Monday evening
});

test('a row with no week is not stored', async () => {
    stubCbbd([row(null, PRESEASON, 72, 'Duke', 4), row(1, PRESEASON, 87, 'Florida', 1)]);
    const r = await hoopsAp.ingest(SEASON);
    expect(r.rows).toBe(1);
    expect(await HoopsApRank.distinct('teamId')).toEqual([87]);
});

describe('the poll in force', () => {
    // polls() turns each CBBD stamp into its Monday, UTC midnight.
    const polls = [
        { at: Date.parse(PRESEASON), ranks: { 72: 2, 87: 1 } },
        { at: Date.parse(WEEK2), ranks: { 72: 5 } }
    ];

    test('is the latest whose Monday is on or before the game\'s Eastern day', () => {
        expect(hoopsAp.rankAt(polls, 72, '2026-11-05T00:00:00Z')).toBe(2);
        expect(hoopsAp.rankAt(polls, 72, '2026-11-09T23:00:00Z')).toBe(5);   // Monday evening
        expect(hoopsAp.rankAt(polls, 72, new Date('2027-01-01T00:00:00Z'))).toBe(5);
    });

    // CBBD's placeholder for an unannounced tip is midnight EASTERN — 05:00
    // UTC in winter. A Monday TBD game is a Monday game.
    test('a Monday TBD game reads that Monday\'s poll', () => {
        expect(hoopsAp.rankAt(polls, 72, '2026-11-09T05:00:00Z')).toBe(5);
    });

    test('a team outside that poll, a game before any poll, or no date: no rank', () => {
        expect(hoopsAp.rankAt(polls, 87, '2026-11-20T00:00:00Z')).toBeNull();   // dropped out in week 2
        expect(hoopsAp.rankAt(polls, 72, '2026-10-01T00:00:00Z')).toBeNull();
        expect(hoopsAp.rankAt(polls, 72, null)).toBeNull();
        expect(hoopsAp.rankAt(polls, 72, 'not a date')).toBeNull();
        expect(hoopsAp.ranksAt([], Date.now())).toEqual({});
    });
});

describe('a changed CBBD answer fails loudly', () => {
    test('rows that read as no AP poll: an error, nothing written', async () => {
        stubCbbd([row(1, PRESEASON, 87, 'Florida', 1, { pollType: 'AP Poll' })]);
        await expect(hoopsAp.ingest(SEASON)).rejects.toThrow(/response shape changed/);
        expect(await HoopsApRank.countDocuments({})).toBe(0);
    });

    test('an empty answer once polls are stored: an error, the stored polls kept', async () => {
        await HoopsApRank.create({ season: SEASON, seasonType: 'regular', week: 1, pollDate: new Date(PRESEASON), teamId: 87, rank: 1 });
        stubCbbd([]);
        await expect(hoopsAp.ingest(SEASON)).rejects.toThrow(/no AP polls for 2027, but 1 rows are stored/);
        expect(await HoopsApRank.countDocuments({})).toBe(1);
    });
});

describe('the daily job', () => {
    beforeEach(async () => {
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
    });

    test('silent and free with no basketball league', async () => {
        const get = stubCbbd([]);
        const r = await job.run({ now: new Date('2026-10-26T17:45:00Z') });
        expect(r).toMatchObject({ skippedReason: 'no basketball leagues' });
        expect(get).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    describe('with a basketball league', () => {
        beforeEach(async () => {
            await League.create({ code: 'hh', name: 'Hardwood Heroes', sport: 'basketball' });
            await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'preseason' }]);
            await seasons.prime();
        });

        test('stores the polls and logs what it found', async () => {
            stubCbbd([row(1, PRESEASON, 87, 'Florida', 1), row(2, WEEK2, 87, 'Florida', 2)]);
            await job.run({ now: new Date('2026-11-09T18:45:00Z') });
            expect(await HoopsApRank.countDocuments({})).toBe(2);
            expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', '2027: 2 polls, 2 rows, latest Nov 9');
            expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();
        });

        test('before the first poll is published: a quiet success, nothing stored', async () => {
            stubCbbd([]);
            await job.run({ now: new Date('2026-10-12T17:45:00Z') });
            expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', '2027: 0 polls, 0 rows');
            expect(await HoopsApRank.countDocuments({})).toBe(0);
        });

        test('one poll reads in the singular', async () => {
            stubCbbd([row(1, PRESEASON, 87, 'Florida', 1)]);
            await job.run();
            expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', '2027: 1 poll, 1 rows, latest Oct 19');
        });

        test('a CBBD failure is an error row and an email, and keeps what was stored', async () => {
            await HoopsApRank.create({ season: SEASON, seasonType: 'regular', week: 1, pollDate: new Date(PRESEASON), teamId: 87, rank: 1 });
            stubCbbd(new Error('CBBD /rankings 500: boom'));
            await job.run({ now: new Date('2026-11-09T18:45:00Z') });
            expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', expect.stringContaining('FAILED CBBD /rankings 500'));
            expect(jobMailer.sendJobEmail).toHaveBeenCalledWith(expect.objectContaining({ ok: false, label: 'Hoops AP Poll' }));
            expect(await HoopsApRank.countDocuments({})).toBe(1);
        });
    });
});
