// Parsing Bart Torvik's preseason T-Rank and pairing it with our team rows (#320).
//
// The draft pool is ranked entirely from this import, so the failure that
// matters is not a crash — it is a team quietly not being in the pool, or
// being in it with another program's rating. Both are invisible in the output.

const path = require('path');
const { NAME_ALIASES, normaliseSchool, parseTRank, matchTeams } = require('../modules/torvik-pool');

// One row in Torvik's real shape: positional cells, the school in the link's
// query string rather than the cell text, and a national rank sharing the
// AdjOE/AdjDE cells.
const row = ({ rank = 2, team = 'Arizona', conf = 'B12', oe = '119.1', de = '91.8', bt = '.9521', rec = '23-7' } = {}) => `
<tr>
<td style="text-align:center;font-size:8px">${rank}</td>
<td class="teamname"><a href="team.php?team=${encodeURIComponent(team).replace(/%20/g, '+')}&amp;year=2027">${team}</a></td>
<td class="mobileout"><a href="conf.php?conf=${conf}&amp;year=2027">${conf}</a></td>
<td style="background-color:#AEDDBC">${oe}<span style="font-size:8px;"><br>11<span></span></span></td>
<td style="background-color:#A6D9B5">${de}<span style="font-size:8px;"><br>2<span></span></span></td>
<td>${bt}</td>
<td>${rec}</td>
<td class="mobileout">13-5</td>
<td class="mobileout">27.5%</td>
</tr>`;

const team = (school, conference = 'ACC') => ({ school, conference });

describe('parseTRank', () => {
    test('pulls the columns out of a row', () => {
        expect(parseTRank(row())).toEqual([{
            rank: 2, school: 'Arizona', conference: 'B12',
            adjOE: 119.1, adjDE: 91.8, barthag: 0.9521, projectedRecord: '23-7'
        }]);
    });

    test('takes the school from the LINK, not the cell text', () => {
        // In-season the cell text carries seed numbers and daggers; the href
        // never does. A parser reading the text drifts once the season starts.
        const decorated = row().replace('>Arizona</a>', '>2 Arizona †</a>');
        expect(parseTRank(decorated)[0].school).toBe('Arizona');
    });

    test('a multi-word school survives the URL encoding', () => {
        expect(parseTRank(row({ team: 'Michigan St.' }))[0].school).toBe('Michigan St.');
        expect(parseTRank(row({ team: 'Texas A&M Corpus Chris' }))[0].school).toBe('Texas A&M Corpus Chris');
    });

    test('AdjOE keeps the rating and drops the national rank sharing its cell', () => {
        // Both live in one <td>, so the cell reads "119.1 11" — the trailing
        // rank must not end up in the number.
        expect(parseTRank(row({ oe: '119.1' }))[0].adjOE).toBe(119.1);
        expect(parseTRank(row({ de: '91.8' }))[0].adjDE).toBe(91.8);
    });

    test('the header row and any short row are skipped, not parsed as teams', () => {
        const header = '<tr><td>Rk</td><td>Team</td><td>Conf</td></tr>';
        expect(parseTRank(header + row())).toHaveLength(1);
    });

    test('a row with no team link is skipped rather than yielding an undefined school', () => {
        const noLink = row().replace(/<a href="team\.php[^"]*">([^<]*)<\/a>/, '$1');
        expect(parseTRank(noLink)).toEqual([]);
    });

    test('an empty or non-table paste is an empty list, not a throw', () => {
        // The realistic mis-paste: the page copied without the table, or a
        // stray selection. It has to fail as "0 rows" at the import's own
        // count check, not as a TypeError with no context.
        expect(parseTRank('')).toEqual([]);
        expect(parseTRank('<p>nothing here</p>')).toEqual([]);
        expect(parseTRank('<tr><th>Rk</th><th>Team</th></tr>')).toEqual([]);
    });

    test('several rows come back in page order', () => {
        const html = row({ rank: 1, team: 'Duke' }) + row({ rank: 2, team: 'Arizona' });
        expect(parseTRank(html).map(r => r.rank)).toEqual([1, 2]);
    });
});

describe('normaliseSchool', () => {
    // The rewrite that covers 63 rows on its own. Written as \bSt\.\b first,
    // which matches nothing — there is no word boundary after a period — so
    // every one of them fell through to the alias table instead.
    test('St. becomes State', () => {
        expect(normaliseSchool('Michigan St.')).toBe(normaliseSchool('Michigan State'));
        expect(normaliseSchool('Weber St.')).toBe(normaliseSchool('Weber State'));
    });

    test('but a leading St. in a saint name is not mangled into a state', () => {
        // "St. Thomas" -> "State Thomas" is wrong, and it is why that one is in
        // the alias table rather than relying on the rewrite.
        expect(normaliseSchool('St. Thomas')).not.toBe(normaliseSchool('St Thomas'));
    });

    test('accents fold, so San José State meets San Jose St.', () => {
        expect(normaliseSchool('San José State')).toBe(normaliseSchool('San Jose St.'));
    });

    test("apostrophes go, so Hawai'i meets Hawaii", () => {
        expect(normaliseSchool("Hawai'i")).toBe(normaliseSchool('Hawaii'));
        expect(normaliseSchool('St. John’s')).toBe(normaliseSchool("St. John's"));
    });

    test('hyphens and spaces are the same thing', () => {
        expect(normaliseSchool('Gardner-Webb')).toBe(normaliseSchool('Gardner Webb'));
        expect(normaliseSchool('Arkansas-Pine Bluff')).toBe(normaliseSchool('Arkansas Pine Bluff'));
    });

    test('it does NOT collapse two different schools', () => {
        // The whole reason there is no fuzzy matching here.
        expect(normaliseSchool('Miami')).not.toBe(normaliseSchool('Miami (OH)'));
        expect(normaliseSchool('Connecticut')).not.toBe(normaliseSchool('Central Connecticut'));
        expect(normaliseSchool('Ohio')).not.toBe(normaliseSchool('Ohio State'));
        expect(normaliseSchool('Mississippi')).not.toBe(normaliseSchool('Mississippi State'));
    });
});

describe('matchTeams', () => {
    test('an exact name pairs up', () => {
        const got = matchTeams([{ rank: 1, school: 'Duke' }], [team('Duke')]);
        expect(got.matched).toHaveLength(1);
        expect(got.matched[0].team.school).toBe('Duke');
        expect(got.unmatched).toEqual([]);
        expect(got.unclaimed).toEqual([]);
    });

    test('a St. name pairs through the rewrite, with no alias entry', () => {
        const got = matchTeams([{ rank: 1, school: 'Michigan St.' }], [team('Michigan State')]);
        expect(got.matched[0].team.school).toBe('Michigan State');
        expect(NAME_ALIASES['Michigan St.']).toBeUndefined();
    });

    test('a renamed school pairs through the alias table', () => {
        const got = matchTeams([{ rank: 1, school: 'Connecticut' }], [team('UConn')]);
        expect(got.matched[0].team.school).toBe('UConn');
    });

    // The trap this module exists to avoid. Torvik ships both Miamis and both
    // Connecticuts; anything scoring candidates by similarity hands one team
    // the other's rating, and the pool looks entirely reasonable.
    test('the two Miamis do not swap', () => {
        const got = matchTeams(
            [{ rank: 40, school: 'Miami FL' }, { rank: 200, school: 'Miami OH' }],
            [team('Miami', 'ACC'), team('Miami (OH)', 'MAC')]
        );
        expect(got.unmatched).toEqual([]);
        const byTeam = Object.fromEntries(got.matched.map(m => [m.team.school, m.rating.rank]));
        expect(byTeam).toEqual({ 'Miami': 40, 'Miami (OH)': 200 });
    });

    test('Connecticut does not land on Central Connecticut', () => {
        const got = matchTeams(
            [{ rank: 12, school: 'Connecticut' }, { rank: 300, school: 'Central Connecticut' }],
            [team('UConn', 'Big East'), team('Central Connecticut', 'NEC')]
        );
        const byTeam = Object.fromEntries(got.matched.map(m => [m.team.school, m.rating.rank]));
        expect(byTeam).toEqual({ 'UConn': 12, 'Central Connecticut': 300 });
    });

    test('a name it cannot place is REPORTED, not dropped', () => {
        const got = matchTeams([{ rank: 1, school: 'Nowhere Tech' }], [team('Duke')]);
        expect(got.matched).toEqual([]);
        expect(got.unmatched).toEqual([{ school: 'Nowhere Tech', wanted: 'Nowhere Tech', candidates: 0 }]);
        // And the team nobody rated is named too — the half a caller forgets.
        expect(got.unclaimed).toEqual(['Duke']);
    });

    test('two rows claiming one team is reported rather than last-write-wins', () => {
        const got = matchTeams(
            [{ rank: 1, school: 'Duke' }, { rank: 99, school: 'Duke' }],
            [team('Duke')]
        );
        expect(got.matched).toHaveLength(1);
        expect(got.matched[0].rating.rank).toBe(1);
        expect(got.doubleClaimed).toEqual([{ school: 'Duke', by: ['Duke', 'Duke'] }]);
    });

    test('an ambiguous team side refuses rather than picking one', () => {
        // Two team rows normalising to the same key. The unique index makes
        // this impossible today; if it ever is, the import must stop.
        const got = matchTeams([{ rank: 1, school: 'Duke' }], [team('Duke', 'ACC'), team('Duke', 'SEC')]);
        expect(got.matched).toEqual([]);
        expect(got.unmatched[0].candidates).toBe(2);
    });
});

describe('the committed 2027 file', () => {
    // It is the input to a once-a-year import that runs days before the draft,
    // so a bad re-paste should fail here rather than at the keyboard.
    const stored = require(path.join('..', 'data', 'torvik-preseason-2027.json'));

    test('holds every D-I team, ranked 1..365 with no gaps', () => {
        expect(stored.season).toBe(2027);
        expect(stored.teams).toHaveLength(365);
        expect(stored.teams.map(t => t.rank).sort((a, b) => a - b))
            .toEqual(Array.from({ length: 365 }, (_, i) => i + 1));
    });

    test('every school is named once', () => {
        expect(new Set(stored.teams.map(t => t.school)).size).toBe(365);
    });

    test('the ratings are in a plausible range, so a column has not moved', () => {
        // A swapped AdjOE/AdjDE keeps the row count and the names, and only
        // shows up as the pool being upside down.
        for (const t of stored.teams) {
            expect(t.adjOE).toBeGreaterThan(70);
            expect(t.adjOE).toBeLessThan(140);
            expect(t.adjDE).toBeGreaterThan(70);
            expect(t.adjDE).toBeLessThan(140);
            expect(t.barthag).toBeGreaterThanOrEqual(0);
            expect(t.barthag).toBeLessThanOrEqual(1);
            expect(t.projectedRecord).toMatch(/^\d+-\d+$/);
        }
    });

    test('rank 1 is the best team, not the worst', () => {
        // barthag is win probability against an average team, so it has to
        // fall as the rank number rises. Catches a reversed sort.
        const first = stored.teams.find(t => t.rank === 1);
        const last = stored.teams.find(t => t.rank === 365);
        expect(first.barthag).toBeGreaterThan(last.barthag);
        expect(first.adjOE).toBeGreaterThan(last.adjOE);
        expect(first.adjDE).toBeLessThan(last.adjDE);
    });

    test('every alias is still needed, and still points somewhere real', () => {
        // An alias whose Torvik name is absent from the file is dead weight
        // that will be copied forward into next season's table.
        const names = new Set(stored.teams.map(t => t.school));
        const unused = Object.keys(NAME_ALIASES).filter(k => !names.has(k));
        expect(unused).toEqual([]);
    });
});
