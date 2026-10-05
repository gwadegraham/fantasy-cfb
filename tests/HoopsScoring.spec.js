// The basketball scoring model, through the REAL engine (#316).
//
// The walk is football's, untouched — resolveConfig, combineMode, the
// additive postseason pass, the disabled/enabled lists. What is new is the
// context, the condition vocabulary and the values. So these go through
// evaluate() rather than calling the detectors directly: a condition that is
// correct but never reached by the walk scores nothing.

const { useMongo } = require('./helpers/mongo');
const { evaluate } = require('../modules/scoring');
const { resolveConfig, MODELS } = require('../modules/scoring-defaults');
const { buildHoopsContext, ncaaRoundFor, isConfTournamentFinal, seedUpsetFor } = require('../modules/hoops-detectors');

const cfg = (overrides) => resolveConfig('any-league', Object.assign({ model: 'hoops' }, overrides));

// Home team 1 beats away team 2 unless told otherwise.
const game = (o = {}) => Object.assign({
    homeTeamId: 1, awayTeamId: 2, homePoints: 80, awayPoints: 70,
    conferenceGame: false, neutralSite: false
}, o);

const score = (teamId, g, ranks, c) => evaluate('hoops', teamId, g, ranks || {}, c || cfg());

describe('a regular-season win is worth its quadrant', () => {
    test.each([
        ['#10 at home', 1, { 2: 10 }, {}, 5],
        ['#50 at home', 1, { 2: 50 }, {}, 3],
        ['#100 at home', 1, { 2: 100 }, {}, 1],
        ['#300 at home', 1, { 2: 300 }, {}, 0]
    ])('%s is worth %i', (_label, team, ranks, over, expected) => {
        expect(score(team, game(over), ranks)).toBe(expected);
    });

    test('the same opponent is worth more on the road', () => {
        // #100: a Q3 win at home, a Q2 win away. The entire point of venue.
        const atHome = score(1, game(), { 2: 100 });
        const away = score(2, game({ homePoints: 70, awayPoints: 80 }), { 1: 100 });
        expect(atHome).toBe(1);
        expect(away).toBe(3);
    });

    test('a neutral site is scored as neutral for both teams', () => {
        // #40 is Q2 at home but Q1 at a neutral site.
        expect(score(1, game(), { 2: 40 })).toBe(3);
        expect(score(1, game({ neutralSite: true }), { 2: 40 })).toBe(5);
    });

    test('a loss scores nothing by default', () => {
        expect(score(1, game({ homePoints: 60, awayPoints: 70 }), { 2: 10 })).toBe(0);
        expect(score(1, game({ homePoints: 60, awayPoints: 70 }), { 2: 300 })).toBe(0);
    });

    test('a team that is not in the game scores nothing', () => {
        expect(score(99, game(), { 2: 10 })).toBe(0);
    });

    test('an unranked opponent is a Q4 win, not an error', () => {
        expect(score(1, game(), {})).toBe(0);
        expect(score(1, game(), { 2: null })).toBe(0);
    });
});

describe('the bad-loss penalty', () => {
    // The only rule that subtracts, so it is off unless a league opts in.
    test('is off by default', () => {
        expect(score(1, game({ homePoints: 60, awayPoints: 70 }), { 2: 300 })).toBe(0);
    });

    test('and costs points once enabled', () => {
        const on = cfg({ enabled: ['badLoss'] });
        expect(score(1, game({ homePoints: 60, awayPoints: 70 }), { 2: 300 }, on)).toBe(-2);
    });

    test('but only for a Q4 loss — losing to a good team is free', () => {
        const on = cfg({ enabled: ['badLoss'] });
        expect(score(1, game({ homePoints: 60, awayPoints: 70 }), { 2: 10 }, on)).toBe(0);
    });

    test('and never turns a win into a penalty', () => {
        const on = cfg({ enabled: ['badLoss'] });
        expect(score(1, game(), { 2: 300 }, on)).toBe(0);
    });
});

describe('the NCAA ladder', () => {
    const round = (tournament, o = {}) => game(Object.assign({ neutralSite: true, tournament }, o));

    const RUNGS = [
        ['NCAA Tournament First Round', 7],
        ['NCAA Tournament Second Round', 9],
        ['NCAA Tournament Sweet Sixteen', 12],
        ['NCAA Tournament Elite Eight', 16],
        ['NCAA Tournament Final Four', 21]
    ];

    test.each(RUNGS)('%s is worth %i, win or lose', (tournament, points) => {
        // Every rung but the last is an APPEARANCE: reaching the round is
        // what is paid for, because reaching it is what the draft pick did.
        expect(score(1, round(tournament))).toBe(points);
        expect(score(1, round(tournament, { homePoints: 60, awayPoints: 70 }))).toBe(points);
    });

    test('the title game pays for reaching it, and again for winning it', () => {
        const t = 'NCAA Tournament National Championship';
        expect(score(1, round(t, { homePoints: 60, awayPoints: 70 }))).toBe(26);
        expect(score(1, round(t))).toBe(26 + 35);
    });

    test('a champion banks exactly 126 across the six games', () => {
        // The number the model was designed around, for 12-team rosters.
        const run = [...RUNGS.map(([t]) => t), 'NCAA Tournament National Championship'];
        const total = run.reduce((sum, t) => sum + score(1, round(t)), 0);
        expect(total).toBe(126);
    });

    test('and a one-and-done banks 7', () => {
        expect(score(1, round('NCAA Tournament First Round', { homePoints: 60, awayPoints: 70 }))).toBe(7);
    });

    test('a tournament game is NOT also scored as a quadrant win', () => {
        // Beating a #1 seed in the Sweet Sixteen is worth the round, not the
        // round plus a Q1 win.
        expect(score(1, round('NCAA Tournament Sweet Sixteen'), { 2: 1 })).toBe(12);
    });
});

describe('a conference tournament title', () => {
    test('pays for winning the final', () => {
        expect(score(1, game({ neutralSite: true, tournament: 'ACC Conference Tournament Championship' }))).toBe(10);
    });

    test('and not for losing it', () => {
        expect(score(1, game({ neutralSite: true, tournament: 'ACC Conference Tournament Championship', homePoints: 60, awayPoints: 70 }))).toBe(0);
    });

    test('an earlier round of the same tournament is a regular game', () => {
        // Only the FINAL is the title. A quarterfinal scores on quadrant.
        expect(score(1, game({ neutralSite: true, tournament: 'ACC Conference Tournament Quarterfinal' }), { 2: 10 })).toBe(5);
    });
});

describe('the seed upset bonus', () => {
    const r64 = (o) => game(Object.assign({ neutralSite: true, tournament: 'NCAA Tournament First Round' }, o));

    test('adds the seed difference on top of the round', () => {
        // A 12 beating a 5 is seven seeds better: 7 for the round + 7.
        expect(score(1, r64({ homeSeed: 12, awaySeed: 5 }))).toBe(14);
    });

    test('a favourite winning gets nothing extra', () => {
        expect(score(1, r64({ homeSeed: 5, awaySeed: 12 }))).toBe(7);
    });

    test('losing to a better seed is not an upset', () => {
        expect(score(1, r64({ homeSeed: 12, awaySeed: 5, homePoints: 60, awayPoints: 70 }))).toBe(7);
    });

    test('and seeds that are simply absent score the round alone', () => {
        // Which is every game CBBD has given us so far — seeds arrive in March.
        expect(score(1, r64())).toBe(7);
    });

    test('it scales, rather than paying a flat bonus', () => {
        const small = score(1, r64({ homeSeed: 9, awaySeed: 8 }));
        const big = score(1, r64({ homeSeed: 16, awaySeed: 1 }));
        expect(small).toBe(7 + 1);
        expect(big).toBe(7 + 15);
    });
});

describe('gameType TRNMNT is NOT the NCAA tournament', () => {
    // 107 of the ingested games carry it, every one of them a November or
    // December multi-team event: the Hall of Fame Tip-Off, the Veterans
    // Classic, Showdown in St. Pete. Reading it as "tournament" would score
    // an exhibition as an NCAA appearance — 7 points, banked permanently.
    test('a November multi-team event scores on quadrant', () => {
        const g = game({ gameType: 'TRNMNT', neutralSite: true, gameNotes: 'Hall of Fame Tip-Off' });
        expect(score(1, g, { 2: 10 })).toBe(5);
    });

    test('and is not a round', () => {
        expect(ncaaRoundFor({ gameType: 'TRNMNT', gameNotes: 'Veterans Classic' })).toBeNull();
        expect(ncaaRoundFor({ gameType: 'TRNMNT' })).toBeNull();
    });

    test('the NIT is not the NCAA tournament', () => {
        // THE case the marker guard exists for. "First Round" and "Second
        // Round" are the NIT's round names too, and without requiring an
        // NCAA marker an NIT first-round game would bank 7 points as an NCAA
        // appearance. The round names alone are not enough.
        expect(ncaaRoundFor({ tournament: 'NIT First Round' })).toBeNull();
        expect(ncaaRoundFor({ tournament: 'NIT Second Round' })).toBeNull();
        expect(ncaaRoundFor({ tournament: 'CBI Championship', gameNotes: 'Final Four' })).toBeNull();
        expect(score(1, game({ neutralSite: true, tournament: 'NIT First Round' }), { 2: 10 })).toBe(5);
    });

    test('an unrecognised tournament string is not a round either', () => {
        // Refusing to guess: an unknown shape scores as a regular game
        // rather than inventing a tournament run.
        expect(ncaaRoundFor({ tournament: 'Some Holiday Classic' })).toBeNull();
        expect(ncaaRoundFor({ tournament: 'NCAA Tournament' })).toBeNull();   // no round named
        expect(ncaaRoundFor(null)).toBeNull();
    });

    test('and a conference tournament is not an NCAA round', () => {
        expect(ncaaRoundFor({ tournament: 'ACC Conference Tournament Championship' })).toBeNull();
        expect(isConfTournamentFinal({ tournament: 'NCAA Tournament First Round' })).toBe(false);
    });
});

describe('the context itself', () => {
    test('carries what the rules read', () => {
        const ctx = buildHoopsContext(1, game({ conferenceGame: true }), { 2: 10 });
        expect(ctx).toMatchObject({
            team: 1, won: true, played: true, venue: 'home',
            quadrant: 1, oppRank: 10, isConference: true, isRegular: true, round: null, seedUpset: 0
        });
    });

    test('the quadrant rules refuse a tournament game at the CONDITION level', () => {
        // The engine already stops before the quadrant rules once a
        // postseason rule matches, so this is belt and braces — and worth
        // pinning, because the belt is invisible from here and a future
        // reorder of the walk would quietly remove it.
        const { HOOPS_CONDITIONS } = require('../modules/hoops-detectors');
        const ctx = buildHoopsContext(1, game({ neutralSite: true, tournament: 'NCAA Tournament Sweet Sixteen' }), { 2: 1 });
        expect(ctx.quadrant).toBe(1);
        expect(HOOPS_CONDITIONS.q1Win(ctx)).toBe(false);
        const conf = buildHoopsContext(1, game({ tournament: 'ACC Conference Tournament Championship' }), { 2: 1 });
        expect(HOOPS_CONDITIONS.q1Win(conf)).toBe(false);
    });

    test('a tournament game is not a regular-season game', () => {
        const ctx = buildHoopsContext(1, game({ tournament: 'NCAA Tournament Final Four' }), {});
        expect(ctx.round).toBe('f4');
        expect(ctx.isRegular).toBe(false);
    });

    test('no ranks map at all is a Q4 win, not a crash', () => {
        // The projection and the draft grader both call this with ranks they
        // assemble themselves, and one of them can legitimately have none.
        const ctx = buildHoopsContext(1, game(), null);
        expect(ctx.quadrant).toBe(4);
        // null rather than 0. The score does not care — quadrantFor rejects
        // anything below 1 — but this field is shown beside the quadrant,
        // and "#0" is not a rank.
        expect(ctx.oppRank).toBeNull();
        expect(buildHoopsContext(1, game(), {}).oppRank).toBeNull();
        expect(buildHoopsContext(1, game(), { 2: '' }).oppRank).toBeNull();
        expect(buildHoopsContext(1, game(), { 2: 0 }).oppRank).toBe(0);     // a real 0 is kept
        expect(evaluate('hoops', 1, game(), null, cfg())).toBe(0);
    });

    test('a missing game is not a conference final', () => {
        expect(isConfTournamentFinal(null)).toBe(false);
        expect(isConfTournamentFinal(undefined)).toBe(false);
    });

    test('seedUpsetFor needs a win and two seeds', () => {
        const g = game({ homeSeed: 12, awaySeed: 5 });
        expect(seedUpsetFor(1, g, true)).toBe(7);
        expect(seedUpsetFor(1, g, false)).toBe(0);
        expect(seedUpsetFor(1, game({ homeSeed: 12 }), true)).toBe(0);
        expect(seedUpsetFor(1, null, true)).toBe(0);
    });
});

describe('the model is wired up', () => {
    test('hoops is a real model with defaults and a structure', () => {
        expect(MODELS.hoops.structure.combineMode).toBe('sum');
        expect(MODELS.hoops.defaults.q1Win).toBe(5);
    });

    test('every condition a rule names actually exists', () => {
        // A typo here is a rule that silently never fires.
        const { HOOPS_CONDITIONS } = require('../modules/hoops-detectors');
        const rules = [...MODELS.hoops.structure.regularWin, ...MODELS.hoops.structure.postseason];
        for (const r of rules) {
            expect(typeof HOOPS_CONDITIONS[r.condition]).toBe('function');
        }
    });

    test('and every rule has a point value', () => {
        const rules = [...MODELS.hoops.structure.regularWin, ...MODELS.hoops.structure.postseason];
        for (const r of rules) {
            expect(typeof MODELS.hoops.defaults[r.pointsKey]).toBe('number');
        }
    });

    test('football is untouched', () => {
        const fb = resolveConfig('graham-league', null);
        expect(fb.model).toBe('graham');
        expect(fb.values.baseWin).toBe(1);
    });
});

// The SPORT picks the model, which needs a primed season cache — and
// scoring-defaults destructures sportForLeague at require time, so a spy on
// the module never reaches it. Only a real cache proves this.
describe('a basketball league is routed to the hoops model', () => {
    useMongo();
    const seasons = require('../modules/active-season');
    const League = require('../models/league');
    const SportSeason = require('../models/sportSeason');
    const { modelForLeague } = require('../modules/scoring-defaults');

    beforeEach(async () => {
        await League.create([
            { code: 'hoops-league', name: 'Hardwood Heroes', sport: 'basketball' },
            { code: 'graham-league', name: 'The Polar Depressed', sport: 'football' }
        ]);
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: 2027, status: 'preseason' }
        ]);
        await seasons.prime();
    });
    afterEach(() => seasons._reset());

    test('by its SPORT, not by its name', () => {
        expect(modelForLeague('hoops-league')).toBe('hoops');
    });

    test('and the football leagues keep their own models', () => {
        expect(modelForLeague('graham-league')).toBe('graham');
        expect(modelForLeague('claunts-league')).toBe('claunts');
    });

    test('so resolveConfig hands a basketball league the quadrant values', () => {
        const c = resolveConfig('hoops-league', null);
        expect(c.model).toBe('hoops');
        expect(c.values.q1Win).toBe(5);
        expect(c.values.baseWin).toBeUndefined();
    });

    test('and an unknown league still defaults to football', () => {
        expect(modelForLeague('nobody-league')).toBe('claunts');
    });
});
