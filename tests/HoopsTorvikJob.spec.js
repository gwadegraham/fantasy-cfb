// Torvik's current T-Rank, filed week by week for the quadrant blend.
//
// barttorvik.com keeps no history, so these pin the things that would lose
// a week quietly or grade it on the wrong ranking: which week a pull is
// filed under (frozen at the week's FIRST TIP, not at midnight Monday), that
// a re-run replaces rather than mixes, that the draft's preseason numbers
// are never touched, and that every failure is loud.
//
// The fetch is always injected — no test touches barttorvik.com.

const { useMongo } = require('./helpers/mongo');
const job = require('../modules/hoops-torvik-job');
const jobLogger = require('../modules/job-logger');
const jobMailer = require('../modules/job-mailer');
const { ranksFor } = require('../modules/hoops-ranks');
const HoopsTorvikRank = require('../models/hoopsTorvikRank');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const SEASON = 2027;

// The 2026-27 opening, as CBBD lists it: two neutral-site games on Sunday
// 1 November (week 1's lead-in), then the Monday slate.
const SUNDAY_TIP = '2026-11-01T17:00:00Z';
const SATURDAY_NIGHT = new Date('2026-11-01T03:20:00Z');    // Sat 31 Oct, 22:20 Central
const SUNDAY_AFTER_TIP = new Date('2026-11-01T19:00:00Z');
const WEEK2_WEDNESDAY = new Date('2026-11-11T17:00:00Z');

let gameId = 0;
const game = (week, iso, o = {}) => Object.assign({
    id: ++gameId, season: SEASON, week, seasonType: 'regular', startDate: new Date(iso), status: 'scheduled',
    homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B'
}, o);

// Twelve teams in two conferences, with the draft's preseason ranks.
const SCHOOLS = ['Duke', 'Virginia', 'Louisville', 'Clemson', 'Miami', 'Syracuse',
    'Kansas', 'Houston', 'Iowa State', 'Baylor', 'Arizona', 'Texas Tech'];
const TORVIK_NAME = { 'Iowa State': 'Iowa St.', Miami: 'Miami FL' };
const acc = (i) => i < 6;

// Torvik's JSON for an ORDER of schools (best first), with records in it.
const torvikFile = (order) => JSON.stringify(order.map((school, i) => [
    i + 1, TORVIK_NAME[school] || school, acc(SCHOOLS.indexOf(school)) ? 'ACC' : 'B12', '3-1',
    120 - i, 5, 90 + i, 1, Number((0.95 - i * 0.05).toFixed(4)), i + 1, 25 - i, 5 + i, 14, 4, '1-0'
]));
const reply = (body, status = 200) => jest.fn(() => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(body) }));
const REVERSED = [...SCHOOLS].reverse();

beforeEach(async () => {
    gameId = 0;
    await League.create({ code: 'hh', name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
    await HoopsTeam.create(SCHOOLS.map((school, i) => ({
        id: i + 1, season: SEASON, school, conference: acc(i) ? 'ACC' : 'Big 12',
        preseason: { rank: i + 1, barthag: 0.9, source: 'draft import' }
    })));
    await HoopsGame.create([
        game(1, SUNDAY_TIP, { neutralSite: true }),
        game(1, '2026-11-02T23:00:00Z'),
        game(2, '2026-11-09T23:00:00Z'),
        game(2, '2026-11-14T23:00:00Z'),
        game(3, '2026-11-16T23:00:00Z')
    ]);
    jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
    jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('targetWeek — frozen at the week\'s first tip', () => {
    test('Saturday night before a SUNDAY opener is still week 1', async () => {
        // The reason this job does not use the ratings job's "taken in week
        // N, filed under N + 1": Saturday is already in week 1's lead-in, so
        // that rule files this pull under week 2 and week 1 freezes Thursday.
        expect(await job.targetWeek(SEASON, SATURDAY_NIGHT)).toEqual({ week: 1 });
    });

    test('once the first game has tipped, the week is frozen and pulls go to the next', async () => {
        expect(await job.targetWeek(SEASON, SUNDAY_AFTER_TIP)).toEqual({ week: 2 });
    });

    test('long before the season, pulls go to week 1', async () => {
        expect(await job.targetWeek(SEASON, new Date('2026-10-26T12:00:00Z'))).toEqual({ week: 1 });
    });

    test('mid-week, the next week is the one being filled', async () => {
        expect(await job.targetWeek(SEASON, WEEK2_WEDNESDAY)).toEqual({ week: 3 });
    });

    test('a cancelled listing does not freeze a week it never tipped in', async () => {
        await HoopsGame.create(game(1, '2026-10-31T17:00:00Z', { status: 'cancelled' }));
        expect(await job.targetWeek(SEASON, SATURDAY_NIGHT)).toEqual({ week: 1 });
    });

    test('a postponed listing does not freeze a week either, and a game with no week is ignored', async () => {
        await HoopsGame.create([
            game(1, '2026-10-31T17:00:00Z', { status: 'postponed' }),
            game(null, '2026-10-31T18:00:00Z')
        ]);
        expect(await job.targetWeek(SEASON, SATURDAY_NIGHT)).toEqual({ week: 1 });
    });

    test('Sunday night after a week\'s last game, the pull goes to NEXT week, not the one after', async () => {
        // Week 1's games have all tipped; week 2 has not started. Only week
        // 2's own games may freeze week 2.
        expect(await job.targetWeek(SEASON, new Date('2026-11-09T04:20:00Z'))).toEqual({ week: 2 });
    });

    test('a week freezes at its Monday even when none of its games are stored yet', async () => {
        // A game the nightly refresh stores only after it is played (the
        // postseason): Tuesday of week 2, nothing in week 2 on file before
        // now, the next stored game later that week. Without the Monday
        // rule, this pull would rewrite week 2 with that game's result in it.
        await HoopsGame.deleteMany({ week: 2 });
        await HoopsGame.create(game(2, '2026-11-13T23:00:00Z'));
        expect(await job.targetWeek(SEASON, new Date('2026-11-11T03:20:00Z'))).toEqual({ week: 3 });
    });

    test('after the last game there is nothing to rank; with no schedule, it says so', async () => {
        expect(await job.targetWeek(SEASON, new Date('2026-11-20T12:00:00Z'))).toEqual({ skip: 'no game left to tip — nothing to rank' });
        expect(await job.targetWeek(2031, SATURDAY_NIGHT)).toEqual({ skip: 'no schedule ingested' });
    });
});

describe('run', () => {
    test('files the pull under the target week, and the blend reads it', async () => {
        const out = await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(torvikFile(REVERSED)) });
        expect(out.status).toBe('success');
        expect(out.written[0]).toMatch(/^2027 wk1: 12 team\(s\) ranked \(1 Texas Tech, 2 Arizona, 3 Baylor\)/);
        expect(await HoopsTorvikRank.countDocuments({ season: SEASON, week: 1 })).toBe(12);
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', expect.stringContaining('wk1'));

        // Week 1 is graded on the pull, not the preseason import.
        const ranked = await ranksFor(SEASON, 1);
        expect(ranked.source).toBe('torvik');
        expect(ranked.torvikWeek).toBe(1);
        expect(ranked.ranks['12']).toBe(1);
        expect(ranked.ranks['1']).toBe(12);
    });

    test('the draft\'s preseason numbers are never touched', async () => {
        await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(torvikFile(REVERSED)) });
        const duke = await HoopsTeam.findOne({ season: SEASON, school: 'Duke' }).lean();
        expect(duke.preseason).toEqual(expect.objectContaining({ rank: 1, barthag: 0.9, source: 'draft import' }));
    });

    test('a second pull in the same week replaces the first, whole', async () => {
        await job.run({ now: new Date('2026-10-31T11:20:00Z'), fetchImpl: reply(torvikFile(SCHOOLS)) });
        await HoopsTorvikRank.create({ season: SEASON, week: 1, teamId: 99, rank: 13 });
        await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(torvikFile(REVERSED)) });
        const rows = await HoopsTorvikRank.find({ season: SEASON, week: 1 }).lean();
        expect(rows).toHaveLength(12);
        expect(rows.find(r => r.teamId === 12).rank).toBe(1);
    });

    test('a frozen week is never rewritten — the next pull goes to the week after', async () => {
        await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(torvikFile(SCHOOLS)) });
        await job.run({ now: SUNDAY_AFTER_TIP, fetchImpl: reply(torvikFile(REVERSED)) });
        expect((await HoopsTorvikRank.findOne({ season: SEASON, week: 1, teamId: 1 })).rank).toBe(1);
        expect((await HoopsTorvikRank.findOne({ season: SEASON, week: 2, teamId: 1 })).rank).toBe(12);
    });

    test('a pull that fails its checks writes nothing, and is an error AND an email', async () => {
        // A school renamed on Torvik's side: matched to nothing.
        const renamed = JSON.parse(torvikFile(SCHOOLS));
        renamed[3][1] = 'Clemson Tigers';
        const out = await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(JSON.stringify(renamed)) });
        expect(out.status).toBe('error');
        expect(out.failed).toMatch(/failed its checks — wk1 not written: UNMATCHED {2}Clemson Tigers/);
        expect(await HoopsTorvikRank.countDocuments()).toBe(0);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledWith(expect.objectContaining({ label: 'Hoops Torvik', ok: false }));
    });

    test('a long list of problems is cut short in the summary', async () => {
        const junk = JSON.parse(torvikFile(SCHOOLS)).map((r, i) => { r[1] = `Nobody ${i}`; return r; });
        const out = await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(JSON.stringify(junk)) });
        expect(out.failed).toMatch(/… \(\+\d+\)/);
    });

    test('barttorvik walling the JSON is a failure, not a skip', async () => {
        const out = await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply('<!DOCTYPE html><title>Verifying Browser...</title>') });
        expect(out.status).toBe('error');
        expect(out.failed).toMatch(/web page, not data/);
    });

    test('nothing left to rank is a recorded skip, with no fetch and no email', async () => {
        const fetchImpl = reply(torvikFile(SCHOOLS));
        const out = await job.run({ now: new Date('2026-11-20T12:00:00Z'), fetchImpl });
        expect(out.status).toBe('skipped');
        expect(out.skipped).toEqual(['2027: no game left to tip — nothing to rank']);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'skipped', expect.any(String));
        expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();
    });

    test('with no basketball league it is silent', async () => {
        await League.deleteMany({});
        expect(await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply('') })).toEqual({ skippedReason: 'no basketball leagues' });
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    test('a failure before the season loop still mails (#574)', async () => {
        jest.spyOn(League, 'find').mockImplementation(() => { throw new Error('mongo down'); });
        await expect(job.run({ now: SATURDAY_NIGHT, fetchImpl: reply('') })).rejects.toThrow('mongo down');
        expect(jobMailer.sendJobEmail).toHaveBeenCalledWith(expect.objectContaining({ label: 'Hoops Torvik', ok: false }));
    });

    test('a write that fails once is retried, whole', async () => {
        const real = HoopsTorvikRank.bulkWrite.bind(HoopsTorvikRank);
        jest.spyOn(HoopsTorvikRank, 'bulkWrite')
            .mockRejectedValueOnce(new Error('blip'))
            .mockImplementation((...a) => real(...a));
        const out = await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(torvikFile(SCHOOLS)) });
        expect(out.status).toBe('success');
        expect(await HoopsTorvikRank.countDocuments({ season: SEASON, week: 1 })).toBe(12);
    });

    test('a write that fails twice is an error', async () => {
        jest.spyOn(HoopsTorvikRank, 'bulkWrite').mockRejectedValue(new Error('disk full'));
        const out = await job.run({ now: SATURDAY_NIGHT, fetchImpl: reply(torvikFile(SCHOOLS)) });
        expect(out.status).toBe('error');
        expect(out.failed).toMatch(/disk full/);
    });
});
