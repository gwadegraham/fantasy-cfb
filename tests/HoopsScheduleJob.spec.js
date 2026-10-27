// The daily schedule look-ahead: modules/hoops-schedule-job.js.
//
// What it must get right: it pulls FORWARD (the nightly refresh only looks
// back), it creates games nobody ingested and corrects TBD tip times, it
// spends one call per season type and nothing in the off-season, and a
// failure is loud.
//
// cbbd.fetchGamesInRange is always spied — jest loads the real .env, so an
// unstubbed call would hit CBBD and bill the shared pool. The upsert behind
// it is the real one.

const { useMongo } = require('./helpers/mongo');
const job = require('../modules/hoops-schedule-job');
const cbbd = require('../modules/cbbd-client');
const jobLogger = require('../modules/job-logger');
const jobMailer = require('../modules/job-mailer');
const HoopsGame = require('../models/hoopsGame');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const hoopsGames = require('../routes/hoopsGames');
const seasons = require('../modules/active-season');
const espnTipTimes = require('../modules/hoops-espn-tip-times');

useMongo();

const SEASON = 2027;
const NOW = new Date('2026-10-21T11:40:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

// The regular season's last stored game. Without it a fixture's lone
// November game reads as "the regular season is ending", and the postseason
// is fetched too.
const SEASON_END = (id = 99) => stored(id, '2027-03-08T00:00:00Z');
const stored = (id, iso, o = {}) => Object.assign({
    id, season: SEASON, week: 1, seasonType: 'regular', startDate: new Date(iso), status: 'scheduled',
    homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B'
}, o);
// A game in CBBD's /games shape.
const cbbdGame = (id, iso, o = {}) => Object.assign({
    id, season: SEASON, seasonLabel: '20262027', seasonType: 'regular', startDate: iso, startTimeTbd: false,
    status: 'scheduled', homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B', homePoints: 0, awayPoints: 0
}, o);

function stubFetch(byType) {
    return jest.spyOn(cbbd, 'fetchGamesInRange').mockImplementation(async (season, seasonType) => {
        const data = byType[seasonType];
        if (data instanceof Error) throw data;
        return { games: data || [], windows: 1, remainingCalls: 29000, capHits: [] };
    });
}

beforeEach(async () => {
    await League.create({ code: 'hh', name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'preseason' }]);
    await seasons.prime();
    jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
    jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // The ESPN fill's network side; its behaviour is HoopsEspnTipTimes.spec.js.
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network call'));
});

afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('pulling ahead', () => {
    test('asks for the NEXT four weeks, not the last three days', async () => {
        await HoopsGame.create([stored(1, '2026-11-03T00:30:00Z'), SEASON_END()]);
        const fetch = stubFetch({ regular: [cbbdGame(1, '2026-11-03T00:30:00Z')] });

        await job.run({ now: NOW });

        expect(fetch).toHaveBeenCalledTimes(1);
        const [season, type, start, end] = fetch.mock.calls[0];
        expect([season, type]).toEqual([SEASON, 'regular']);
        expect(start.getTime()).toBe(NOW.getTime());
        expect(end.getTime()).toBe(NOW.getTime() + job.LOOKAHEAD_DAYS * DAY_MS);
    });

    test('the window is ONE billable /games call', () => {
        expect(cbbd.windowsFor(NOW, new Date(NOW.getTime() + job.LOOKAHEAD_DAYS * DAY_MS))).toBe(1);
    });

    test('creates a game nobody ingested and fills in an announced tip time', async () => {
        await HoopsGame.create([stored(1, '2026-11-02T05:00:00Z', { startTimeTbd: true }), SEASON_END()]);
        stubFetch({
            regular: [
                cbbdGame(1, '2026-11-03T00:00:00Z'),
                cbbdGame(2, '2026-11-04T02:00:00Z', { homeTeam: 'Gonzaga', conferenceGame: true })
            ]
        });

        const out = await job.run({ now: NOW });

        expect(out.failed).toBeNull();
        expect(out.summary).toBe(`${SEASON} regular: 1 new, 1 updated`);
        const tipped = await HoopsGame.findOne({ id: 1 }).lean();
        expect(tipped.startTimeTbd).toBe(false);
        expect(tipped.startDate.toISOString()).toBe('2026-11-03T00:00:00.000Z');
        expect(await HoopsGame.exists({ id: 2, homeTeam: 'Gonzaga' })).toBeTruthy();
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', out.summary);
        expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();
    });

    test('in March the postseason is pulled too, before any bracket game is stored', async () => {
        const MARCH = new Date('2027-03-01T11:40:00Z');
        await HoopsGame.create([stored(1, '2027-03-05T00:00:00Z'), SEASON_END()]);
        const fetch = stubFetch({
            regular: [cbbdGame(1, '2027-03-05T00:00:00Z'), cbbdGame(99, '2027-03-08T00:00:00Z')],
            postseason: [cbbdGame(9, '2027-03-19T17:00:00Z', { seasonType: 'postseason' })]
        });

        const out = await job.run({ now: MARCH });

        expect(out.failed).toBeNull();
        expect(fetch.mock.calls.map(c => c[1])).toEqual(['regular', 'postseason']);
        expect(await HoopsGame.exists({ id: 9, seasonType: 'postseason' })).toBeTruthy();
    });

    // 2027's last regular game is 8 Mar; the Final Four is 3 Apr, its
    // matchups set ~28 Mar. Measured from the window's end, the postseason
    // stopped being asked for on ~25 Mar.
    test('the postseason is still pulled ahead at the end of March, for the Final Four', async () => {
        await HoopsGame.create(SEASON_END());
        const at = (iso) => job.seasonTypesAhead(SEASON, new Date(iso), new Date(new Date(iso).getTime() + job.LOOKAHEAD_DAYS * DAY_MS));

        expect(await at('2027-02-01T11:40:00Z')).toEqual([]);
        expect(await at('2027-02-10T11:40:00Z')).toEqual(['regular', 'postseason']);
        expect(await at('2027-03-30T11:40:00Z')).toEqual(['postseason']);
        expect(await at('2027-04-23T11:40:00Z')).toEqual([]);
    });
});

describe('skips, silently and for free', () => {
    test('no basketball league: no call, no JobRun', async () => {
        await League.deleteMany({});
        const fetch = stubFetch({});
        const out = await job.run({ now: NOW });

        expect(out.skippedReason).toBe('no basketball leagues');
        expect(fetch).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    test('nothing scheduled in the window (off-season): no call, no JobRun', async () => {
        await HoopsGame.create(stored(1, '2027-03-01T00:00:00Z'));
        const fetch = stubFetch({});
        const out = await job.run({ now: new Date('2027-07-01T11:40:00Z') });

        expect(out.skippedReason).toBe('nothing scheduled');
        expect(fetch).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });
});

describe('failures are loud', () => {
    test('CBBD unreachable: an error JobRun and an email', async () => {
        await HoopsGame.create([stored(1, '2026-11-03T00:30:00Z'), SEASON_END()]);
        stubFetch({ regular: new Error('Could not reach CBBD: ECONNRESET') });

        const out = await job.run({ now: NOW });

        expect(out.failed).toMatch(/ECONNRESET/);
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', expect.stringMatching(/FAILED/));
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });

    test('the refresh itself throws (a database error): still an error JobRun and an email', async () => {
        await HoopsGame.create([stored(1, '2026-11-03T00:30:00Z'), SEASON_END()]);
        jest.spyOn(hoopsGames, 'refreshResults').mockRejectedValue(new Error('bulkWrite timed out'));

        const out = await job.run({ now: NOW });

        expect(out.failed).toBe('bulkWrite timed out');
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', `${SEASON} regular: FAILED bulkWrite timed out`);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });

    test('CBBD returns nothing for games we have stored: a 422, not a quiet morning', async () => {
        await HoopsGame.create([stored(1, '2026-11-03T00:30:00Z'), SEASON_END()]);
        stubFetch({ regular: [] });

        const out = await job.run({ now: NOW });

        expect(out.failed).toMatch(/regular 422: CBBD returned no regular games/);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });
});

describe('the ESPN tip-time fill', () => {
    const counts = (o) => Object.assign({ candidates: 3, filled: 0, updated: 0, unchanged: 0, reverted: 0,
        espnTbd: 0, dayMismatch: 0, notOnEspn: 0, lost: 0, failedDays: 0, calls: 1 }, o);

    test('runs after the CBBD pull, over the same window, and is in the summary', async () => {
        await HoopsGame.create([stored(1, '2026-11-03T00:30:00Z'), SEASON_END()]);
        stubFetch({ regular: [cbbdGame(1, '2026-11-03T00:30:00Z')] });
        const fill = jest.spyOn(espnTipTimes, 'fillTipTimes').mockResolvedValue(counts({ filled: 2, espnTbd: 1 }));

        const out = await job.run({ now: NOW });

        // From midnight Eastern TODAY (NOW is 07:40 ET on 21 Oct, EDT), so
        // today's TBD placeholders are included.
        expect(fill).toHaveBeenCalledWith({ season: SEASON, start: new Date('2026-10-21T04:00:00Z'), end: new Date(NOW.getTime() + job.LOOKAHEAD_DAYS * DAY_MS) });
        expect(out.failed).toBeNull();
        expect(out.summary).toBe(`${SEASON} regular: 0 new, 1 updated | ${SEASON} ESPN tip times: 2 filled, 0 updated, 0 reverted, 1 still TBD`);
    });

    test('ESPN down is reported, not a failure: no error JobRun, no email', async () => {
        await HoopsGame.create([stored(1, '2026-11-03T00:30:00Z'), SEASON_END()]);
        stubFetch({ regular: [cbbdGame(1, '2026-11-03T00:30:00Z')] });
        jest.spyOn(espnTipTimes, 'fillTipTimes').mockResolvedValue(counts({ espnTbd: 0, notOnEspn: 0, failedDays: 1 }));

        const out = await job.run({ now: NOW });

        expect(out.failed).toBeNull();
        expect(out.summary).toMatch(/ESPN unreachable for 1 of 1 day\(s\)/);
        expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();
    });

    test('a database error in the fill IS a failure', async () => {
        await HoopsGame.create([stored(1, '2026-11-03T00:30:00Z'), SEASON_END()]);
        stubFetch({ regular: [cbbdGame(1, '2026-11-03T00:30:00Z')] });
        jest.spyOn(espnTipTimes, 'fillTipTimes').mockRejectedValue(new Error('find timed out'));

        const out = await job.run({ now: NOW });

        expect(out.failed).toBe('find timed out');
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });

    test('off-season: not called', async () => {
        const fill = jest.spyOn(espnTipTimes, 'fillTipTimes');

        await job.run({ now: NOW });

        expect(fill).not.toHaveBeenCalled();
    });
});
