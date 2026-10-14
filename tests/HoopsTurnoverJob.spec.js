// The roster-turnover job (#541): modules/hoops-turnover-job.js.
//
// What it must get right is how often it spends its two billable calls
// (weekly before tip-off, once after, then never), which CBBD year it asks
// for, and refusing a response that would quietly zero the board.
//
// cbbd.cbbdGet is always spied — jest loads the real .env, so an unstubbed
// call would hit CBBD and bill the shared pool.

const { useMongo } = require('./helpers/mongo');
const job = require('../modules/hoops-turnover-job');
const cbbd = require('../modules/cbbd-client');
const jobLogger = require('../modules/job-logger');
const jobMailer = require('../modules/job-mailer');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const HoopsTeamTurnover = require('../models/hoopsTeamTurnover');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const SEASON = 2027;
const N = 365;
const DAY = 86400000;
const TIP = new Date('2026-11-03T00:00:00Z');
const OCT = new Date('2026-10-14T12:00:00Z');

const game = (id, at) => ({
    id, season: SEASON, week: 1, seasonType: 'regular', startDate: at, status: 'scheduled',
    homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B'
});

// A portal of `n` moves, team i -> team i+1, all between our teams.
const portal = (n = 1500, idOf = (i) => i) => Array.from({ length: n }, (_, k) => {
    const i = (k % (N - 1)) + 1;
    return { id: k + 1, sourceId: `s${k}`, year: 2026, firstName: `F${k}`, lastName: 'L', position: 'G', stars: 3, rating: 0.85, eligibility: 'Immediate',
        origin: { id: idOf(i), name: `T${i}` }, destination: { id: idOf(i + 1), name: `T${i + 1}` } };
});
const classes = (n = 147) => Array.from({ length: n }, (_, k) => ({ teamId: k + 1, team: `T${k + 1}`, year: 2026, ranking: k + 1, rating: 70 - k / 3 }));

// Answers by path and year, and records every call.
function stubCbbd({ p = portal(), c = classes() } = {}) {
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path, { year }) => {
        if (year !== 2026) return { data: [], remainingCalls: 1 };
        if (path === job.PORTAL_PATH) { if (p instanceof Error) throw p; return { data: p, remainingCalls: 1 }; }
        if (path === job.CLASS_PATH) return { data: c, remainingCalls: 1 };
        throw new Error(`unexpected CBBD path ${path}`);
    });
}

beforeEach(async () => {
    await League.create({ code: 'hh', name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'preseason' }]);
    await seasons.prime();
    await HoopsTeam.create(Array.from({ length: N }, (_, k) => ({ id: k + 1, season: SEASON, school: `T${k + 1}` })));
    await HoopsGame.create([game(1, TIP), game(2, new Date('2027-04-06T00:00:00Z'))]);
    jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
    jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { seasons._reset(); jest.restoreAllMocks(); });

const at = (t, ms) => new Date(t.getTime() + ms);

describe('what it fetches', () => {
    test('asks CBBD for year SEASON - 1, both endpoints, and stores every team', async () => {
        const get = stubCbbd();
        const out = await job.run({ now: OCT });
        expect(out.status).toBe('success');
        expect(get.mock.calls.map(c => [c[0], c[1].year]).sort()).toEqual([[job.PORTAL_PATH, 2026], [job.CLASS_PATH, 2026]]);
        expect(await HoopsTeamTurnover.countDocuments({ season: SEASON, fromYear: 2026 })).toBe(N);
        const t5 = await HoopsTeamTurnover.findOne({ season: SEASON, teamId: 5 }).lean();
        expect(t5.classRank).toBe(5);
        expect(t5.in.count).toBeGreaterThan(0);
        expect(out.written[0]).toMatch(/CBBD 2026 — 1500 portal move\(s\), 100% matched; 147 ranked class/);
    });

    test('a re-fetch replaces the season wholesale', async () => {
        await HoopsTeamTurnover.create({ season: SEASON, teamId: 9999, fromYear: 2026, fetchedAt: OCT,
            in: { count: 1, topStars: 0 }, out: { count: 0, topStars: 0 } });
        stubCbbd();
        await job.run({ now: OCT });
        expect(await HoopsTeamTurnover.countDocuments({ season: SEASON, teamId: 9999 })).toBe(0);
    });

    test('no basketball league: silent, no calls, no JobRun', async () => {
        await League.deleteMany({});
        await seasons.prime();
        const get = stubCbbd();
        expect(await job.run({ now: OCT })).toEqual({ skippedReason: 'no basketball leagues' });
        expect(get).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    test('no teams ingested yet: skipped without spending a call', async () => {
        await HoopsTeam.deleteMany({});
        const get = stubCbbd();
        const out = await job.run({ now: OCT });
        expect(out.status).toBe('skipped');
        expect(get).not.toHaveBeenCalled();
    });
});

describe('cadence', () => {
    test('before tip-off: fetched again only once the stored copy is a week old', async () => {
        const get = stubCbbd();
        await job.run({ now: OCT });
        expect(get).toHaveBeenCalledTimes(2);

        const six = await job.run({ now: at(OCT, 6 * DAY) });
        expect(six.status).toBe('skipped');
        expect(six.skipped[0]).toMatch(/fetched 6 day\(s\) ago/);
        expect(get).toHaveBeenCalledTimes(2);

        await job.run({ now: at(OCT, 7 * DAY) });
        expect(get).toHaveBeenCalledTimes(4);
    });

    test('with no schedule ingested, it is treated as preseason (weekly)', async () => {
        await HoopsGame.deleteMany({});
        const get = stubCbbd();
        await job.run({ now: OCT });
        await job.run({ now: at(OCT, DAY) });
        expect(get).toHaveBeenCalledTimes(2);
    });

    test('after tip-off: one last fetch if the stored copy predates it, then frozen', async () => {
        const get = stubCbbd();
        await job.run({ now: at(TIP, -2 * DAY) });
        expect(get).toHaveBeenCalledTimes(2);

        // Inside the preseason week, but tip-off has passed: refetched.
        await job.run({ now: at(TIP, DAY) });
        expect(get).toHaveBeenCalledTimes(4);

        // Weeks later: never again.
        const later = await job.run({ now: at(TIP, 30 * DAY) });
        expect(later.skipped[0]).toMatch(/frozen/);
        expect(get).toHaveBeenCalledTimes(4);
    });

    test('a partial season on file is not "on file": refetched the next day', async () => {
        await HoopsTeamTurnover.create({ season: SEASON, teamId: 1, fromYear: 2026, fetchedAt: OCT,
            in: { count: 1, topStars: 0 }, out: { count: 0, topStars: 0 } });
        const get = stubCbbd();
        await job.run({ now: at(OCT, DAY) });
        expect(get).toHaveBeenCalledTimes(2);
    });

    // QA on #550: a fixed 300-row floor was never met by a season with fewer
    // teams on file, so the job refetched every day and called it success.
    test('a season with few teams is "on file" once every team has a row', async () => {
        await HoopsTeam.deleteMany({ id: { $gt: 250 } });
        // Moves among the 250 left, or the match-rate guard refuses them.
        const get = stubCbbd({ p: portal(1500, (i) => ((i - 1) % 250) + 1) });
        await job.run({ now: OCT });
        expect(await HoopsTeamTurnover.countDocuments({ season: SEASON })).toBe(250);
        const next = await job.run({ now: at(OCT, DAY) });
        expect(next.status).toBe('skipped');
        expect(get).toHaveBeenCalledTimes(2);
    });

    test('rows from the wrong CBBD year are not "on file"', async () => {
        await HoopsTeamTurnover.insertMany(Array.from({ length: N }, (_, k) => ({
            season: SEASON, teamId: k + 1, fromYear: 2027, fetchedAt: OCT,
            in: { count: 0, topStars: 0 }, out: { count: 0, topStars: 0 }
        })));
        const get = stubCbbd();
        await job.run({ now: at(OCT, DAY) });
        expect(get).toHaveBeenCalledTimes(2);
        expect(await HoopsTeamTurnover.countDocuments({ season: SEASON, fromYear: 2026 })).toBe(N);
    });
});

describe('refusing a response that would zero the board', () => {
    async function seeded() {
        stubCbbd();
        await job.run({ now: OCT });
        jest.restoreAllMocks();
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-2');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    }
    const LATER = at(OCT, 8 * DAY);
    const unchanged = async () => {
        const t5 = await HoopsTeamTurnover.findOne({ season: SEASON, teamId: 5 }).lean();
        expect(t5.fetchedAt).toEqual(OCT);
        expect(t5.classRank).toBe(5);
    };

    test('a short portal list fails, keeps what is stored, and is mailed', async () => {
        await seeded();
        stubCbbd({ p: portal(job.MIN_PORTAL - 1) });
        const out = await job.run({ now: LATER });
        expect(out.status).toBe('error');
        expect(out.failed).toMatch(/499 portal row\(s\) for 2026/);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
        await unchanged();
    });

    test('team ids that no longer match ours fail', async () => {
        await seeded();
        stubCbbd({ p: portal(1500, (i) => i + 100000) });
        const out = await job.run({ now: LATER });
        expect(out.failed).toMatch(/only 0 of 1500 2026 portal move\(s\) match/);
        await unchanged();
    });

    test('just under the match threshold fails; at it, it writes', async () => {
        // 1500 moves; the first k touch none of our teams.
        const mixed = (k) => portal(1500).map((r, i) => i < k
            ? Object.assign({}, r, { origin: { id: 50000 + i, name: 'D2' }, destination: { id: 60000 + i, name: 'D2' } })
            : r);
        stubCbbd({ p: mixed(151) });
        expect((await job.run({ now: OCT })).status).toBe('error');
        jest.restoreAllMocks();
        jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-3');
        jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        stubCbbd({ p: mixed(150) });
        expect((await job.run({ now: OCT })).status).toBe('success');
    });

    // The overall share counts a move if EITHER end is ours, so a
    // destination-only id change would pass it with every team at +0 in.
    test('destination ids that no longer match ours fail, even with origins intact', async () => {
        await seeded();
        stubCbbd({ p: portal(1500).map(r => Object.assign({}, r, { destination: { id: r.destination.id + 100000, name: 'X' } })) });
        const out = await job.run({ now: LATER });
        expect(out.failed).toMatch(/only 0 of 1500 2026 portal move\(s\) land on a 2027 team id/);
        await unchanged();
    });

    test('too few ranked classes fail', async () => {
        await seeded();
        stubCbbd({ c: classes(job.MIN_CLASSES - 1) });
        const out = await job.run({ now: LATER });
        expect(out.failed).toMatch(/only 49 2026 recruiting class/);
        await unchanged();
    });

    test('a CBBD error fails the season and is mailed', async () => {
        stubCbbd({ p: new Error('CBBD /recruiting/portal 500') });
        const out = await job.run({ now: OCT });
        expect(out.status).toBe('error');
        expect(jobMailer.sendJobEmail).toHaveBeenCalled();
        expect(await HoopsTeamTurnover.countDocuments({})).toBe(0);
    });

    test('a failed write is retried once', async () => {
        stubCbbd();
        const real = HoopsTeamTurnover.bulkWrite.bind(HoopsTeamTurnover);
        const bw = jest.spyOn(HoopsTeamTurnover, 'bulkWrite')
            .mockImplementationOnce(async () => { throw new Error('Atlas blip'); })
            .mockImplementation(real);
        const out = await job.run({ now: OCT });
        expect(out.status).toBe('success');
        expect(bw).toHaveBeenCalledTimes(2);
        expect(await HoopsTeamTurnover.countDocuments({ season: SEASON })).toBe(N);
    });
});
