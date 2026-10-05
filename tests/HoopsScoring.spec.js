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

// Games in the shape CBBD ACTUALLY SENDS, pulled from March 2026 before any
// of this was written. The first version of these tests invented labels like
// "NCAA Tournament First Round"; the real feed says "1st Round", and the
// round lives in gameNotes while `tournament` is the bare code 'NCAA'.
const NCAA = "NCAA Men's Basketball Championship";
const ncaa = (round, o = {}) => game(Object.assign({
    neutralSite: true, seasonType: 'postseason', tournament: 'NCAA', gameType: 'TRNMNT',
    gameNotes: `${NCAA} - East Region - ${round}`
}, o));
// The NIT and the Crown are postseason too, with the SAME round names.
const nit = (round, o = {}) => game(Object.assign({
    neutralSite: true, seasonType: 'postseason', tournament: 'NIT', gameType: 'TRNMNT',
    gameNotes: `NIT - ${round}`
}, o));
// A conference tournament is seasonType 'regular' to CBBD.
const confTourney = (name, round, o = {}) => game(Object.assign({
    neutralSite: true, seasonType: 'regular', conferenceGame: true, gameType: 'TRNMNT',
    gameNotes: `${name} - ${round}`
}, o));

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
    const RUNGS = [['1st Round', 7], ['2nd Round', 9], ['Sweet 16', 12], ['Elite 8', 16], ['Final Four', 21]];

    test.each(RUNGS)('%s is worth %i, win or lose', (round, points) => {
        // Every rung but the last is an APPEARANCE: reaching the round is
        // what is paid for, because reaching it is what the draft pick did.
        expect(score(1, ncaa(round))).toBe(points);
        expect(score(1, ncaa(round, { homePoints: 60, awayPoints: 70 }))).toBe(points);
    });

    test('the title game pays for reaching it, and again for winning it', () => {
        expect(score(1, ncaa('National Championship', { homePoints: 60, awayPoints: 70 }))).toBe(26);
        expect(score(1, ncaa('National Championship'))).toBe(26 + 35);
    });

    test('a champion banks exactly 126 across the six games', () => {
        const run = [...RUNGS.map(([r]) => r), 'National Championship'];
        expect(run.reduce((sum, r) => sum + score(1, ncaa(r)), 0)).toBe(126);
    });

    test('and a one-and-done banks 7', () => {
        expect(score(1, ncaa('1st Round', { homePoints: 60, awayPoints: 70 }))).toBe(7);
    });

    test('the First Four is worth nothing extra', () => {
        // A real round that was missing from the model entirely. Its winner
        // goes on to play a 1st Round game and collects the 7 there — paying
        // both would pay twice for entering.
        expect(score(1, ncaa('First Four'))).toBe(0);
        expect(ncaaRoundFor(ncaa('First Four'))).toBe('ff');
        // The whole path: play in, win, then play the 1st Round.
        expect(score(1, ncaa('First Four')) + score(1, ncaa('1st Round'))).toBe(7);
    });

    test('a tournament game is NOT also scored as a quadrant win', () => {
        expect(score(1, ncaa('Sweet 16'), { 2: 1 })).toBe(12);
    });

    test('an NCAA game with NO notes at all is worth nothing', () => {
        // No round to read, so no rung to pay — and it is still a
        // postseason game, so it does not fall back to a quadrant win
        // either. Zero is the safe answer for a game we cannot place.
        const bare = game({ neutralSite: true, seasonType: 'postseason', tournament: 'NCAA' });
        expect(ncaaRoundFor(bare)).toBeNull();
        expect(score(1, bare, { 2: 10 })).toBe(0);
    });

    test('an NCAA game with an unreadable round is worth nothing', () => {
        // Refusing to guess. A round nobody recognises is not assigned the
        // nearest rung, and is not quietly paid as a quadrant win either.
        const odd = ncaa('Regional Semifinal Something');
        expect(ncaaRoundFor(odd)).toBeNull();
        expect(score(1, odd, { 2: 10 })).toBe(0);
    });
});

describe('the NIT is not scored at all', () => {
    // Not "scored as a regular game" — scored as NOTHING. It is not the
    // real postseason, so a deep NIT run is worth zero, the same as not
    // being invited. Everything CBBD files as postseason that is not the
    // NCAA tournament falls here.
    test.each([['1st Round'], ['2nd Round'], ['Quarterfinal'], ['Semifinal'], ['Championship']])(
        'NIT %s is worth nothing, even beating a top-10 team', (round) => {
            expect(score(1, nit(round), { 2: 1 })).toBe(0);
            expect(ncaaRoundFor(nit(round))).toBeNull();
        });

    test('and neither is the College Basketball Crown', () => {
        const crown = game({
            neutralSite: true, seasonType: 'postseason', gameType: 'TRNMNT',
            gameNotes: 'College Basketball Crown Championship Game'
        });
        expect(score(1, crown, { 2: 1 })).toBe(0);
        expect(isConfTournamentFinal(crown)).toBe(false);
    });

    test('losing in the NIT costs nothing either', () => {
        // The bad-loss penalty is a regular-season rule; an NIT exit is not
        // a bad loss, it is a game that does not exist to us.
        const on = cfg({ enabled: ['badLoss'] });
        expect(score(1, nit('1st Round', { homePoints: 60, awayPoints: 70 }), { 2: 300 }, on)).toBe(0);
    });

    test('the marker is CBBD’s seasonType, so an unknown March event is also zero', () => {
        // Whatever invitational gets invented next: postseason, not NCAA,
        // worth nothing. Safer than paying out for a tournament nobody
        // decided should count.
        const invented = game({
            neutralSite: true, seasonType: 'postseason', tournament: 'XYZ',
            gameNotes: 'XYZ Invitational - Final'
        });
        expect(score(1, invented, { 2: 1 })).toBe(0);
    });
});

describe('the conference tournament title is a BONUS', () => {
    // CBBD files conference tournaments as seasonType 'regular', and that
    // is the right reading: the final is a real game against a real
    // opponent. So it scores its quadrant like any other game and the title
    // is added ON TOP — beating a top-30 team to take the ACC should not be
    // worth LESS than beating them in January, which is what a replacement
    // value would have meant.
    test('stacks on the quadrant win for the same game', () => {
        expect(score(1, confTourney('OVC Championship', 'Final'), { 2: 10 })).toBe(5 + 10);
        // A #200 at a NEUTRAL site is Q3, not Q4 — conference tournaments
        // are played on neutral floors, which is exactly the case venue
        // exists for.
        expect(score(1, confTourney('MVC Tournament', 'Final'), { 2: 200 })).toBe(1 + 10);
        expect(score(1, confTourney('MVC Tournament', 'Final'), { 2: 300 })).toBe(0 + 10);
    });

    test('and not for losing the final', () => {
        expect(score(1, confTourney('OVC Championship', 'Final', { homePoints: 60, awayPoints: 70 }), { 2: 10 })).toBe(0);
    });

    test('an earlier round is just a game', () => {
        for (const round of ['1st Round', '2nd Round', 'Quarterfinal', 'Semifinal', 'Play-In']) {
            expect(score(1, confTourney('Sun Belt Championship', round), { 2: 10 })).toBe(5);
        }
    });

    test('a league can switch the bonus off and keep the win', () => {
        const off = cfg({ disabled: ['confTournamentTitle'] });
        expect(score(1, confTourney('OVC Championship', 'Final'), { 2: 10 }, off)).toBe(5);
    });

    test('a non-conference game is never a conference title', () => {
        // The name has to CONTAIN "Championship" or the notes check rejects
        // it first and the conferenceGame guard is never reached — which is
        // how the first version of this test passed with that guard deleted.
        expect(isConfTournamentFinal(confTourney('OVC Championship', 'Final', { conferenceGame: false }))).toBe(false);
    });

    test('a NAMED tournament is somebody else’s, however it is marked', () => {
        expect(isConfTournamentFinal(confTourney('OVC Championship', 'Final', { tournament: 'NIT' }))).toBe(false);
        expect(isConfTournamentFinal(confTourney('OVC Championship', 'Final', { tournament: 'NCAA' }))).toBe(false);
        expect(isConfTournamentFinal(nit('Championship'))).toBe(false);
    });

    test('the BONUS survives a conference final filed as postseason', () => {
        // The title is identified by its own markers, not by seasonType, so
        // it keeps paying if CBBD ever moves conference tournaments into
        // postseason. The quadrant win does not — that follows seasonType,
        // which is what keeps the NIT at zero. A conference title would
        // quietly drop from 15 to 10 rather than to nothing.
        expect(score(1, confTourney('OVC Championship', 'Final', { seasonType: 'postseason' }), { 2: 10 })).toBe(10);
    });
});

describe('the seed upset bonus', () => {
    // Restored after a block rewrite dropped it — the coverage ratchet
    // caught the absence, because nothing else reaches the "no upset"
    // branch. Seeds are on EVERY NCAA game in the real feed: 67 of 67.
    const r64 = (o) => ncaa('1st Round', o);

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

    test('equal seeds are not an upset', () => {
        // Not hypothetical: the real First Four game pulled from March 2026
        // was Howard (16) vs UMBC (16).
        expect(score(1, r64({ homeSeed: 16, awaySeed: 16 }))).toBe(7);
        expect(seedUpsetFor(1, game({ homeSeed: 16, awaySeed: 16 }), true)).toBe(0);
    });

    test('and seeds that are simply absent score the round alone', () => {
        expect(score(1, r64())).toBe(7);
    });

    test('it scales, rather than paying a flat bonus', () => {
        expect(score(1, r64({ homeSeed: 9, awaySeed: 8 }))).toBe(7 + 1);
        expect(score(1, r64({ homeSeed: 16, awaySeed: 1 }))).toBe(7 + 15);
    });

    test('the away team’s seeds are read the right way round', () => {
        // A 12 seed on the road beating a 5, which is the common shape.
        expect(score(2, r64({ homeSeed: 5, awaySeed: 12, homePoints: 60, awayPoints: 70 }))).toBe(14);
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
        expect(isConfTournamentFinal({ tournament: "NCAA Men's Basketball Championship - East Region - 1st Round" })).toBe(false);
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
        const ctx = buildHoopsContext(1, ncaa('Sweet 16'), { 2: 1 });
        expect(ctx.quadrant).toBe(1);
        expect(HOOPS_CONDITIONS.q1Win(ctx)).toBe(false);
        // A conference final, by contrast, IS a regular game and DOES
        // score its quadrant — the title is a bonus on top of it.
        const conf = buildHoopsContext(1, confTourney('ACC Tournament', 'Final'), { 2: 1 });
        expect(HOOPS_CONDITIONS.q1Win(conf)).toBe(true);
        expect(HOOPS_CONDITIONS.confTournamentTitle(conf)).toBe(true);
    });

    test('a tournament game is not a regular-season game', () => {
        const ctx = buildHoopsContext(1, ncaa('Final Four'), {});
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
