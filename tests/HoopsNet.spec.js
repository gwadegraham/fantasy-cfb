// Reading the official NCAA NET off ncaa.com (#533): the parse, the name
// matching, and the read the team and game pages make.
//
// The page is a SYNTHETIC fixture in ncaa.com's shape (fixtures/
// ncaa-net-page.js) — NCAA's own page is never committed and never fetched.

const { useMongo } = require('./helpers/mongo');
const net = require('../modules/hoops-net');
const HoopsNetRank = require('../models/hoopsNetRank');
const { netPage, netRow, COLUMNS } = require('./fixtures/ncaa-net-page');

const team = (id, school, conference, o = {}) => Object.assign({ id, school, conference }, o);

describe('parseNetPage', () => {
    test('reads rank, school, record, conference and the four Quad records, by header name', () => {
        const out = net.parseNetPage(netPage([
            netRow(1, 'Michigan', 'Big Ten', { Record: '37-3', 'Quad 1': '21-3', 'Quad 2': '7-0', 'Quad 3': '6-0', 'Quad 4': '3-0' }),
            netRow(2, 'Mississippi Val.', 'SWAC', { Record: '2-30', 'Quad 1': '0-4', 'Quad 2': '0-4', 'Quad 3': '0-1', 'Quad 4': '2-21' })
        ]));
        expect(out.hasTable).toBe(true);
        expect(out.throughGames).toEqual(new Date('2026-12-09T00:00:00Z'));
        expect(out.rows).toEqual([
            { rank: 1, school: 'Michigan', conference: 'Big Ten', record: { w: 37, l: 3 },
                quad1: { w: 21, l: 3 }, quad2: { w: 7, l: 0 }, quad3: { w: 6, l: 0 }, quad4: { w: 3, l: 0 } },
            { rank: 2, school: 'Mississippi Val.', conference: 'SWAC', record: { w: 2, l: 30 },
                quad1: { w: 0, l: 4 }, quad2: { w: 0, l: 4 }, quad3: { w: 0, l: 1 }, quad4: { w: 2, l: 21 } }
        ]);
    });

    test('a column moved is still read by its name, not its position', () => {
        // Quad 4 moved in front of Quad 1: positional reading would swap them.
        const cols = COLUMNS.filter(c => c !== 'Quad 4');
        cols.splice(cols.indexOf('Quad 1'), 0, 'Quad 4');
        const [r] = net.parseNetPage(netPage([netRow(1, 'Duke', 'ACC', { 'Quad 1': '9-1', 'Quad 4': '5-0' })], { columns: cols })).rows;
        expect(r.quad1).toEqual({ w: 9, l: 1 });
        expect(r.quad4).toEqual({ w: 5, l: 0 });
    });

    test('decodes entities in a school name', () => {
        const [r] = net.parseNetPage(netPage([netRow(1, 'Saint Mary&#039;s (CA)', 'WCC'), netRow(2, 'Texas A&amp;M', 'SEC')])).rows;
        expect(r.school).toBe("Saint Mary's (CA)");
        expect(net.cellText('A&amp;M &rsquo; &#x41; &bogus;')).toBe('A&M ’ A &bogus;');
    });

    test('no ranking table at all: hasTable false and no rows — the job decides if that is the cold start', () => {
        expect(net.parseNetPage(netPage([], { table: false }))).toEqual({
            throughGames: new Date('2026-12-09T00:00:00Z'), hasTable: false, rows: []
        });
    });

    test('a single spanning message row is not a team: the table reads as empty', () => {
        const html = netPage([]).replace(/<tbody>/, '<tbody><tr><td colspan="13">Rankings will be released soon</td></tr>');
        expect(net.parseNetPage(html)).toMatchObject({ hasTable: true, rows: [] });
        // One cell WITHOUT a colspan is still a broken row.
        expect(() => net.parseNetPage(netPage([]).replace(/<tbody>/, '<tbody><tr><td>1</td></tr>'))).toThrow(/a row has 1 cells/);
    });

    test('<thead> is not mistaken for a header cell', () => {
        const html = netPage([netRow(1, 'Duke', 'ACC')]).replace('<thead>', '<thead class="x">Season 2027');
        expect(net.parseNetPage(html).rows.map(r => r.school)).toEqual(['Duke']);
    });

    test('an empty table is a table with no rows', () => {
        expect(net.parseNetPage(netPage([]))).toMatchObject({ hasTable: true, rows: [] });
    });

    test('a ranking table missing a column it needs is a layout error, never a skip', () => {
        const cols = COLUMNS.filter(c => c !== 'Quad 3');
        expect(() => net.parseNetPage(netPage([netRow(1, 'Duke', 'ACC')], { columns: cols })))
            .toThrow(/layout changed: the ranking table has no "Quad 3" column/);
    });

    test('an unreadable row is a layout error, not a dropped team', () => {
        expect(() => net.parseNetPage(netPage([netRow(1, 'Duke', 'ACC', { 'Quad 2': 'TBD' })])))
            .toThrow(/layout changed: unreadable row: "1 \| Duke/);
        expect(() => net.parseNetPage(netPage([netRow('—', 'Duke', 'ACC')]))).toThrow(/unreadable row/);
        expect(() => net.parseNetPage(netPage([netRow(1, '', 'ACC')]))).toThrow(/unreadable row/);
        expect(() => net.parseNetPage(netPage([netRow(1, 'Duke', 'ACC', { Record: '' })]))).toThrow(/unreadable row/);
    });

    test('a row with the wrong number of cells is a layout error', () => {
        const html = netPage([netRow(1, 'Duke', 'ACC')]).replace('<td>ACC</td>', '');
        expect(() => net.parseNetPage(html)).toThrow(/a row has 12 cells under 13 headers/);
    });

    test('a table with no tbody still reads, header row skipped', () => {
        const html = netPage([netRow(1, 'Duke', 'ACC')]).replace(/<\/?t(body|head)>/g, '');
        expect(net.parseNetPage(html).rows.map(r => r.school)).toEqual(['Duke']);
    });

    test('picks the table with a School column when the page has others', () => {
        const html = netPage([netRow(1, 'Duke', 'ACC')])
            .replace('<div class="layout--has-sidebar">', '<table><tr><td>layout</td></tr></table><table><tr><th>Poll</th></tr><tr><td>AP</td></tr></table><div class="layout--has-sidebar">');
        expect(net.parseNetPage(html).rows.map(r => r.school)).toEqual(['Duke']);
    });
});

describe('parseNetPage — markup NCAA could change without changing the data', () => {
    const rows = [netRow(1, 'Iowa St.', 'Big 12'), netRow(2, 'Duke', 'ACC')];
    test('a rank cell marked up as <th scope="row"> in the body still reads, and the header is only the <thead>', () => {
        const html = netPage(rows).replace(/<td>(\d+)<\/td>(\s*<td>(Iowa St\.|Duke)<\/td>)/g, '<th scope="row">$1</th>$2');
        expect(html).toContain('<th scope="row">1</th>');                    // the fixture really changed
        const parsed = net.parseNetPage(html);
        expect(parsed.rows.map(r => [r.rank, r.school])).toEqual([[1, 'Iowa St.'], [2, 'Duke']]);
    });
    test('a table with no rows at all is no ranking table (the cold start), not a layout error', () => {
        expect(net.parseNetPage('<p>Through Games Dec. 09 2026</p><table class="ad"></table>').hasTable).toBe(false);
    });
    test('a table with no <tbody>: the header row is not read as a team', () => {
        const html = netPage(rows).replace(/<\/?tbody>/g, '').replace(/<\/?thead>/g, '');
        expect(html).not.toContain('tbody');
        expect(net.parseNetPage(html).rows.map(r => r.school)).toEqual(['Iowa St.', 'Duke']);
    });
});

describe('parseThroughGames', () => {
    test('reads NCAA\'s "Mon. DD YYYY" stamp as an Eastern day at UTC midnight', () => {
        expect(net.parseThroughGames('Through Games Apr. 06 2026')).toEqual(new Date('2026-04-06T00:00:00Z'));
        expect(net.parseThroughGames('Through Games Dec 1, 2026')).toEqual(new Date('2026-12-01T00:00:00Z'));
        expect(net.parseThroughGames('Through Games Sept. 30 2026')).toEqual(new Date('2026-09-30T00:00:00Z'));
    });

    test('absent, an unknown month, or an impossible day is null — not a rolled-over date', () => {
        expect(net.parseThroughGames('<p>nothing here</p>')).toBeNull();
        expect(net.parseThroughGames('Through Games Smarch 03 2026')).toBeNull();
        expect(net.parseThroughGames('Through Games Feb. 31 2027')).toBeNull();
    });
});

describe('parseRecord', () => {
    test('"W-L", or null', () => {
        expect(net.parseRecord('21-3')).toEqual({ w: 21, l: 3 });
        expect(net.parseRecord(' 0 - 0 ')).toEqual({ w: 0, l: 0 });
        expect(net.parseRecord('21–3x')).toBeNull();
        expect(net.parseRecord('')).toBeNull();
    });
});

describe('matchNet', () => {
    const TEAMS = [
        team(1, 'Iowa State', 'Big 12'),
        team(2, "St. John's", 'Big East'),
        team(3, "Saint Mary's", 'WCC'),
        team(4, 'Miami', 'ACC'),
        team(5, 'Miami (OH)', 'MAC'),
        team(6, 'Mississippi Valley State', 'SWAC'),
        team(7, 'Northern Iowa', 'MVC', { abbreviation: 'UNI' }),
        team(8, 'Arkansas-Pine Bluff', 'SWAC'),
        team(9, 'North Carolina Central', 'MEAC'),
        team(10, 'Florida Atlantic', 'American'),
        team(11, 'Central Connecticut', 'NEC'),
        team(12, 'UConn', 'Big East', { shortDisplayName: 'UConn' })
    ];
    const rows = (names) => names.map(([school, conference], i) => ({ rank: i + 1, school, conference }));
    const ALL = [
        ['Iowa St.', 'Big 12'], ["St. John's (NY)", 'Big East'], ["Saint Mary's (CA)", 'WCC'], ['Miami (FL)', 'ACC'],
        ['Miami (OH)', 'MAC'], ['Mississippi Val.', 'SWAC'], ['UNI', 'MVC'], ['Ark.-Pine Bluff', 'SWAC'],
        ['N.C. Central', 'MEAC'], ['Fla. Atlantic', 'American'], ['Central Conn. St.', 'NEC'], ['UConn', 'Big East']
    ];

    test('pairs NCAA\'s short names with ours: St., abbreviations, qualifiers, acronyms and the alias file', () => {
        const m = net.matchNet(rows(ALL), TEAMS);
        expect(m.unmatched).toEqual([]);
        expect(m.doubleClaimed).toEqual([]);
        expect(m.unclaimed).toEqual([]);
        expect(m.conferenceMismatches).toEqual([]);
        expect(m.matched.map(x => [x.row.school, x.team.id])).toEqual(ALL.map(([s], i) => [s, i + 1]));
    });

    test('an unknown name is UNMATCHED and listed — never dropped, never guessed', () => {
        const m = net.matchNet(rows([['Iowa St.', 'Big 12'], ['Gonzaga U. of Spokane', 'WCC']]), TEAMS);
        expect(m.unmatched).toEqual([{ school: 'Gonzaga U. of Spokane', candidates: [] }]);
        expect(m.matched).toHaveLength(1);
        expect(m.unclaimed).toHaveLength(TEAMS.length - 1);
    });

    test('a name two teams answer to is unmatched as ambiguous, not resolved by a looser key', () => {
        // "Miami (FL)" hits two teams on the strict key. The looser key
        // (qualifier dropped) would find exactly one — the WRONG school — so
        // trying it would turn an ambiguity into a silent mismatch.
        const twins = [team(1, 'Miami (FL)', 'ACC'), team(2, 'Hurricanes U', 'ACC', { shortDisplayName: 'Miami (FL)' }),
            team(3, 'Miami', 'MAC')];
        const m = net.matchNet(rows([['Miami (FL)', 'ACC']]), twins);
        expect(m.unmatched).toEqual([{ school: 'Miami (FL)', candidates: ['Miami (FL)', 'Hurricanes U'] }]);
        expect(m.matched).toEqual([]);
    });

    test('an acronym is tried as an abbreviation only when every name key missed, and only for an acronym', () => {
        // "Duke" is no acronym: a team abbreviated DUKE elsewhere must not claim it.
        const t = [team(1, 'Duke', 'ACC'), team(2, 'Delaware', 'CUSA', { abbreviation: 'DEL' })];
        expect(net.matchNet(rows([['DEL', 'CUSA'], ['Duke', 'ACC']]), t).matched.map(x => x.team.id)).toEqual([2, 1]);
        // "Penn" is a word, not an acronym, even though it IS some team's
        // abbreviation: only names that look like acronyms go to that index.
        const withPenn = [...t, team(3, 'Pennsylvania', 'Ivy', { abbreviation: 'Penn' })];
        const m = net.matchNet(rows([['Penn', 'Ivy'], ['XYZ', 'CUSA']]), withPenn);
        expect(m.unmatched.map(u => u.school)).toEqual(['Penn', 'XYZ']);
    });

    test('an alias is the ONLY key tried — a stale one fails rather than falling through', () => {
        const m = net.matchNet(rows([['Iowa St.', 'Big 12']]), TEAMS, { 'Iowa St.': 'Iowa State Cyclones of Ames' });
        expect(m.unmatched).toEqual([{ school: 'Iowa St.', candidates: [] }]);
    });

    test('two NCAA names on one team is a double claim', () => {
        const m = net.matchNet(rows([['Iowa St.', 'Big 12'], ['Iowa State', 'Big 12']]), TEAMS);
        expect(m.doubleClaimed).toEqual([{ school: 'Iowa State', by: ['Iowa St.', 'Iowa State'] }]);
    });

    test('a swapped pair is caught by the conference cross-check', () => {
        // The bijection is clean either way; only the conferences give it away.
        const t = [
            ...['A', 'B', 'C'].map((s, i) => team(10 + i, `ACC ${s}`, 'ACC')),
            ...['A', 'B', 'C'].map((s, i) => team(20 + i, `MAC ${s}`, 'MAC'))
        ];
        const aliases = { 'Swap One': 'MAC A', 'Swap Two': 'ACC A' };
        const m = net.matchNet(rows([['Swap One', 'ACC'], ['ACC B', 'ACC'], ['ACC C', 'ACC'],
            ['Swap Two', 'MAC'], ['MAC B', 'MAC'], ['MAC C', 'MAC']]), t, aliases);
        expect(m.unmatched).toEqual([]);
        expect(m.conferenceMismatches.map(c => c.school).sort()).toEqual(['ACC A', 'MAC A']);
    });

    test('the checked-in alias file sends no two NCAA names to one team', () => {
        // Two keys on one value would be a double claim on every run — the
        // job would refuse the whole NET until someone edited the file.
        const values = Object.values(net.NAME_ALIASES);
        expect(new Set(values).size).toBe(values.length);
    });
});

describe('expandAbbreviations', () => {
    test('spells out NCAA\'s abbreviations, including before a hyphen, and leaves St. alone', () => {
        expect(net.expandAbbreviations('Ark.-Pine Bluff')).toBe('Arkansas-Pine Bluff');
        expect(net.expandAbbreviations('N.C. A&T')).toBe('North Carolina A&T');
        expect(net.expandAbbreviations('Southeast Mo. St.')).toBe('Southeast Missouri St.');
        expect(net.expandAbbreviations('Boston U.')).toBe('Boston University');
        expect(net.expandAbbreviations('Xyz. Tech')).toBe('Xyz. Tech');
    });
});

describe('latestNet', () => {
    useMongo();
    beforeEach(() => net.clearNetCache());

    const netDoc = (week, teamId, rank) => ({
        season: 2027, week, teamId, rank, school: `T${teamId}`, record: { w: 5, l: 1 },
        quad1: { w: 1, l: 1 }, quad2: { w: 2, l: 0 }, quad3: { w: 1, l: 0 }, quad4: { w: 1, l: 0 },
        throughGames: new Date('2026-12-09T00:00:00Z')
    });

    test('the newest week on file — the latest fetch — for just the teams asked', async () => {
        await HoopsNetRank.create([netDoc(6, 1, 40), netDoc(7, 1, 12), netDoc(7, 2, 80), netDoc(7, 3, 5)]);
        expect(await net.latestNet(2027, [1, 2, 99])).toEqual({
            1: { rank: 12, record: { w: 5, l: 1 }, quads: [{ w: 1, l: 1 }, { w: 2, l: 0 }, { w: 1, l: 0 }, { w: 1, l: 0 }],
                throughGames: new Date('2026-12-09T00:00:00Z') },
            2: expect.objectContaining({ rank: 80 })
        });
    });

    test('a thin, part-written newest week is passed over for the whole one scoring uses', async () => {
        const HoopsTeam = require('../models/hoopsTeam');
        await HoopsTeam.create([1, 2, 3, 4, 5].map(id => ({ id, season: 2027, school: `T${id}`, preseason: { rank: id } })));
        await HoopsNetRank.create([...[1, 2, 3, 4, 5].map(id => netDoc(7, id, id)), netDoc(8, 1, 99)]);
        jest.spyOn(console, 'error').mockImplementation(() => {});
        expect((await net.latestNet(2027, [1]))['1'].rank).toBe(1);
        console.error.mockRestore();
    });

    test('cached per season for ten minutes; clearNetCache drops it', async () => {
        const t0 = Date.UTC(2026, 11, 10);
        await HoopsNetRank.create([netDoc(7, 1, 12)]);
        expect((await net.latestNet(2027, [1], t0))['1'].rank).toBe(12);
        await HoopsNetRank.create([netDoc(8, 1, 3)]);
        const find = jest.spyOn(HoopsNetRank, 'find');
        expect((await net.latestNet(2027, [1], t0 + net.NET_TTL_MS - 1))['1'].rank).toBe(12);
        expect(find).not.toHaveBeenCalled();
        expect((await net.latestNet(2027, [1], t0 + net.NET_TTL_MS))['1'].rank).toBe(3);
        await HoopsNetRank.create([netDoc(9, 1, 1)]);
        net.clearNetCache();
        expect((await net.latestNet(2027, [1], t0 + net.NET_TTL_MS + 1))['1'].rank).toBe(1);
        find.mockRestore();
    });

    test('nothing before the NET publishes, and nothing for a bad season or no teams', async () => {
        expect(await net.latestNet(2027, [1])).toEqual({});
        await HoopsNetRank.create([netDoc(7, 1, 12)]);
        net.clearNetCache();
        expect(await net.latestNet('x', [1])).toEqual({});
        expect(await net.latestNet(2027, [])).toEqual({});
        expect(await net.latestNet(2027, null)).toEqual({});
        expect(await net.latestNet(2026, [1])).toEqual({});
    });

    test('a row stored without its display fields reads as nulls, not a crash', async () => {
        await HoopsNetRank.create({ season: 2027, week: 7, teamId: 1, rank: 3 });
        expect(await net.latestNet(2027, [1])).toEqual({ 1: { rank: 3, record: null, quads: [null, null, null, null], throughGames: null } });
    });
});
