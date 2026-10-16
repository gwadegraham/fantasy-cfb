// `decided` from HoopsGame rows (#310 PR 5): what a team's postseason has
// already settled, so the projection never expects banked points again.
// Every state built here must be one the March model accepts — it throws on
// anything else — and every oddity must err towards expecting LESS.

const { decidedFor, ncaaField } = require('../modules/hoops-postseason-state');
const { defaultModel } = require('../modules/hoops-march');
const { resolveConfig } = require('../modules/scoring-defaults');

const T = 7;
let id = 0;
function g(home, away, o = {}) {
    id += 1;
    const status = o.status || 'final';
    const homeWon = o.homeWon !== false;
    return Object.assign({
        id, season: 2027, seasonType: 'regular', status, homeTeamId: home, awayTeamId: away,
        homePoints: status === 'final' ? (homeWon ? 80 : 70) : null,
        awayPoints: status === 'final' ? (homeWon ? 70 : 80) : null,
        conferenceGame: false, tournament: null, gameNotes: null
    }, o);
}
// A conference-tournament game, filed as regular season (CBBD), won by `home`
// unless homeWon:false.
const ct = (home, away, round, o) => g(home, away, Object.assign({ conferenceGame: true, gameNotes: `Big East Tournament - ${round}` }, o));
const ncaa = (home, away, label, o) => g(home, away, Object.assign({
    seasonType: 'postseason', tournament: 'NCAA', gameNotes: `NCAA Men's Basketball Championship - East - ${label}`
}, o));

describe('the conference tournament', () => {
    test('not started: no state', () => {
        expect(decidedFor(T, [g(T, 2)], null).decided).toEqual({});
    });
    test('won two, still alive', () => {
        expect(decidedFor(T, [ct(T, 2, 'Quarterfinal'), ct(T, 3, 'Semifinal'), ct(T, 4, 'Final', { status: 'scheduled' })], null)
            .decided).toEqual({ confTourney: { wins: 2, alive: true } });
    });
    test('knocked out after one win', () => {
        expect(decidedFor(T, [ct(T, 2, 'Quarterfinal'), ct(T, 3, 'Semifinal', { homeWon: false })], null)
            .decided).toEqual({ confTourney: { wins: 1, alive: false } });
    });
    test('as the AWAY side: a win is a win', () => {
        expect(decidedFor(T, [ct(2, T, 'Quarterfinal', { homeWon: false })], null)
            .decided).toEqual({ confTourney: { wins: 1, alive: true } });
    });
    test('won the final: over (the title is banked)', () => {
        expect(decidedFor(T, [ct(T, 2, 'Semifinal'), ct(T, 3, 'Final')], null).decided).toEqual({ confTourney: 'over' });
    });
    test('lost the final: over too', () => {
        const s = decidedFor(T, [ct(T, 2, 'Semifinal'), ct(T, 3, 'Final', { homeWon: false })], null).decided;
        expect(s.confTourney.alive).toBe(false);
    });
    test('an early-season event with a tournament code is NOT a conference tournament (the scoring definition)', () => {
        // conferenceGame and a named tournament: hoops-detectors says it is
        // somebody else's tournament, and so does this.
        expect(decidedFor(T, [g(T, 2, { conferenceGame: true, tournament: 'NIT Season Tip-Off', gameNotes: 'Championship' })], null)
            .decided).toEqual({});
    });
});

describe('the NCAA tournament', () => {
    test('before the bracket: no state', () => {
        expect(decidedFor(T, [g(T, 2)], null).decided).toEqual({});
    });
    test('the bracket is out and the team is not in it: out', () => {
        const field = ncaaField([ncaa(1, 2, '1st Round', { status: 'scheduled' })]);
        expect(decidedFor(T, [g(T, 2)], field).decided).toEqual({ ncaa: 'out' });
    });
    test('selected, nothing played: next is the round it is listed in', () => {
        const rows = [ncaa(T, 2, '1st Round', { status: 'scheduled' })];
        expect(decidedFor(T, rows, ncaaField(rows)).decided).toEqual({ ncaa: { next: 'r64' } });
    });
    test('a First Four team', () => {
        const rows = [ncaa(T, 2, 'First Four', { status: 'scheduled' })];
        expect(decidedFor(T, rows, ncaaField(rows)).decided).toEqual({ ncaa: { next: 'ff' } });
    });
    test('won through the Sweet 16: next is the Elite 8, before it is even listed', () => {
        const rows = [ncaa(T, 2, '1st Round'), ncaa(3, T, '2nd Round', { homeWon: false }), ncaa(T, 4, 'Sweet 16')];
        expect(decidedFor(T, rows, ncaaField(rows)).decided).toEqual({ ncaa: { next: 'e8' } });
    });
    test('lost in the second round: out', () => {
        const rows = [ncaa(T, 2, '1st Round'), ncaa(T, 3, '2nd Round', { homeWon: false })];
        expect(decidedFor(T, rows, ncaaField(rows)).decided).toEqual({ ncaa: 'out' });
    });
    test('won the title game: done', () => {
        const rows = ['1st Round', '2nd Round', 'Sweet 16', 'Elite 8', 'Final Four'].map((l, i) => ncaa(T, 10 + i, l))
            .concat([ncaa(T, 20, 'National Championship')]);
        expect(decidedFor(T, rows, ncaaField(rows)).decided).toEqual({ ncaa: 'done' });
    });
    test('the NIT uses the same round names and is not the NCAA', () => {
        const nit = [g(T, 2, { seasonType: 'postseason', tournament: 'NIT', gameNotes: 'NIT - 1st Round' })];
        expect(decidedFor(T, nit, null).decided).toEqual({});
    });

    test('INCONSISTENT rows: a win listed after a loss is still out', () => {
        const rows = [ncaa(T, 2, '1st Round', { homeWon: false }), ncaa(T, 3, '2nd Round')];
        expect(decidedFor(T, rows, ncaaField(rows)).decided).toEqual({ ncaa: 'out' });
    });
    test('an NCAA win we cannot place: done (expect nothing more), and reported', () => {
        const rows = [ncaa(T, 2, 'Regional Semifinal')];
        const r = decidedFor(T, rows, ncaaField(rows));
        expect(r.decided).toEqual({ ncaa: 'done' });
        expect(r.anomalies).toEqual([{ teamId: T, kind: 'ncaa-round-unreadable' }]);
    });
    test('an unplayed NCAA game we cannot place: done, reported', () => {
        const rows = [ncaa(T, 2, 'Opening Round', { status: 'scheduled' })];
        const r = decidedFor(T, rows, ncaaField(rows));
        expect(r.decided).toEqual({ ncaa: 'done' });
        expect(r.anomalies).toHaveLength(1);
    });
    test('ncaaField: null with no NCAA rows, and team ids otherwise', () => {
        expect(ncaaField([])).toBeNull();
        expect(ncaaField([g(1, 2)])).toBeNull();
        expect([...ncaaField([ncaa(1, 2, '1st Round'), ncaa(3, null, 'First Four')])].sort()).toEqual([1, 2, 3]);
    });
});

describe('every derived state is one the March model accepts', () => {
    const model = defaultModel();
    const cfg = resolveConfig('x', { model: 'hoops' });
    const ctx = model.contextFor([{ id: T, conference: 'BE', rating: 20 }]);
    const labels = ['First Four', '1st Round', '2nd Round', 'Sweet 16', 'Elite 8', 'Final Four', 'National Championship', '???'];
    test('across conference and NCAA paths (no throw, ever)', () => {
        const cases = [];
        labels.forEach(l => [true, false].forEach(won => ['final', 'scheduled'].forEach(status => {
            const rows = [ncaa(T, 2, l, { homeWon: won, status })];
            cases.push({ rows, field: ncaaField(rows) });
        })));
        ['Quarterfinal', 'Final'].forEach(r => [true, false].forEach(won => cases.push({ rows: [ct(T, 2, r, { homeWon: won })], field: null })));
        cases.push({ rows: [], field: ncaaField([ncaa(1, 2, '1st Round')]) });
        cases.forEach(({ rows, field }) => {
            const { decided } = decidedFor(T, rows, field);
            expect(() => model.expectedPostseason({ id: T, rank: 10 }, ctx, cfg, 'preseason', decided)).not.toThrow();
        });
    });
});
