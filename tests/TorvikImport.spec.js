// modules/torvik-import.js (#544): the checks, the write and the lock that the
// CLI and the admin card share.
//
// The failure that matters is silent — a team missing from the draft pool, or
// holding another program's rating, or a preseason rank landing after games
// have been scored — so each refusal is driven here, not just the happy path.

const fs = require('fs');
const path = require('path');
const { useMongo } = require('./helpers/mongo');
const HoopsTeam = require('../models/hoopsTeam');
const League = require('../models/league');
const Franchise = require('../models/franchise');
const mongoose = require('mongoose');
const torvik = require('../modules/torvik-import');

useMongo();
const SEASON = 2027;

// N teams in two conferences, ranked 1..N the right way up.
const SCHOOLS = ['Duke', 'Virginia', 'Louisville', 'Clemson', 'Miami', 'Syracuse',
    'Kansas', 'Houston', 'Iowa State', 'Baylor', 'Arizona', 'Texas Tech'];
const confOf = (i) => (i < 6 ? ['ACC', 'ACC'] : ['B12', 'Big 12']);
const ratings = (order = SCHOOLS) => order.map((school, i) => ({
    rank: i + 1, school: school === 'Iowa State' ? 'Iowa St.' : school === 'Miami' ? 'Miami FL' : school,
    conference: confOf(SCHOOLS.indexOf(school))[0],
    adjOE: 120 - i, adjDE: 90 + i, barthag: Number((0.95 - i * 0.05).toFixed(4)), projectedRecord: `${25 - i}-${5 + i}`
}));
const seedTeams = () => HoopsTeam.create(SCHOOLS.map((school, i) => ({
    id: i + 1, season: SEASON, school, conference: confOf(i)[1]
})));

describe('problemsWith', () => {
    test('a clean set has no problems', () => {
        expect(torvik.problemsWith(ratings())).toEqual([]);
    });

    test('every row claiming rank 1 is refused', () => {
        const rows = ratings().map(r => Object.assign({}, r, { rank: 1 }));
        expect(torvik.problemsWith(rows).join('\n')).toMatch(/not unique/);
    });

    test('a reversed sort is refused', () => {
        const rows = ratings().map((r, i, all) => Object.assign({}, r, { rank: all.length - i }));
        expect(torvik.problemsWith(rows).join('\n')).toMatch(/sort may be reversed/);
    });

    test('swapped AdjOE / AdjDE columns are refused', () => {
        const rows = ratings().map(r => Object.assign({}, r, { adjOE: r.adjDE, adjDE: r.adjOE }));
        expect(torvik.problemsWith(rows).join('\n')).toMatch(/columns may be swapped/);
    });

    test('out-of-range values and a malformed row are named', () => {
        const rows = ratings();
        rows[1].adjOE = 300;
        rows[2].adjDE = 10;
        rows[3].barthag = 4;
        rows[4].projectedRecord = '';
        rows[5].school = '';
        const out = torvik.problemsWith(rows).join('\n');
        expect(out).toMatch(/Virginia: adjOE 300/);
        expect(out).toMatch(/Louisville: adjDE 10/);
        expect(out).toMatch(/Clemson: barthag 4/);
        expect(out).toMatch(/Miami FL: projected record/);
        expect(out).toMatch(/malformed row/);
    });

    test('a gap in the ranks and a repeated school are refused', () => {
        const rows = ratings();
        rows[11].rank = 40;
        rows[10].school = 'Duke';
        const out = torvik.problemsWith(rows).join('\n');
        expect(out).toMatch(/expected 1\.\.12/);
        expect(out).toMatch(/named more than once/);
    });
});

// One row of {season}_team_results.json, in its real positional shape.
const jsonRow = (rank, team, conf, { rec = '0-0', oe = 120.59, de = 90.99, bt = 0.96224, w = 25.84, l = 6.16 } = {}) =>
    [rank, team, conf, rec, oe, 5, de, 1, bt, rank, w, l, 14.3, 3.7, '0-0'];

describe('parseTorvikJson', () => {
    test('maps the positional columns, rounded as the page prints them', () => {
        expect(torvik.parseTorvikJson([jsonRow(1, 'Duke', 'ACC')])).toEqual([{
            rank: 1, school: 'Duke', conference: 'ACC', adjOE: 120.6, adjDE: 91,
            barthag: 0.9622, projectedRecord: '26-6'
        }]);
    });

    test('refuses in-season ratings — a team with a record is not preseason', () => {
        expect(() => torvik.parseTorvikJson([jsonRow(1, 'Duke', 'ACC'), jsonRow(2, 'Arizona', 'B12', { rec: '1-0' })]))
            .toThrow(/Arizona is 1-0.*in-season/);
    });

    test('a non-list is refused, and a non-array row becomes a malformed row', () => {
        expect(() => torvik.parseTorvikJson({ a: 1 })).toThrow(/not a list/);
        const rows = torvik.parseTorvikJson([7]);
        expect(torvik.problemsWith(rows).join('\n')).toMatch(/malformed row/);
    });

    test('the measured file shape: the committed 30 Sep paste and the JSON agree on names', () => {
        // The JSON's names are the same strings parseTRank pulls out of the
        // page's team.php links, so matchTeams needs no second alias table.
        const committed = require('../data/torvik-preseason-2027.json').teams;
        const fromJson = torvik.parseTorvikJson(committed.map(t => jsonRow(t.rank, t.school, t.conference)));
        expect(fromJson.map(r => r.school)).toEqual(committed.map(t => t.school));
    });
});

describe('parsePaste', () => {
    test('the team_results.json text', () => {
        const out = torvik.parsePaste(' ' + JSON.stringify([jsonRow(1, 'Duke', 'ACC')]));
        expect(out.format).toBe('json');
        expect(out.rows[0].school).toBe('Duke');
    });

    test('a committed data file', () => {
        const text = fs.readFileSync(path.join(__dirname, '..', 'data', 'torvik-preseason-2027.json'), 'utf8');
        const out = torvik.parsePaste(text);
        expect(out.format).toBe('file');
        expect(out.rows).toHaveLength(365);
    });

    test('the page source', () => {
        const html = '<table><tr><td>1</td><td><a href="team.php?team=Duke&amp;year=2027">Duke</a></td><td>ACC</td>'
            + '<td>120.8 1</td><td>91.0 2</td><td>.9629</td><td>26-6</td><td>14-4</td></tr></table>';
        const out = torvik.parsePaste(html);
        expect(out.format).toBe('html');
        expect(out.rows[0]).toMatchObject({ rank: 1, school: 'Duke', adjOE: 120.8 });
    });

    test('a browser copy of the table (plain text) is refused with directions, not parsed as 0 rows', () => {
        const copied = 'Rk\tTeam\tConf\tAdjOE\n1\tDuke\tACC\t120.8\n2\tArizona\tB12\t119.1';
        expect(() => torvik.parsePaste(copied)).toThrow(/copied text.*team_results\.json/);
    });

    test('HTML with no team rows, broken JSON and an empty paste are each named', () => {
        expect(() => torvik.parsePaste('<tr><td>x</td></tr>')).toThrow(/no T-Rank table rows/);
        expect(() => torvik.parsePaste('[[1,"Duke"')).toThrow(/does not parse/);
        expect(() => torvik.parsePaste('   ')).toThrow(/nothing was pasted/);
        expect(() => torvik.parsePaste(undefined)).toThrow(/nothing was pasted/);
    });
});

describe('fetchFromTorvik', () => {
    const reply = (status, body) => jest.fn(() => Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(body) }));

    test('reads the season\'s JSON file', async () => {
        const fetchImpl = reply(200, JSON.stringify([jsonRow(1, 'Duke', 'ACC')]));
        const out = await torvik.fetchFromTorvik(SEASON, { fetchImpl });
        expect(fetchImpl.mock.calls[0][0]).toBe('https://barttorvik.com/2027_team_results.json');
        expect(out.rows[0].school).toBe('Duke');
    });

    test('the "Verifying Browser" wall is refused as a page, not parsed', async () => {
        // What barttorvik's HTML pages answer a server GET with (measured).
        const wall = '<!DOCTYPE html><html><head><title>Verifying Browser...</title>';
        await expect(torvik.fetchFromTorvik(SEASON, { fetchImpl: reply(200, wall) })).rejects.toThrow(/web page, not data/);
    });

    test('an error status and a network failure point at the paste', async () => {
        await expect(torvik.fetchFromTorvik(SEASON, { fetchImpl: reply(503, '') })).rejects.toThrow(/answered 503.*paste/);
        const down = jest.fn(() => Promise.reject(new Error('ENOTFOUND')));
        await expect(torvik.fetchFromTorvik(SEASON, { fetchImpl: down })).rejects.toThrow(/could not reach.*ENOTFOUND/);
    });
});

describe('seasonUnderway', () => {
    const franchise = (league, weeks) => Franchise.create({
        accountId: new mongoose.Types.ObjectId(), league,
        seasons: [{ season: SEASON, weeklyScore: weeks.map((score, i) => ({ week: i + 1, score })) }]
    });
    beforeEach(() => League.create([
        { code: 'hoops-league', name: 'Hoops', sport: 'basketball' },
        { code: 'graham-league', name: 'Graham', sport: 'football' }
    ]));

    test('no franchise, or only zero-point weeks, is not underway', async () => {
        expect(await torvik.seasonUnderway(SEASON)).toBe(false);
        // The scoring job seeds zero weeks before tip-off: an entry is not a game.
        await franchise('hoops-league', [0, 0]);
        expect(await torvik.seasonUnderway(SEASON)).toBe(false);
    });

    test('banked points in a basketball league lock it', async () => {
        await franchise('hoops-league', [0, 12]);
        expect(await torvik.seasonUnderway(SEASON)).toBe(true);
    });

    test('a FOOTBALL league\'s points in the same season number do not', async () => {
        await franchise('graham-league', [40]);
        expect(await torvik.seasonUnderway(SEASON)).toBe(false);
    });

    test('points in another season do not', async () => {
        await franchise('hoops-league', [12]);
        expect(await torvik.seasonUnderway(SEASON + 1)).toBe(false);
    });

    test('an unusable season fails CLOSED', async () => {
        expect(await torvik.seasonUnderway(null)).toBe(true);
        expect(await torvik.seasonUnderway('x')).toBe(true);
    });

    test('no basketball league at all is not underway', async () => {
        await League.deleteMany({ sport: 'basketball' });
        expect(await torvik.seasonUnderway(SEASON)).toBe(false);
    });
});

describe('check', () => {
    test('a clean set against the teams passes, matched through the St. and alias rewrites', async () => {
        await seedTeams();
        const out = await torvik.check(SEASON, ratings());
        expect(out.problems).toEqual([]);
        expect(out.ok).toBe(true);
        expect(out.matched).toHaveLength(12);
    });

    test('0 rows', async () => {
        const out = await torvik.check(SEASON, []);
        expect(out.ok).toBe(false);
        expect(out.problems[0]).toMatch(/0 rating rows/);
    });

    test('a bad set stops before the team read', async () => {
        await seedTeams();
        const out = await torvik.check(SEASON, ratings().map(r => Object.assign({}, r, { rank: 1 })));
        expect(out.ok).toBe(false);
        expect(out.teams).toBe(0);
        expect(out.problems[0]).toMatch(/^BAD/);
    });

    test('no teams for the season', async () => {
        const out = await torvik.check(SEASON, ratings());
        expect(out.problems[0]).toMatch(/run the teams ingest first/);
    });

    test('an unmatched name and a team left unrated are both reported', async () => {
        await seedTeams();
        const rows = ratings();
        rows[11].school = 'Texas Tech Red Raiders';
        const out = await torvik.check(SEASON, rows);
        expect(out.ok).toBe(false);
        expect(out.problems).toEqual(expect.arrayContaining([
            expect.stringMatching(/UNMATCHED\s+Texas Tech Red Raiders/),
            expect.stringMatching(/NO RATING\s+Texas Tech/),
            expect.stringMatching(/NAME_ALIASES/)
        ]));
    });

    test('a double claim is reported', async () => {
        await seedTeams();
        const rows = ratings();
        // problemsWith refuses a repeated name first, so drive matchTeams with
        // two SPELLINGS of one team: Iowa St. is already rows[8].
        rows[11].school = 'Iowa State';
        const out = await torvik.check(SEASON, rows);
        expect(out.problems.join('\n')).toMatch(/DOUBLE\s+Iowa State claimed by Iowa St\. and Iowa State/);
    });

    test('a swapped pair lands on the conference check', async () => {
        await seedTeams();
        const rows = ratings();
        // Duke (ACC) and Kansas (B12) exchange conference labels — what a
        // swapped pair of aliases looks like from here.
        rows[0].conference = 'B12';
        rows[6].conference = 'ACC';
        const out = await torvik.check(SEASON, rows);
        expect(out.ok).toBe(false);
        expect(out.problems.join('\n')).toMatch(/CONFERENCE\s+Duke: torvik says B12/);
        expect(out.problems.join('\n')).toMatch(/KNOWN_CONFERENCE_DRIFT/);
    });
});

describe('compare', () => {
    const matched = (order) => ratings(order).map((rating, i) => ({ rating, team: { school: order[i], conference: 'x' } }));

    test('first import: no current set, so nothing joins, leaves or moves', () => {
        const out = torvik.compare([], matched(SCHOOLS), { top: 3 });
        expect(out.newTop.map(t => t.school)).toEqual(['Duke', 'Virginia', 'Louisville']);
        expect(out.newTop[0].was).toBeNull();
        expect(out.joinsPool).toEqual([]);
        expect(out.leavesPool).toEqual([]);
        expect(out.movers).toEqual([]);
    });

    test('movers are ranked by size, and pool entries/exits are found', () => {
        const pool = torvik.POOL;
        // A current set where Texas Tech sits just outside the pool and Duke
        // just inside it; the new set flips them.
        const current = [{ rank: 1, school: 'Virginia' }, { rank: 5, school: 'Kansas' },
            { rank: pool, school: 'Duke' }, { rank: pool + 1, school: 'Texas Tech' }];
        const next = [
            { rating: { rank: 1, school: 'Texas Tech' }, team: { school: 'Texas Tech' } },
            { rating: { rank: 2, school: 'Virginia' }, team: { school: 'Virginia' } },
            { rating: { rank: 6, school: 'Kansas' }, team: { school: 'Kansas' } },
            { rating: { rank: pool + 5, school: 'Duke' }, team: { school: 'Duke' } }
        ];
        const out = torvik.compare(current, next);
        expect(out.joinsPool.map(t => t.school)).toEqual(['Texas Tech']);
        expect(out.leavesPool.map(t => t.school)).toEqual(['Duke']);
        expect(out.movers.map(t => t.school)).toEqual(['Texas Tech', 'Duke', 'Virginia', 'Kansas']);
        expect(out.currentTop[0].school).toBe('Virginia');
    });
});

describe('apply', () => {
    test('stamps every team with the rating, source and time, and counts them', async () => {
        await seedTeams();
        const { matched } = await torvik.check(SEASON, ratings());
        const out = await torvik.apply(SEASON, matched, 'test source');
        expect(out).toMatchObject({ written: 12, matched: 12, stamped: 12, teams: 12, source: 'test source' });
        const duke = await HoopsTeam.findOne({ season: SEASON, school: 'Duke' }).lean();
        expect(duke.preseason).toMatchObject({ rank: 1, adjOE: 120, source: 'test source', importedAt: out.importedAt });
        const now = await torvik.current(SEASON);
        expect(now).toMatchObject({ teams: 12, ranked: 12, source: 'test source', sources: 1 });
        expect(now.ranks[0]).toEqual({ rank: 1, school: 'Duke', conference: 'ACC' });
    });

    test('a short stamp count refuses, with the counts attached', async () => {
        await seedTeams();
        const { matched } = await torvik.check(SEASON, ratings());
        await expect(torvik.apply(SEASON, matched.slice(1), 's')).rejects.toMatchObject({
            message: expect.stringMatching(/1 team\(s\) still have no preseason rank \(11 \/ 12\)/),
            result: expect.objectContaining({ stamped: 11, teams: 12 })
        });
    });

    test('a failed write reports how many rows landed', async () => {
        const err = Object.assign(new Error('boom'), { result: { nModified: 4 } });
        jest.spyOn(HoopsTeam, 'bulkWrite').mockRejectedValueOnce(err);
        await expect(torvik.apply(SEASON, [{ team: { school: 'Duke' }, rating: {} }], 's'))
            .rejects.toMatchObject({ message: expect.stringMatching(/PARTIAL IMPORT: 4 of 1/), partial: 4 });
        jest.spyOn(HoopsTeam, 'bulkWrite').mockRejectedValueOnce(new Error('no result'));
        await expect(torvik.apply(SEASON, [], 's')).rejects.toMatchObject({ partial: 0 });
    });

    test('current() on a season never imported', async () => {
        await seedTeams();
        expect(await torvik.current(SEASON)).toMatchObject({ teams: 12, ranked: 0, source: null, importedAt: null, sources: 0, ranks: [] });
    });
});
