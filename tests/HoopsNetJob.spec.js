// The daily official-NET snapshot that drives basketball quadrants once it
// publishes (#533).
//
// ncaa.com keeps no NET history, so a day this job fails to take is gone for
// good. These tests pin what would lose one quietly: which week a snapshot
// is filed under, that a re-run replaces, that the cold start writes nothing,
// and that every failure — a fetch, a layout change, a row count, a stale
// stamp, an unmatched name — is an error row AND an email.
//
// The fetch is ALWAYS injected (fetchImpl): no test reaches ncaa.com. The
// page is a synthetic fixture in its shape.

const { useMongo } = require('./helpers/mongo');
const job = require('../modules/hoops-net-job');
const net = require('../modules/hoops-net');
const jobLogger = require('../modules/job-logger');
const jobMailer = require('../modules/job-mailer');
const { ranksFor } = require('../modules/hoops-ranks');
const HoopsNetRank = require('../models/hoopsNetRank');
const HoopsRating = require('../models/hoopsRating');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');
const { netPage, netRow } = require('./fixtures/ncaa-net-page');

useMongo();

const SEASON = 2027;
// Week 1 is Monday 2 Nov 2026. Thursday 10 Dec is in week 6.
const WEEK6_THURSDAY = new Date('2026-12-10T17:00:00Z');

const game = (id, iso, o = {}) => Object.assign({
    id, season: SEASON, week: 1, seasonType: 'regular', startDate: new Date(iso), status: 'scheduled',
    homeTeamId: 1, homeTeam: 'A', awayTeamId: 2, awayTeam: 'B'
}, o);

// Six teams on file, each with a preseason rank, so ranksFor's coverage
// floor is ceil(6 * 0.8) = 5.
const TEAMS = [
    { id: 101, school: 'Iowa State', conference: 'Big 12' },
    { id: 102, school: 'Kansas', conference: 'Big 12' },
    { id: 103, school: 'Mississippi Valley State', conference: 'SWAC' },
    { id: 104, school: 'Alcorn State', conference: 'SWAC' },
    { id: 105, school: 'Florida Atlantic', conference: 'American' },
    { id: 106, school: 'Memphis', conference: 'American' }
];
// NCAA's spellings of the same six, in NET order.
const ROWS = [
    netRow(1, 'Iowa St.', 'Big 12', { Record: '9-0', 'Quad 1': '3-0' }),
    netRow(2, 'Memphis', 'American'),
    netRow(3, 'Kansas', 'Big 12'),
    netRow(4, 'Fla. Atlantic', 'American'),
    netRow(5, 'Alcorn', 'SWAC'),
    netRow(6, 'Mississippi Val.', 'SWAC', { Record: '0-9' })
];

const page = (html, status = 200) => jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => html });

beforeEach(async () => {
    await League.create({ code: 'hh', name: 'Hardwood Heroes', sport: 'basketball' });
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: SEASON, status: 'in-season' }]);
    await seasons.prime();
    await HoopsGame.create([game(1, '2026-11-03T00:00:00Z'), game(2, '2027-03-01T00:00:00Z')]);
    await HoopsTeam.create(TEAMS.map((t, i) => Object.assign({ season: SEASON, preseason: { rank: i + 1 } }, t)));
    jest.spyOn(jobLogger, 'startRun').mockResolvedValue('run-1');
    jest.spyOn(jobLogger, 'finishRun').mockResolvedValue();
    jest.spyOn(jobMailer, 'sendJobEmail').mockResolvedValue();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// Asserts the run was an error, recorded and emailed, and wrote nothing.
async function expectLoudFailure(out, pattern) {
    expect(out.status).toBe('error');
    expect(out.summary).toMatch(pattern);
    expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'error', out.summary);
    expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
    expect(jobMailer.sendJobEmail.mock.calls[0][0]).toMatchObject({ label: 'Hoops NET', ok: false });
    expect(jobMailer.sendJobEmail.mock.calls[0][0].error).toMatch(pattern);
    expect(await HoopsNetRank.countDocuments()).toBe(0);
}

describe('run — a good page', () => {
    test('one polite GET, filed under next week, and ranksFor now grades on the NET', async () => {
        const fetchImpl = page(netPage(ROWS));
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, opts] = fetchImpl.mock.calls[0];
        expect(url).toBe(net.NET_URL);
        expect(opts.headers['User-Agent']).toBe(job.USER_AGENT);
        expect(opts.signal).toBeDefined();

        const rows = await HoopsNetRank.find({}, { _id: 0, __v: 0 }).sort({ rank: 1 }).lean();
        expect(rows.map(r => [r.week, r.teamId, r.rank])).toEqual([
            [7, 101, 1], [7, 106, 2], [7, 102, 3], [7, 105, 4], [7, 104, 5], [7, 103, 6]
        ]);
        expect(rows[0]).toMatchObject({
            season: SEASON, school: 'Iowa St.', record: { w: 9, l: 0 },
            quad1: { w: 3, l: 0 }, quad2: { w: 3, l: 0 }, quad3: { w: 1, l: 1 }, quad4: { w: 4, l: 0 },
            throughGames: new Date('2026-12-09T00:00:00Z'), fetchedAt: WEEK6_THURSDAY
        });

        expect(out.status).toBe('success');
        expect(out.summary).toMatch(/^2027 wk7: 6 team\(s\), NET through 2026-12-09 \(snapshot taken in wk6\)/);
        expect(jobLogger.startRun).toHaveBeenCalledWith('hoops-net');
        expect(jobLogger.finishRun).toHaveBeenCalledWith('run-1', 'success', out.summary);
        expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();

        // Week 6 is still graded on what it was; week 7 on the NET.
        expect((await ranksFor(SEASON, 6)).source).not.toBe('ncaa-net');
        const ranked = await ranksFor(SEASON, 7);
        expect(ranked.source).toBe('ncaa-net');
        expect(ranked.ranks).toEqual({ 101: 1, 106: 2, 102: 3, 105: 4, 104: 5, 103: 6 });
    });

    test('a re-run in the same week replaces the week; earlier weeks are history', async () => {
        await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS)) });
        await HoopsNetRank.create({ season: SEASON, week: 6, teamId: 101, rank: 9 });

        // Sunday, still week 6: two teams swapped places.
        const swapped = ROWS.map((r, i) => (i === 0 ? Object.assign({}, r, { Rank: '2' }) : i === 1 ? Object.assign({}, r, { Rank: '1' }) : r));
        await job.run({ now: new Date('2026-12-13T17:30:00Z'), fetchImpl: page(netPage(swapped, { through: 'Dec. 12 2026' })) });

        const wk7 = await HoopsNetRank.find({ season: SEASON, week: 7 }).sort({ rank: 1 }).lean();
        expect(wk7.map(r => r.teamId)).toEqual([106, 101, 102, 105, 104, 103]);
        expect(wk7[0].throughGames).toEqual(new Date('2026-12-12T00:00:00Z'));
        expect(await HoopsNetRank.countDocuments({ season: SEASON, week: 6 })).toBe(1);
    });

    test('a team dropped since the last run this week is removed, not left on the old rank', async () => {
        await HoopsNetRank.create({ season: SEASON, week: 7, teamId: 999, rank: 1 });
        await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS)) });
        expect(await HoopsNetRank.exists({ teamId: 999 })).toBeNull();
    });

    test('a failed write is retried once, and a second failure is loud', async () => {
        const real = HoopsNetRank.bulkWrite.bind(HoopsNetRank);
        const spy = jest.spyOn(HoopsNetRank, 'bulkWrite').mockRejectedValueOnce(new Error('blip')).mockImplementation(real);
        const ok = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS)) });
        expect(ok.status).toBe('success');
        expect(spy).toHaveBeenCalledTimes(2);

        await HoopsNetRank.deleteMany({});
        spy.mockReset().mockRejectedValue(new Error('write conflict'));
        const bad = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS)) });
        await expectLoudFailure(bad, /write conflict/);
    });

    test('a team on file with no NET rank: written, but an error naming it', async () => {
        // Every rank written is right, so it is kept — but that team grades as
        // unranked (Q4), and someone has to look.
        await HoopsTeam.create({ id: 107, season: SEASON, school: 'West Florida', conference: 'ASUN' });
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS)) });
        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/1 team\(s\) on file have no NET rank and will grade as unranked: West Florida/);
        expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
        expect(await HoopsNetRank.countDocuments({ week: 7 })).toBe(6);
    });
});

describe('run — skips', () => {
    test('no basketball league: silent — no fetch, no JobRun', async () => {
        await League.deleteMany({});
        await seasons.prime();
        const fetchImpl = page(netPage(ROWS));
        expect(await job.run({ now: WEEK6_THURSDAY, fetchImpl })).toEqual({ skippedReason: 'no basketball leagues' });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(jobLogger.startRun).not.toHaveBeenCalled();
    });

    test('preseason, the off-season and before mid-November: a skip row and NO fetch', async () => {
        const fetchImpl = page(netPage(ROWS));
        for (const now of [new Date('2026-10-20T12:00:00Z'), new Date('2027-06-01T12:00:00Z'), new Date('2026-11-12T17:30:00Z')]) {
            const out = await job.run({ now, fetchImpl });
            expect(out.status).toBe('skipped');
            expect(jobLogger.finishRun).toHaveBeenLastCalledWith('run-1', 'skipped', out.summary);
        }
        expect(jobLogger.finishRun.mock.calls[2][2]).toMatch(/no NET before 2026-11-15 — not fetched/);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(await HoopsNetRank.countDocuments()).toBe(0);
    });

    test.each([
        ['no table on the page', netPage([], { table: false }), /no NET table on the page — no 2027 NET yet, wk7 not written/],
        ['an empty table', netPage([]), /the NET table is empty — no 2027 NET yet/],
        ['last season\'s final ranking', netPage(ROWS, { through: 'Apr. 06 2026' }),
            /through 2026-04-06, before 2027's first game \(last season's final NET\) — no 2027 NET yet/]
    ])('before the first release, %s is a skip that writes nothing', async (_, html, pattern) => {
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(html) });
        expect(out.status).toBe('skipped');
        expect(out.summary).toMatch(pattern);
        expect(jobMailer.sendJobEmail).not.toHaveBeenCalled();
        expect(await HoopsNetRank.countDocuments()).toBe(0);
        expect((await ranksFor(SEASON, 7)).source).toBe('torvik');
    });

    test.each([
        ['past the date it is due', async () => new Date('2026-12-21T17:30:00Z')],
        ['after this season already had a NET', async () => {
            await HoopsNetRank.create({ season: SEASON, week: 6, teamId: 101, rank: 1 });
            return WEEK6_THURSDAY;
        }]
    ])('the same pages are errors %s', async (_, arrange) => {
        const now = await arrange();
        for (const html of [netPage([], { table: false }), netPage([]), netPage(ROWS, { through: 'Apr. 06 2026' })]) {
            jobMailer.sendJobEmail.mockClear();
            const out = await job.run({ now, fetchImpl: page(html) });
            expect(out.status).toBe('error');
            expect(out.summary).toMatch(/a 2027 NET is due by now/);
            expect(jobMailer.sendJobEmail).toHaveBeenCalledTimes(1);
        }
        expect(await HoopsNetRank.countDocuments({ week: 7 })).toBe(0);
    });
});

describe('run — loud failures, nothing written', () => {
    test('a fetch that throws', async () => {
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });
        await expectLoudFailure(out, /ECONNRESET/);
        expect(out.summary).toMatch(/^2027: FAILED ECONNRESET/);
    });

    test('a rejection that is not an Error is still reported', async () => {
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: jest.fn().mockRejectedValue('socket hang up') });
        await expectLoudFailure(out, /socket hang up/);
    });

    test('with no fetch injected it uses the global one — stubbed here, never the real site', async () => {
        const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 503, text: async () => '' });
        const out = await job.run({ now: WEEK6_THURSDAY });
        expect(spy).toHaveBeenCalledWith(net.NET_URL, expect.anything());
        expect(out.summary).toMatch(/HTTP 503/);
    });

    test('a non-200 answer', async () => {
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page('Access Denied', 403) }), /NET page answered HTTP 403/);
    });

    test('a changed layout: a column gone', async () => {
        const html = netPage(ROWS).replace(/<th>Quad 2<\/th>/, '<th>Q2</th>');
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(html) }), /layout changed: the ranking table has no "Quad 2" column/);
    });

    test('a changed layout: no Through Games stamp', async () => {
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS, { through: null })) }),
            /layout changed: no readable "Through Games" date/);
    });

    test('a stamp from the future is a broken page, not a fresh one', async () => {
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS, { through: 'Dec. 11 2026' })) }),
            /"Through Games" 2026-12-11 is after today/);
        // Today itself is fine.
        expect((await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS, { through: 'Dec. 10 2026' })) })).status).toBe('success');
    });

    test('a changed layout: a rank repeated', async () => {
        const dup = ROWS.map((r, i) => (i === 1 ? Object.assign({}, r, { Rank: '1' }) : r));
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(dup)) }), /rank\(s\) repeated — #1 Memphis/);
    });

    test('a row count far from the number of teams on file', async () => {
        const extra = Array.from({ length: job.ROW_TOLERANCE + 1 }, (_, i) => netRow(7 + i, `Extra ${i}`, 'X'));
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage([...ROWS, ...extra])) }),
            /the NET table has 22 row\(s\), but 6 D-I team\(s\) are on file for 2027/);
    });

    test('a row count within tolerance is not refused for its count alone', async () => {
        // One row short reaches the matcher and the coverage floor, which
        // have their own say; the count check is for a broken page.
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS.slice(0, 5))) });
        expect(out.summary).not.toMatch(/row\(s\), but/);
        expect(out.summary).toMatch(/1 team\(s\) on file have no NET rank .*: Mississippi Valley State/);
        expect(await HoopsNetRank.countDocuments({ week: 7 })).toBe(5);
    });

    test('a stale Through Games date: games final for over two days that the NET has not counted', async () => {
        // Through Dec 5; a game on the 7th went final and it is now the 10th.
        await HoopsGame.create(game(3, '2026-12-08T00:30:00Z', { status: 'final', homePoints: 70, awayPoints: 60 }));
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS, { through: 'Dec. 05 2026' })) });
        await expectLoudFailure(out, /the NET is stale: through 2026-12-05, but 1 game\(s\) before 2026-12-08 are not in it/);
    });

    test('not stale: a game ON the stamp\'s day, a game inside the grace, and a quiet Christmas', async () => {
        await HoopsGame.create([
            // 9pm Eastern on the 5th is the 6th in UTC — but the 5th's game.
            game(3, '2026-12-06T02:00:00Z', { status: 'final', homePoints: 70, awayPoints: 60 }),
            // Final, but under two days ago.
            game(4, '2026-12-09T01:00:00Z', { status: 'final', homePoints: 70, awayPoints: 60 })
        ]);
        const ok = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS, { through: 'Dec. 05 2026' })) });
        expect(ok.status).toBe('success');

        // Through the 7th on the 10th: NCAA has not posted yet today AND
        // missed yesterday. An 11am game on the 8th is inside the grace —
        // counted in hours it would be over two days old by the run.
        await HoopsNetRank.deleteMany({});
        await HoopsGame.create(game(5, '2026-12-08T16:00:00Z', { status: 'final', homePoints: 70, awayPoints: 60 }));
        const late = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS, { through: 'Dec. 07 2026' })) });
        expect(late.status).toBe('success');

        // Through the 23rd on the 27th, with no games played since: the
        // calendar says four days, the games say current.
        await HoopsNetRank.deleteMany({});
        const xmas = await job.run({ now: new Date('2026-12-27T17:30:00Z'), fetchImpl: page(netPage(ROWS, { through: 'Dec. 23 2026' })) });
        expect(xmas.status).toBe('success');
    });

    test('an unmatched name fails the run, listing every one', async () => {
        const rows = [...ROWS.slice(0, 4), netRow(5, 'Alcorn A&amp;M', 'SWAC'), netRow(6, 'Miss. Valley', 'SWAC')];
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(rows)) });
        await expectLoudFailure(out, /2 NET name\(s\) match no team — add them to data\/ncaa-net-aliases.json: Alcorn A&M, Miss. Valley/);
        expect(out.summary).toMatch(/wk7 not written/);
    });

    test('an ambiguous name says which teams it could be', async () => {
        await HoopsTeam.create({ id: 108, season: SEASON, school: 'Kansas City', shortDisplayName: 'Kansas', conference: 'Summit' });
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS)) });
        await expectLoudFailure(out, /Kansas \(ambiguous: Kansas \/ Kansas City\)/);
    });

    test('a double claim fails the run', async () => {
        const rows = [...ROWS.slice(0, 5), netRow(6, 'Iowa State', 'Big 12')];
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(rows)) }),
            /1 team\(s\) claimed twice: Iowa State by Iowa St\. and Iowa State/);
    });

    test('a conference that disagrees with the rest of its group fails the run', async () => {
        // Kansas listed in the SWAC: the shape a swapped alias pair leaves.
        // Two Big 12 rows are needed for the majority; give the field more.
        const more = [
            { id: 109, school: 'Baylor', conference: 'Big 12' }, { id: 110, school: 'Houston', conference: 'Big 12' }
        ];
        await HoopsTeam.create(more.map(t => Object.assign({ season: SEASON }, t)));
        const rows = [...ROWS.map(r => (r.School === 'Kansas' ? Object.assign({}, r, { Conf: 'SWAC' }) : r)),
            netRow(7, 'Baylor', 'Big 12'), netRow(8, 'Houston', 'Big 12')];
        await expectLoudFailure(await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(rows)) }),
            /1 match\(es\) in the wrong conference \(a swapped alias\?\): Kansas — NET says SWAC, we have Big 12/);
    });

    test('a NET under ranksFor\'s coverage floor is refused', async () => {
        // Four of six teams: everything matches, the count is within
        // tolerance, but ranksFor would discard the week.
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS.slice(0, 4))) });
        expect(out.status).toBe('error');
        expect(out.summary).toMatch(/the NET ranked only 4 team\(s\), under the 5 ranksFor needs — wk7 not written/);
        expect(await HoopsNetRank.countDocuments()).toBe(0);
    });

    test('a long list of names is cut short in the message', async () => {
        const rows = Array.from({ length: 14 }, (_, i) => netRow(i + 1, `Nowhere ${i}`, 'X'));
        await HoopsTeam.create(Array.from({ length: 8 }, (_, i) => ({ id: 200 + i, season: SEASON, school: `Pad ${i}` })));
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(rows)) });
        expect(out.summary).toMatch(/Nowhere 11 … \(\+2\)/);
    });
});

describe('known gaps between NCAA\'s field and ours (alias file)', () => {
    afterEach(() => { net.KNOWN_GAPS.notOurs = []; net.KNOWN_GAPS.notRanked = []; });

    test('a checked NCAA name with no team of ours is left out and named in the summary, not a failure', async () => {
        net.KNOWN_GAPS.notOurs = ['Saint Francis'];
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage([...ROWS, netRow(7, 'Saint Francis', 'NEC')])) });
        expect(out.status).toBe('success');
        expect(out.summary).toMatch(/6 team\(s\), NET through 2026-12-09, 1 listed as not ours: Saint Francis/);
        expect(await HoopsNetRank.countDocuments({ week: 7 })).toBe(6);
    });

    test('without the entry, the same page fails loudly', async () => {
        const out = await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage([...ROWS, netRow(7, 'Saint Francis', 'NEC')])) });
        await expectLoudFailure(out, /1 NET name\(s\) match no team .*: Saint Francis/);
    });

    test('a checked school NCAA does not rank is not reported as unclaimed', () => {
        const m = net.matchNet([{ rank: 1, school: 'Kansas', conference: 'Big 12' }], TEAMS, undefined,
            { notRanked: TEAMS.filter(t => t.school !== 'Kansas').map(t => t.school) });
        expect(m.unclaimed).toEqual([]);
    });
});

describe('the NET outranks the CBBD snapshot in ranksFor', () => {
    test('a week with both is graded on the NET', async () => {
        await HoopsRating.create(TEAMS.map((t, i) => ({ season: SEASON, week: 7, teamId: t.id, rank: 6 - i, source: 'cbbd-adjusted' })));
        expect((await ranksFor(SEASON, 7)).source).toBe('blended');
        await job.run({ now: WEEK6_THURSDAY, fetchImpl: page(netPage(ROWS)) });
        expect((await ranksFor(SEASON, 7)).source).toBe('ncaa-net');
    });
});

describe('seasonDate', () => {
    test('a month/day in the calendar year the season starts', () => {
        expect(job.seasonDate(2027, job.FIRST_LOOK)).toEqual(new Date('2026-11-15T00:00:00Z'));
        expect(job.seasonDate(2027, job.EXPECTED_BY)).toEqual(new Date('2026-12-20T00:00:00Z'));
    });
});
