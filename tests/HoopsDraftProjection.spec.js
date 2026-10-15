// The basketball projection wired for draft time (modules/hoops-draft-projection.js):
// pool selection, the game grouping that football's version gets wrong for
// HoopsGame rows, the board row, and the frozen-snapshot round trip.
//
// Pure-unit. Fixtures are asymmetric on purpose — different ratings, ranks,
// venues and weeks — so a swapped side or a dropped game changes a number.

const HD = require('../modules/hoops-draft-projection');
const { projectHoopsTeam, buildHoopsPoolContext } = require('../modules/hoops-projection');
const { attachMarch } = require('../modules/hoops-march');
const { resolveConfig } = require('../modules/scoring-defaults');

const cfg = resolveConfig('any-league', { model: 'hoops' });

const team = (id, rank, barthag, projectedRecord, conference = 'ACC', adjOE = 115, adjDE = 100) =>
    ({ id, school: `School ${id}`, conference, preseason: { rank, barthag, projectedRecord, adjOE, adjDE } });

const game = (id, home, away, week, extra = {}) => Object.assign({
    id, season: 2027, seasonType: 'regular', week, status: 'scheduled',
    homeTeamId: home, awayTeamId: away, neutralSite: false, conferenceGame: false
}, extra);

// A small country: five pool-calibre teams and a weak non-pool one.
const TEAMS = [
    team(10, 1, 0.96, '27-4', 'ACC', 124, 92),
    team(20, 2, 0.93, '25-6', 'Big Ten', 120, 94),
    team(30, 3, 0.85, '22-9', 'ACC', 116, 97),
    team(40, 45, 0.70, '19-12', 'Big Ten', 110, 101),
    team(50, 200, 0.30, '11-20', 'SWAC', 98, 108)
];
const GAMES = [
    game(1, 10, 20, 1), game(2, 30, 10, 1), game(3, 10, 50, 2),
    game(4, 20, 40, 2), game(5, 40, 30, 3), game(6, 50, 20, 3),
    game(7, 30, 50, 4), game(8, 40, 10, 4, { neutralSite: true }), game(9, 10, 30, 5)
];

describe('poolOf', () => {
    it('is ranked teams, best rank first, ties broken by id, capped', () => {
        const teams = [team(9, 3), team(4, 1), team(7, 3), team(2, null), team(5, 2)];
        expect(HD.poolOf(teams, 3).map(t => t.id)).toEqual([4, 5, 7]);
        expect(HD.poolOf(teams, null).map(t => t.id)).toEqual([4, 5, 7, 9]);
    });

    it('leaves out a team whose rank is not a number', () => {
        const teams = [team(1, 1), team(2, '2'), team(3, NaN), { id: 4 }];
        expect(HD.poolOf(teams, 10).map(t => t.id)).toEqual([1]);
    });
});

describe('groupHoopsGamesByTeam', () => {
    it('keys on homeTeamId / awayTeamId — a HoopsGame has no homeId', () => {
        const by = HD.groupHoopsGamesByTeam(GAMES, new Set(['10', '40']));
        expect(by['10'].map(g => g.id)).toEqual([1, 2, 3, 8, 9]);
        expect(by['40'].map(g => g.id)).toEqual([4, 5, 8]);
        expect(by['20']).toBeUndefined();
    });
});

describe('projectHoopsTeams', () => {
    const proj = HD.projectHoopsTeams(TEAMS, GAMES, { cfg, projectIds: [10, 40] });

    it('projects only the ids asked for', () => {
        expect(Object.keys(proj).sort()).toEqual(['10', '40']);
    });

    // The trap #554 named: fed football's grouping, every game is dropped and
    // every regular season projects to 0.
    it('projects a real regular season from the team\'s games', () => {
        expect(proj['10'].regular).toBeGreaterThan(0);
        expect(proj['10'].perGame).toHaveLength(5);
        expect(proj['40'].perGame).toHaveLength(3);
    });

    it('is the engine\'s own answer, graded on the preseason ranks', () => {
        const ranks = { 10: 1, 20: 2, 30: 3, 40: 45, 50: 200 };
        const ctx = attachMarch(buildHoopsPoolContext(TEAMS, { ranks, cfg }), TEAMS);
        const mine = GAMES.filter(g => g.homeTeamId === 40 || g.awayTeamId === 40);
        const direct = projectHoopsTeam(TEAMS[3], mine, ctx, { perGame: true });
        expect(proj['40'].total).toBeCloseTo(direct.total, 10);
        expect(proj['40'].postseason).toBeCloseTo(direct.postseason, 10);
    });

    it('carries the March estimate (postseason > 0 for the #1 team)', () => {
        expect(proj['10'].postseason).toBeGreaterThan(proj['10'].confChamp);
        expect(proj['10'].makeProb).toBeGreaterThan(0.5);
    });

    it('skips an id with no team row', () => {
        expect(HD.projectHoopsTeams(TEAMS, GAMES, { cfg, projectIds: [999] })).toEqual({});
    });
});

describe('perWeekOf', () => {
    it('divides by the WEEKS played, not the games — the Captain doubles a week', () => {
        const p = { regular: 12, perGame: [{ week: 1 }, { week: 1 }, { week: 2 }, { week: null }] };
        expect(HD.perWeekOf(p)).toBe(6);
        expect(HD.perWeekOf({ regular: 5, perGame: [] })).toBe(0);
    });
});

describe('boardRow', () => {
    it('puts the whole basketball postseason in post, not football\'s three terms', () => {
        const p = { total: 30, regular: 20, postseason: 10, confChamp: 1, cfp: 0, bowl: 0, projWins: 18.26,
            makeProb: 0.876, perGame: [{ week: 1 }, { week: 2 }] };
        const row = HD.boardRow(TEAMS[2], p, 'logo.png');
        expect(row).toEqual({
            id: 30, school: 'School 30', conference: 'ACC', logo: 'logo.png',
            total: 30, regular: 20, post: 10, perWeek: 10, wins: 18.3, makeProb: 0.88,
            rank: 3, projectedRecord: '22-9', games: 2
        });
    });

    it('says null for an unknown make-the-field probability', () => {
        const row = HD.boardRow({ id: 1, school: 'X' }, { total: 0, regular: 0, postseason: 0, projWins: 0, makeProb: null });
        expect(row.makeProb).toBeNull();
        expect(row.conference).toBeNull();
        expect(row.logo).toBeNull();
    });
});

describe('thinSchedules', () => {
    const p = (n) => ({ perGame: Array.from({ length: n }, (_, i) => ({ week: i })) });

    it('names teams under 75% of the median schedule, shortest first', () => {
        const proj = { 1: p(30), 2: p(31), 3: p(29), 4: p(14), 5: p(22), 6: p(23), 7: p(9) };
        // median 23 → under 17.25 is thin; 22 and 23 are not
        expect(HD.thinSchedules(proj, [{ id: 4, school: 'Saint Louis' }, { id: 7, school: 'Oregon State' }]))
            .toEqual([{ id: 7, school: 'Oregon State', games: 9 }, { id: 4, school: 'Saint Louis', games: 14 }]);
    });

    it('a full slate everywhere is nothing to report', () => {
        expect(HD.thinSchedules({ 1: p(30), 2: p(28), 3: p(31) }, [])).toEqual([]);
        expect(HD.thinSchedules({}, [])).toEqual([]);
        expect(HD.thinSchedules({ 1: p(30), 2: p(3) }, null)).toEqual([{ id: 2, school: null, games: 3 }]);
    });
});

describe('the frozen snapshot', () => {
    it('round-trips to the exact same projection', () => {
        const live = HD.projectHoopsTeams(TEAMS, GAMES, { cfg, projectIds: [10, 20, 30, 40] });
        const back = HD.fromSnapshot({ teams: HD.snapshotTeams(TEAMS), games: HD.snapshotGames(GAMES) });
        const frozen = HD.projectHoopsTeams(back.teams, back.games, { cfg, projectIds: [10, 20, 30, 40] });
        ['10', '20', '30', '40'].forEach(id => {
            expect(frozen[id].total).toBeCloseTo(live[id].total, 10);
        });
    });

    it('keeps only the projection\'s game fields', () => {
        const [row] = HD.snapshotGames([Object.assign(game(1, 10, 20, 1), { homePoints: 80, venue: 'X', _id: 'abc' })]);
        expect(row).not.toHaveProperty('homePoints');
        expect(row).not.toHaveProperty('venue');
        expect(row).not.toHaveProperty('_id');
        expect(row).toEqual(expect.objectContaining({ id: 1, homeTeamId: 10, awayTeamId: 20, week: 1, status: 'scheduled' }));
    });

    it('carries every team\'s rating and rank, and drops a row with no id', () => {
        const rows = HD.snapshotTeams([TEAMS[0], null, { school: 'no id' }]);
        expect(rows).toEqual([{ id: 10, school: 'School 10', conference: 'ACC', rank: 1, barthag: 0.96,
            adjOE: 124, adjDE: 92, projectedRecord: '27-4' }]);
        expect(HD.fromSnapshot(null)).toEqual({ teams: [], games: [] });
    });
});
