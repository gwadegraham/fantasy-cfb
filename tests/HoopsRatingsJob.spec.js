// The weekly ratings snapshot that feeds basketball quadrants (#318).
//
// CBBD keeps no ratings history, so a snapshot this job fails to take is
// gone for good. These tests pin the three things that would lose one
// quietly: which week a snapshot is written to, that a re-run replaces
// rather than duplicates, and that every failure is loud.
//
// cbbd.cbbdGet is always spied — jest loads the real .env, so an unstubbed
// call would hit CBBD and bill the shared pool.

const { useMongo } = require('./helpers/mongo');
const job = require('../modules/hoops-ratings-job');
const cbbd = require('../modules/cbbd-client');
const jobLogger = require('../modules/job-logger');
const jobMailer = require('../modules/job-mailer');
const { ranksFor } = require('../modules/hoops-ranks');
const HoopsRating = require('../models/hoopsRating');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const SEASON = 2027;
// Week 1 is Monday 2 Nov 2026. Thursday 10 Dec is in week 6.
const WEEK6_THURSDAY = new Date('2026-12-10T17:00:00Z');

const game = (id, iso) => ({
    id, season: SEASON, week: 1, seasonType: 'regular', startDate: new Date(iso), status: 'scheduled',
    homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B'
});

// CBBD's /ratings/adjusted row, as served for the 2026 final snapshot.
const row = (teamId, netRating, o = {}) => Object.assign({
    season: SEASON, teamId, team: `T${teamId}`, conference: 'X',
    offensiveRating: 110 + netRating / 2, defensiveRating: 110 - netRating / 2, netRating,
    rankings: { offense: 1, defense: 1, net: 1 }
}, o);

function stubCbbd(data) {
    return jest.spyOn(cbbd, 'cbbdGet').mockResolvedValue({ data, remainingCalls: 29000 });
}

beforeEach(async () => {
    await League.create({ code: 'hh', name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
    await HoopsGame.create([game(1, '2026-11-03T00:00:00Z'), game(2, '2027-03-01T00:00:00Z')]);
    jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
    jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('rankRatings', () => {
    test('ranks 1..N by net rating, not by CBBD\'s own tied rank', () => {
        // CBBD hands two teams rankings.net 1 — a tie the quadrant bands
        // cannot hold. Ours is dense and comes from netRating.
        const out = job.rankRatings([
            row(5, 10, { rankings: { net: 1 } }),
            row(7, 30, { rankings: { net: 1 } }),
            row(6, 20)
        ]);
        expect(out.map(r => [r.teamId, r.rank])).toEqual([[7, 1], [6, 2], [5, 3]]);
    });

    test('a tie on net is broken by team id, the same way every run', () => {
        const a = job.rankRatings([row(9, 15), row(3, 15)]);
        const b = job.rankRatings([row(3, 15), row(9, 15)]);
        expect(a.map(r => r.teamId)).toEqual([3, 9]);
        expect(b.map(r => r.teamId)).toEqual([3, 9]);
    });

    test('a team with no net rating is dropped, never ranked as zero', () => {
        // Number(null) is 0: read naively, an unrated team would rank between
        // the positive and negative teams instead of falling back to preseason.
        const out = job.rankRatings([row(1, 5), row(2, -5), row(3, null), row(4, ''), row(null, 12), null]);
        expect(out.map(r => r.teamId)).toEqual([1, 2]);
    });

    test('keeps the net, offensive and defensive ratings', () => {
        const [r] = job.rankRatings([row(1, 41.9, { offensiveRating: 130.6, defensiveRating: 88.8 })]);
        expect(r).toEqual({ teamId: 1, rank: 1, adjEM: 41.9, adjOff: 130.6, adjDef: 88.8 });
    });

    test('a missing off/def rating is stored as nothing, not zero', () => {
        const [r] = job.rankRatings([row(1, 3, { offensiveRating: null, defensiveRating: undefined })]);
        expect(r.adjOff).toBeNull();
        expect(r.adjDef).toBeNull();
    });
});

describe('targetWeek — the week a snapshot is graded against', () => {
    test('a snapshot taken during week N is written to week N + 1', async () => {
        expect(await job.targetWeek(SEASON, WEEK6_THURSDAY)).toEqual({ week: 7, during: 6 });
    });

    test('Sunday 23:15 Eastern is still week N; 00:15 Monday is the next one', async () => {
        // The scheduler's late run is 22:15 Central = 23:15 Eastern. If it
        // crossed midnight Eastern the week's final snapshot would be
        // written one week too far, and that week would grade on stale ranks.
        expect((await job.targetWeek(SEASON, new Date('2026-12-14T04:15:00Z'))).week).toBe(7);
        expect((await job.targetWeek(SEASON, new Date('2026-12-14T05:15:00Z'))).week).toBe(8);
    });

    test('no schedule, the preseason and the off-season are skips', async () => {
        expect(await job.targetWeek(2031, WEEK6_THURSDAY)).toEqual({ skip: 'no schedule ingested' });
        expect((await job.targetWeek(SEASON, new Date('2026-10-20T12:00:00Z'))).skip).toMatch(/preseason/);
        expect((await job.targetWeek(SEASON, new Date('2027-06-01T12:00:00Z'))).skip).toMatch(/season over/);
    });
});

describe('run', () => {
    test('one call, written to next week, readable by ranksFor', async () => {
        const get = stubCbbd([row(10, 5), row(11, 25), row(12, -3)]);
        const out = await job.run({ now: WEEK6_THURSDAY });

        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('/ratings/adjusted', { season: SEASON });
        const rows = await HoopsRating.find({}, { _id: 0, __v: 0 }).sort({ rank: 1 }).lean();
        expect(rows.map(r => [r.week, r.teamId, r.rank, r.source])).toEqual([
            [7, 11, 1, 'cbbd-adjusted'], [7, 10, 2, 'cbbd-adjusted'], [7, 12, 3, 'cbbd-adjusted']
        ]);
        expect(rows[0]).toMatchObject({ season: SEASON, adjEM: 25, adjOff: 122.5, adjDef: 97.5 });
        expect(rows[0].fetchedAt).toEqual(WEEK6_THURSDAY);

        expect(out.status).toBe('success');
        expect(out.summary).toMatch(/^2027 wk7: 3 team\(s\) ranked \(snapshot taken in wk6\)/);
        expect(jobLogger.startRun).toHaveBeenCalledWith('hoops-ratings');
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', out.summary);
        expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();

        // The reader sees it: week 7 is past nothing — ranksFor with no
        // preseason ranks serves the live ones as stored.
        const ranked = await ranksFor(SEASON, 7);
        expect(ranked.source).toBe('cbbd-adjusted');
        expect(ranked.ranks).toEqual({ 11: 1, 10: 2, 12: 3 });
    });

    test('a re-run in the same week overwrites — no duplicates, no leftover teams', async () => {
        stubCbbd([row(10, 5), row(11, 25), row(12, -3)]);
        await job.run({ now: WEEK6_THURSDAY });
        // Earlier weeks are history and must not be touched.
        await HoopsRating.create({ season: SEASON, week: 6, teamId: 99, rank: 1, source: 'cbbd-adjusted' });

        cbbd.cbbdGet.mockResolvedValue({ data: [row(10, 30), row(11, 1)] });
        await job.run({ now: new Date('2026-12-13T20:00:00Z') });   // Sunday, still week 6

        const wk7 = await HoopsRating.find({ season: SEASON, week: 7 }).sort({ rank: 1 }).lean();
        expect(wk7.map(r => [r.teamId, r.rank, r.adjEM])).toEqual([[10, 1, 30], [11, 2, 1]]);
        expect(await HoopsRating.countDocuments({ season: SEASON, week: 6 })).toBe(1);
    });

    test('CBBD has no ratings yet: nothing written, a skip that says so, preseason ranks stand', async () => {
        const get = stubCbbd([]);
        const out = await job.run({ now: WEEK6_THURSDAY });

        expect(get).toHaveBeenCalledTimes(1);
        expect(await HoopsRating.countDocuments()).toBe(0);
        expect(out.status).toBe('skipped');
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'skipped',
            expect.stringMatching(/^2027: CBBD has no ratings for 2027 yet — wk7 stays on preseason ranks/));
        expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();
        expect((await ranksFor(SEASON, 7)).source).toBe('torvik');
    });

    test('before the season and after it: a skip row, and no call', async () => {
        const get = stubCbbd([row(1, 1)]);
        for (const now of [new Date('2026-10-20T12:00:00Z'), new Date('2027-06-01T12:00:00Z')]) {
            const out = await job.run({ now });
            expect(out.status).toBe('skipped');
            expect(jobLogger.finishRun).toHaveBeenLastCalledWith('run-1', 'skipped', out.summary);
        }
        expect(get).not.toHaveBeenCalled();
        expect(await HoopsRating.countDocuments()).toBe(0);
    });

    test('no basketball league: silent — no call, no JobRun', async () => {
        await League.deleteMany({});
        await seasons.prime();
        const get = stubCbbd([row(1, 1)]);
        expect(await job.run({ now: WEEK6_THURSDAY })).toEqual({ skippedReason: 'no basketball leagues' });
        expect(get).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    test('a failed call is an error row AND an email, and writes nothing', async () => {
        jest.spyOn(cbbd, 'cbbdGet').mockRejectedValue(new Error('CBBD /ratings/adjusted 503: down'));
        const out = await job.run({ now: WEEK6_THURSDAY });

        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/^2027: FAILED CBBD \/ratings\/adjusted 503: down/);
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', out.summary);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
        expect(jobMailer.sendJobEmail.mock.calls[0][0]).toMatchObject({ label: 'Hoops Ratings', ok: false });
        expect(jobMailer.sendJobEmail.mock.calls[0][0].error).toMatch(/503: down/);
        expect(await HoopsRating.countDocuments()).toBe(0);
    });

    test('a failed write is an error too, not a success', async () => {
        stubCbbd([row(1, 1)]);
        jest.spyOn(HoopsRating, 'bulkWrite').mockRejectedValue(new Error('write conflict'));
        const out = await job.run({ now: WEEK6_THURSDAY });
        expect(out.status).toBe('error');
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });

    test('rows with nothing rankable are a shape change — an error, not the cold start', async () => {
        // Read as "0 teams" this would skip quietly every week for the rest
        // of the season, and every week it skipped is unrecoverable.
        stubCbbd([{ team: 'Michigan', net: 41.9 }]);
        const out = await job.run({ now: WEEK6_THURSDAY });
        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/response shape changed/);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
        expect(await HoopsRating.countDocuments()).toBe(0);
    });
});

describe('a snapshot that is not whole (QA on #318)', () => {
    // Ten teams with preseason ranks: ranksFor believes a week from 8 up.
    const field = () => HoopsTeam.create(Array.from({ length: 10 }, (_, i) =>
        ({ id: i + 1, season: SEASON, school: `S${i + 1}`, preseason: { rank: i + 1 } })));
    const all = () => Array.from({ length: 10 }, (_, i) => row(i + 1, 50 - i));
    // Week 9 is past the blend ramp, so it is graded on the live ranks alone.
    const WEEK8_THURSDAY = new Date('2026-12-24T17:00:00Z');

    test('a thin snapshot never replaces a whole week — the week is kept and the run is an error', async () => {
        await field();
        stubCbbd(all());
        await job.run({ now: WEEK8_THURSDAY });
        expect(await HoopsRating.countDocuments({ season: SEASON, week: 9 })).toBe(10);

        // Sunday night: half the field back. Replacing the week with it would
        // send week 9 to Torvik — ranksFor ignores a thin week outright.
        cbbd.cbbdGet.mockResolvedValue({ data: all().slice(0, 5) });
        const out = await job.run({ now: new Date('2026-12-27T20:00:00Z') });

        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/only 5 team\(s\).*under the 8.*wk9's 10 stored team\(s\) kept/);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
        expect(await HoopsRating.countDocuments({ season: SEASON, week: 9 })).toBe(10);
        expect((await ranksFor(SEASON, 9)).source).toBe('cbbd-adjusted');
    });

    test('a thin snapshot with nothing whole stored is still written — and still an error', async () => {
        await field();
        stubCbbd(all().slice(0, 5));
        const out = await job.run({ now: WEEK8_THURSDAY });
        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/written to wk9 anyway/);
        expect(await HoopsRating.countDocuments({ season: SEASON, week: 9 })).toBe(5);
    });

    test('rows dropped as unrankable count against the floor, and are reported', async () => {
        await field();
        stubCbbd(all().map((r, i) => (i < 3 ? Object.assign(r, { netRating: null }) : r)));
        const out = await job.run({ now: WEEK8_THURSDAY });
        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/only 7 team\(s\).*3 unrankable row\(s\) dropped/);
    });

    test('a whole snapshot with a few unrankable rows is a success that says so', async () => {
        await field();
        stubCbbd([...all(), row(77, null)]);
        const out = await job.run({ now: WEEK8_THURSDAY });
        expect(out.status).toBe('success');
        expect(out.summary).toMatch(/^2027 wk9: 10 team\(s\) ranked, 1 unrankable row\(s\) dropped/);
    });

    test('CBBD going back to [] after the season was rated is an error, not the cold start', async () => {
        await HoopsRating.create({ season: SEASON, week: 6, teamId: 1, rank: 1, source: 'cbbd-adjusted' });
        stubCbbd([]);
        const out = await job.run({ now: WEEK6_THURSDAY });
        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/earlier weeks were rated — wk7 not written/);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    });

    test('a write that fails once is retried and lands whole', async () => {
        stubCbbd([row(1, 3), row(2, 1)]);
        const real = HoopsRating.bulkWrite.bind(HoopsRating);
        jest.spyOn(HoopsRating, 'bulkWrite')
            .mockRejectedValueOnce(new Error('write conflict'))
            .mockImplementation((...a) => real(...a));
        const out = await job.run({ now: WEEK6_THURSDAY });
        expect(out.status).toBe('success');
        expect(HoopsRating.bulkWrite).toHaveBeenCalledTimes(2);
        expect(await HoopsRating.countDocuments({ season: SEASON, week: 7 })).toBe(2);
    });
});
