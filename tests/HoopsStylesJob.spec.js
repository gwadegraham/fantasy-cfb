// The daily style-tags job (#542): modules/hoops-styles-job.js, and the
// reader the pages use (modules/hoops-styles.js).
//
// What it must get right is WHICH leaderboard a season shows, and how many
// billable calls it spends finding out: last season's before tip-off,
// fetched once; this season's once there are enough games; never quietly
// back to last season once this one is showing.
//
// cbbd.cbbdGet is always spied — jest loads the real .env, so an unstubbed
// call would hit CBBD and bill the shared pool.

const { useMongo } = require('./helpers/mongo');
const job = require('../modules/hoops-styles-job');
const { stylesFor, seasonLabel } = require('../modules/hoops-styles');
const cbbd = require('../modules/cbbd-client');
const jobLogger = require('../modules/job-logger');
const jobMailer = require('../modules/job-mailer');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeamStyle = require('../models/hoopsTeamStyle');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const SEASON = 2027;
const PRESEASON = new Date('2026-10-20T12:00:00Z');
const DECEMBER = new Date('2026-12-10T12:00:00Z');

const game = (id, iso) => ({
    id, season: SEASON, week: 1, seasonType: 'regular', startDate: new Date(iso), status: 'scheduled',
    homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B'
});

// A leaderboard row in CBBD's shape. Team 1 plays slowest, team n fastest.
const row = (teamId, season, games, o = {}) => Object.assign({
    season, teamId, team: `T${teamId}`,
    record: { games, wins: Math.floor(games / 2), losses: Math.ceil(games / 2) },
    summary: { pace: 60 + teamId * 0.04 },
    teamStats: { offensiveReboundPct: 30, freeThrowRate: 35 },
    opponentStats: { possessions: 2000, turnovers: { total: 340 } },
    adjustedEfficiency: { rankings: { offense: teamId, defense: 366 - teamId, net: teamId } },
    shotProfile: { atRim: { rate: 39 }, threePointJumper: { rate: 39, pct: 34 }, distribution: { threeRate: 39, midrangeRate: 21 } }
}, o);
const board = (season, games, n = 365, o) => Array.from({ length: n }, (_, i) => row(i + 1, season, games, o));

// Answers by the season asked for, and counts the calls.
function stubCbbd(bySeason) {
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path, { season }) => {
        if (path !== job.PATH) throw new Error(`unexpected CBBD path ${path}`);
        const data = bySeason[season];
        if (data instanceof Error) throw data;
        return { data: data || [], remainingCalls: 29000 };
    });
}

beforeEach(async () => {
    await League.create({ code: 'hh', name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'preseason' }]);
    await seasons.prime();
    await HoopsGame.create([game(1, '2026-11-03T00:00:00Z'), game(2, '2027-04-06T00:00:00Z')]);
    jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
    jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

describe('preseason: last season\'s leaderboard', () => {
    test('before tip-off, the season is tagged from LAST season, and this season is not even asked for', async () => {
        const get = stubCbbd({ 2026: board(2026, 33) });
        const out = await job.run({ now: PRESEASON });

        expect(out.status).toBe('success');
        expect(get.mock.calls.map(c => c[1].season)).toEqual([2026]);
        expect(await HoopsTeamStyle.countDocuments({ season: SEASON, fromSeason: 2026 })).toBe(365);
        expect(out.written[0]).toMatch(/LAST season's 2026 leaderboard/);
    });

    test('...and only once: the next run spends nothing', async () => {
        const get = stubCbbd({ 2026: board(2026, 33) });
        await job.run({ now: PRESEASON });
        const out = await job.run({ now: new Date('2026-10-21T12:00:00Z') });

        expect(get).toHaveBeenCalledTimes(1);
        expect(out.status).toBe('skipped');
        expect(out.skipped[0]).toMatch(/2026 tags already on file, not fetched/);
    });

    test('the pages read it as last season, and say which', async () => {
        stubCbbd({ 2026: board(2026, 33) });
        await job.run({ now: PRESEASON });
        const s = await stylesFor(SEASON, [1, 365]);

        expect(s.source).toEqual({ fromSeason: 2026, label: '2025–26', lastSeason: true });
        expect(s.byTeam['1'].map(t => t.label)).toContain('Slow pace');
        expect(s.byTeam['365'].map(t => t.label)).toContain('Fast pace');
    });

    test('an unusable last-season leaderboard is a failure, emailed, nothing written', async () => {
        stubCbbd({ 2026: board(2026, 33, 120) });
        const out = await job.run({ now: PRESEASON });

        expect(out.status).toBe('error');
        expect(out.failed).toMatch(/only 120 team\(s\)/);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
        expect(await HoopsTeamStyle.countDocuments()).toBe(0);
    });
});

describe('in season: this season\'s leaderboard, once it has games', () => {
    test(`too few games: still last season's tags (2 calls the first time, then 1 a day)`, async () => {
        const get = stubCbbd({ 2027: board(2027, job.MIN_GAMES - 1), 2026: board(2026, 33) });
        const out = await job.run({ now: DECEMBER });

        expect(get.mock.calls.map(c => c[1].season)).toEqual([2027, 2026]);
        expect(out.written[0]).toMatch(/median team has played 5 game\(s\), tags wait for 6/);
        expect(await HoopsTeamStyle.countDocuments({ season: SEASON, fromSeason: 2026 })).toBe(365);

        await job.run({ now: DECEMBER });
        expect(get).toHaveBeenCalledTimes(3);
    });

    test(`${job.MIN_GAMES} games and adjusted ranks: this season's tags replace last season's`, async () => {
        stubCbbd({ 2026: board(2026, 33) });
        await job.run({ now: PRESEASON });
        jest.restoreAllMocks();
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-2');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const get = stubCbbd({ 2027: board(2027, job.MIN_GAMES) });

        const out = await job.run({ now: DECEMBER });
        expect(get.mock.calls.map(c => c[1].season)).toEqual([2027]);
        expect(out.written[0]).toMatch(/from the 2027 leaderboard/);
        expect(await HoopsTeamStyle.countDocuments({ season: SEASON, fromSeason: 2027 })).toBe(365);
        expect(await HoopsTeamStyle.countDocuments({ season: SEASON, fromSeason: 2026 })).toBe(0);
        expect((await stylesFor(SEASON)).source.lastSeason).toBe(false);
    });

    test('games but no adjusted ranks yet: waits, rather than tagging without the Elite tags', async () => {
        const noRanks = board(2027, 10).map(r => ({ ...r, adjustedEfficiency: null }));
        stubCbbd({ 2027: noRanks, 2026: board(2026, 33) });
        const out = await job.run({ now: DECEMBER });

        expect(out.written[0]).toMatch(/adjusted ranks on only 0 of 365/);
        expect(await HoopsTeamStyle.countDocuments({ season: SEASON, fromSeason: 2026 })).toBe(365);
    });

    test('once this season is showing, a thin leaderboard is an ERROR and the tags are kept — never a quiet swap back', async () => {
        stubCbbd({ 2027: board(2027, 10) });
        await job.run({ now: DECEMBER });
        jest.restoreAllMocks();
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-2');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        const get = stubCbbd({ 2027: [], 2026: board(2026, 33) });

        const out = await job.run({ now: new Date('2026-12-11T12:00:00Z') });
        expect(out.status).toBe('error');
        expect(out.failed).toMatch(/2027 leaderboard is in use, but today only 0 team\(s\).*stored tags kept/);
        expect(get.mock.calls.map(c => c[1].season)).toEqual([2027]);
        expect(await HoopsTeamStyle.countDocuments({ season: SEASON, fromSeason: 2027 })).toBe(365);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });

    test('a re-run replaces the season wholesale: a team gone from the leaderboard loses its row', async () => {
        stubCbbd({ 2027: board(2027, 10, 365) });
        await job.run({ now: DECEMBER });
        jest.restoreAllMocks();
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-2');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        stubCbbd({ 2027: board(2027, 11, 364) });

        await job.run({ now: new Date('2026-12-11T12:00:00Z') });
        expect(await HoopsTeamStyle.countDocuments({ season: SEASON })).toBe(364);
        expect(await HoopsTeamStyle.exists({ season: SEASON, teamId: 365 })).toBeNull();
    });

    test('after the final, a stored final leaderboard is not refetched', async () => {
        stubCbbd({ 2027: board(2027, 33) });
        await job.run({ now: new Date('2027-04-20T12:00:00Z') });
        jest.restoreAllMocks();
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-2');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const get = stubCbbd({ 2027: board(2027, 33) });

        const out = await job.run({ now: new Date('2027-05-01T12:00:00Z') });
        expect(get).not.toHaveBeenCalled();
        expect(out.skipped[0]).toMatch(/final leaderboard is on file/);
    });
});

describe('failures and the quiet cases', () => {
    test('no basketball league: silent, no call, no JobRun', async () => {
        await League.deleteMany({});
        const get = stubCbbd({});
        const out = await job.run({ now: PRESEASON });
        expect(out).toEqual({ skippedReason: 'no basketball leagues' });
        expect(get).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    test('rows with no team id are a shape change, not an empty leaderboard', async () => {
        stubCbbd({ 2026: board(2026, 33).map(({ teamId, ...r }) => r) });
        const out = await job.run({ now: PRESEASON });
        expect(out.failed).toMatch(/no teamId — the response shape changed/);
    });

    test('CBBD down: an error JobRun and an email', async () => {
        stubCbbd({ 2026: Object.assign(new Error('Could not reach CBBD: ECONNRESET'), { unreachable: true }) });
        const out = await job.run({ now: PRESEASON });
        expect(out.status).toBe('error');
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', expect.stringMatching(/ECONNRESET/));
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });

    test('a failed write is retried once, and a second failure is loud', async () => {
        stubCbbd({ 2026: board(2026, 33) });
        const real = HoopsTeamStyle.bulkWrite.bind(HoopsTeamStyle);
        const write = jest.spyOn(HoopsTeamStyle, 'bulkWrite')
            .mockRejectedValueOnce(new Error('write conflict'))
            .mockImplementation((...a) => real(...a));
        const out = await job.run({ now: PRESEASON });
        expect(write).toHaveBeenCalledTimes(2);
        expect(out.status).toBe('success');

        await HoopsTeamStyle.deleteMany({});
        write.mockReset().mockRejectedValue(new Error('still down'));
        const again = await job.run({ now: PRESEASON });
        expect(again.failed).toMatch(/still down/);
    });

    test('a stored row is slim: numbers and tags, not the leaderboard row', async () => {
        stubCbbd({ 2026: board(2026, 33) });
        await job.run({ now: PRESEASON });
        const doc = await HoopsTeamStyle.findOne({ season: SEASON, teamId: 1 }).lean();
        expect(doc).not.toHaveProperty('shotProfile');
        expect(doc).not.toHaveProperty('teamStats');
        expect(doc).toMatchObject({ fromSeason: 2026, games: 33, defRank: 365 });
    });
});

describe('the reader', () => {
    test('nothing stored: no source, no tags', async () => {
        expect(await stylesFor(SEASON)).toEqual({ source: null, byTeam: {} });
    });

    test('season labels are CBBD\'s ending year', () => {
        expect(seasonLabel(2026)).toBe('2025–26');
        expect(seasonLabel(2100)).toBe('2099–00');
        expect(seasonLabel(null)).toBeNull();
    });
});
