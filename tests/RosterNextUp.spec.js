// public/roster-next-up.js — My Team's Roster tile before any points are
// banked (#638): one logo row per team with a game still to play this week,
//   [your logo] [2× if Captain] vs [their logo] · tip
// then "+N more". Pure: games in, rows and markup out.

global.ccKickoff = require('../public/kickoff-day.js');
const nu = require('../public/roster-next-up.js');

const team = (id, school) => ({ id, school, logos: ['/logo/' + id + '.png'] });
const side = (id, o) => Object.assign({ id, team: 'School ' + id, logo: '/opp/' + id + '.png' }, o || {});
const game = (id, startDate, home, away, o) => Object.assign(
    { id, state: 'pre', startDate, startTimeTbd: false, home: side(home), away: side(away) }, o || {});
const logoOf = t => t.logos[0];

const ROSTER = [team(1, 'Kansas'), team(2, 'Duke'), team(3, 'Gonzaga')];

describe('rows', () => {
    it('gives each team its next game, in tip order across the roster', () => {
        const rows = nu.rows(ROSTER, [
            game(10, '2026-11-05T00:00:00Z', 1, 90),
            game(11, '2026-11-03T23:00:00Z', 91, 2),
            game(12, '2026-11-04T01:00:00Z', 3, 92)
        ]);
        expect(rows.map(r => r.team.id)).toEqual([2, 3, 1]);
        expect(rows[0].them.id).toBe(91);           // Duke is away: the opponent is home
        expect(rows[1].them.id).toBe(92);
    });

    it('skips a team\'s finished game for its next one, and drops a team with none left', () => {
        const rows = nu.rows(ROSTER, [
            game(10, '2026-11-03T00:00:00Z', 1, 90, { state: 'final' }),
            game(13, '2026-11-06T00:00:00Z', 1, 93),
            game(11, '2026-11-03T23:00:00Z', 2, 91, { state: 'final' }),
            game(14, '2026-11-07T00:00:00Z', 3, 94, { notes: 'Postponed' })
        ]);
        expect(rows.map(r => [r.team.id, r.game.id])).toEqual([[1, 13]]);
    });

    it('puts a live game first', () => {
        const rows = nu.rows(ROSTER, [
            game(10, '2026-11-03T00:00:00Z', 1, 90),
            game(11, '2026-11-02T23:00:00Z', 2, 91, { state: 'live' })
        ]);
        expect(rows[0].team.id).toBe(2);
    });

    it('does not badge the Captain on a game Captain does not double', () => {
        const rows = nu.rows(ROSTER, [game(10, '2026-11-03T00:00:00Z', 1, 90, { modeGame: false })], 1);
        expect(rows[0].captain).toBe(false);
    });

    it('leads with the Captain, even when it tips last, so it never hides behind "+N more"', () => {
        const rows = nu.rows(ROSTER, [
            game(10, '2026-11-03T00:00:00Z', 1, 90),
            game(11, '2026-11-02T23:00:00Z', 2, 91, { state: 'live' }),
            game(12, '2026-11-09T00:00:00Z', 3, 92)
        ], 3);
        expect(rows.map(r => r.team.id)).toEqual([3, 2, 1]);
    });

    it('marks only the Captain, matching ids across number and string', () => {
        const rows = nu.rows(ROSTER, [game(10, '2026-11-03T00:00:00Z', 1, 90), game(11, '2026-11-04T00:00:00Z', 2, 91)], '2');
        expect(rows.map(r => [r.team.id, r.captain])).toEqual([[2, true], [1, false]]);
    });

    it('is empty with no games', () => {
        expect(nu.rows(ROSTER, [])).toEqual([]);
        expect(nu.rows(ROSTER, undefined)).toEqual([]);
    });
});

describe('html', () => {
    const games = [1, 2, 3, 4, 5, 6].map(i => game(100 + i, `2026-11-0${i + 2}T23:00:00Z`, i, 200 + i));
    const roster = [1, 2, 3, 4, 5, 6].map(i => team(i, 'S' + i));

    it('shows logos, not school names, and caps at four rows then "+N more"', () => {
        const out = nu.html(nu.rows(roster, games, 1), { logoOf });
        expect((out.match(/class="uh-nu-row/g) || [])).toHaveLength(4);
        expect(out).toContain('+2 more');
        expect(out).toContain('src="/logo/1.png"');
        expect(out).toContain('src="/opp/201.png"');
        expect(out).toContain('<span class="uh-nu-vs">vs</span>');
        // School names live only in alt text, never as visible copy.
        expect(out.replace(/<[^>]*>/g, '')).not.toMatch(/School|S1/);
    });

    it('badges the Captain row with the league\'s multiplier, and only that row', () => {
        const out = nu.html(nu.rows(roster, games, 3), { logoOf, multiplier: 2 });
        expect((out.match(/uh-nu-cap/g) || [])).toHaveLength(1);
        const row3 = out.split('uh-nu-row').find(r => r.includes('/logo/3.png'));
        expect(row3).toContain('>2×</span>');
    });

    it('has no "+N more" when everything fits', () => {
        expect(nu.html(nu.rows(roster.slice(0, 2), games), { logoOf })).not.toContain('more');
    });

    it('is empty with nothing to show, so the caller keeps its fallback', () => {
        expect(nu.html([], { logoOf })).toBe('');
    });

    it('escapes what it prints', () => {
        const r = nu.rows([team(1, '<b>')], [game(1, '2026-11-03T23:00:00Z', 1, 2, {
            away: side(2, { logo: '"><script>', team: '<i>' })
        })]);
        const out = nu.html(r, { logoOf });
        expect(out).not.toContain('<script>');
        expect(out).not.toContain('<b>');
        expect(out).not.toContain('<i>');
    });
});

describe('whenText', () => {
    it('reads Live, a TBD day, or the day and tip', () => {
        expect(nu.whenText({ state: 'live' })).toBe('Live');
        expect(nu.whenText({ state: 'pre', startDate: '2026-11-04T05:00:00Z', startTimeTbd: true })).toBe('Wed TBD');
        expect(nu.whenText({ state: 'pre', startDate: 'nonsense' })).toBe('TBD');
        expect(nu.whenText({ state: 'pre', startDate: '2026-11-04T00:30:00Z' })).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2}(AM|PM)$/);
    });
});
