// The basketball projection engine (modules/hoops-projection.js): per-game win
// probability, calibration to the preseason record, points-if-win through the
// real scoring engine, and the per-team shape the football consumers read.
//
// Pure-unit. Fixtures are deliberately ASYMMETRIC — different ratings,
// venues and ranks on each side — so a swapped side or a sign error changes
// an answer instead of cancelling out.

const P = require('../modules/hoops-projection');
const { log5 } = require('../modules/hoops-win-prob');
const { resolveConfig } = require('../modules/scoring-defaults');
const { matchupWinProb } = require('../modules/h2h');

const cfg = (values) => resolveConfig('any-league', { model: 'hoops', values });

const game = (id, home, away, extra = {}) => Object.assign({
    id, week: 1, season: 2027, seasonType: 'regular', status: 'scheduled',
    homeTeamId: home, awayTeamId: away, neutralSite: false, conferenceGame: false,
    homePoints: null, awayPoints: null
}, extra);

const team = (id, barthag, projectedRecord, rank) => ({ id, preseason: { barthag, projectedRecord, rank } });

describe('teamWinProb', () => {
    test('a neutral floor is plain log5', () => {
        expect(P.teamWinProb(0.9, 0.6, 'neutral')).toBeCloseTo(log5(0.9, 0.6), 10);
    });

    test('home court multiplies the odds by HOME_ODDS, and the road divides by it', () => {
        const base = log5(0.7, 0.55);
        const odds = base / (1 - base);
        const home = P.teamWinProb(0.7, 0.55, 'home');
        const away = P.teamWinProb(0.7, 0.55, 'away');
        expect(home / (1 - home)).toBeCloseTo(odds * P.HOME_ODDS, 8);
        expect(away / (1 - away)).toBeCloseTo(odds / P.HOME_ODDS, 8);
    });

    test('the two sides of one game add to 1', () => {
        const a = P.teamWinProb(0.82, 0.41, 'home');
        const b = P.teamWinProb(0.41, 0.82, 'away');
        expect(a + b).toBeCloseTo(1, 10);
    });

    test('the multiplier is the fitted 1.55, and a caller can override it', () => {
        expect(P.HOME_ODDS).toBe(1.55);
        // One constant, shared with the game preview.
        expect(P.HOME_ODDS).toBe(require('../modules/hoops-win-prob').HOME_ODDS);
        expect(require('../modules/hoops-win-prob').homeWinProb(0.7, 0.55, false))
            .toBeCloseTo(P.teamWinProb(0.7, 0.55, 'home'), 12);
        expect(P.teamWinProb(0.5, 0.5, 'home', 2)).toBeCloseTo(2 / 3, 10);
    });

    test('a missing or impossible rating is null, not a number', () => {
        expect(P.teamWinProb(null, 0.5, 'home')).toBeNull();
        expect(P.teamWinProb(0.5, 0, 'home')).toBeNull();
        expect(P.teamWinProb(0.5, '', 'home')).toBeNull();
        expect(P.teamWinProb(1, 0.5, 'home')).toBeNull();
    });
});

describe('venueOfGame reads HoopsGame field names', () => {
    // venueFor wants homeId; a raw HoopsGame has homeTeamId. Passed straight
    // through, every game reads as 'away'.
    test('home, away and neutral from homeTeamId / awayTeamId', () => {
        expect(P.venueOfGame(7, game(1, 7, 9))).toBe('home');
        expect(P.venueOfGame(9, game(1, 7, 9))).toBe('away');
        expect(P.venueOfGame(7, game(1, 7, 9, { neutralSite: true }))).toBe('neutral');
    });
});

describe('calibrateProbs (logit shift)', () => {
    const probs = [0.97, 0.5, 0.3, 0.8];

    test('hits the target and keeps the order', () => {
        const { probs: out, delta } = P.calibrateProbs(probs, 2.1);
        expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(2.1, 6);
        expect(delta).toBeLessThan(0);
        expect(out[0]).toBeGreaterThan(out[3]);
        expect(out[3]).toBeGreaterThan(out[1]);
        expect(out[1]).toBeGreaterThan(out[2]);
    });

    test('moves a heavy favourite less than a toss-up, as a constant log-odds shift does', () => {
        const { probs: out, delta } = P.calibrateProbs(probs, 3.2);
        expect(out[1] - probs[1]).toBeGreaterThan(out[0] - probs[0]);
        probs.forEach((p, i) => expect(P.logit(out[i]) - P.logit(p)).toBeCloseTo(delta, 6));
    });

    test('a null target is a no-op, and an impossible one is clamped', () => {
        expect(P.calibrateProbs(probs, null).probs).toEqual(probs);
        expect(P.calibrateProbs(probs, null).delta).toBe(0);
        const all = P.calibrateProbs(probs, 9).probs.reduce((a, b) => a + b, 0);
        expect(all).toBeLessThanOrEqual(4);
        expect(all).toBeGreaterThan(3.99);
        expect(P.calibrateProbs([], 2).probs).toEqual([]);
        expect(P.calibrateProbs(probs, 'abc').probs).toEqual(probs);
        expect(P.calibrateProbs(probs, NaN).delta).toBe(0);
    });
});

describe('winRateOf and d1WinRate', () => {
    test('a projected record is a rate', () => {
        expect(P.winRateOf('24-8')).toBe(0.75);
        expect(P.winRateOf(' 3 - 1 ')).toBe(0.75);
        expect(P.winRateOf('0-0')).toBeNull();
        expect(P.winRateOf(undefined)).toBeNull();
        expect(P.winRateOf('n/a')).toBeNull();
    });

    test('non-D-I games come out of the rate at the measured win rate', () => {
        // 0.75 over 8 games, 2 of them against unrated opponents: 6 wins,
        // minus 2 * 0.989 against non-D-I, over the 6 D-I games.
        const ctx = P.buildHoopsPoolContext([team(1, 0.8, '6-2'), team(2, 0.5, '4-4')], { cfg: cfg() });
        const sched = [
            game(1, 1, 2), game(2, 2, 1), game(3, 1, 2), game(4, 2, 1), game(5, 1, 2), game(6, 2, 1),
            game(7, 1, 900), game(8, 901, 1)
        ];
        expect(P.d1WinRate(1, sched, ctx)).toBeCloseTo((6 - 2 * P.NON_D1_WIN_RATE) / 6, 10);
        expect(P.NON_D1_WIN_RATE).toBe(0.989);
    });

    test('null without a record or without a D-I game', () => {
        const ctx = P.buildHoopsPoolContext([team(1, 0.8, null), team(2, 0.5, '4-4')], { cfg: cfg() });
        expect(P.d1WinRate(1, [game(1, 1, 2)], ctx)).toBeNull();
        expect(P.d1WinRate(2, [game(1, 2, 900)], ctx)).toBeNull();
    });
});

describe('pointsIfWin uses the real quadrants and the league config', () => {
    const ranks = { 2: 60, 3: 200 };

    test('a rank-40 opponent is Q1 on a neutral floor and Q2 at home', () => {
        const c = cfg();
        expect(P.pointsIfWin(1, game(1, 1, 5), { 5: 40 }, c)).toBe(c.values.q2Win);
        expect(P.pointsIfWin(1, game(1, 1, 5, { neutralSite: true }), { 5: 40 }, c)).toBe(c.values.q1Win);
    });

    test('the same rank-60 opponent is Q1 away and Q2 at home', () => {
        const c = cfg();
        expect(P.pointsIfWin(1, game(1, 2, 1), ranks, c)).toBe(c.values.q1Win);
        expect(P.pointsIfWin(1, game(1, 1, 2), ranks, c)).toBe(c.values.q2Win);
        expect(P.pointsIfWin(1, game(1, 1, 2, { neutralSite: true }), ranks, c)).toBe(c.values.q2Win);
    });

    test('values come from the config, not from constants', () => {
        const c = cfg({ q1Win: 11, q3Win: 4 });
        expect(P.pointsIfWin(1, game(1, 2, 1), ranks, c)).toBe(11);
        expect(P.pointsIfWin(1, game(1, 1, 3, { neutralSite: true }), ranks, c)).toBe(4);
    });

    test('a conference tournament final never carries the title bonus into the regular projection', () => {
        const c = cfg();
        const final = game(1, 1, 2, { conferenceGame: true, gameNotes: 'ACC Tournament - Final', neutralSite: true });
        expect(P.pointsIfWin(1, final, ranks, c)).toBe(c.values.q2Win);
    });
});

describe('projectHoopsTeam', () => {
    // Team 1 (strong) plays three D-I games at three venues, one non-D-I game,
    // one conference-tournament game and two postseason games.
    const teams = [team(1, 0.9, '25-7', 5), team(2, 0.7, '18-14', 40), team(3, 0.4, '12-20', 210)];
    // #210 is Q3 on the road but Q4 at home and on a neutral floor, so a
    // venue graded wrong changes an answer.
    const ranks = { 1: 5, 2: 40, 3: 210 };
    const sched = [
        game(101, 1, 2, { week: 1 }),
        game(102, 3, 1, { week: 2 }),
        game(103, 1, 3, { week: 3, neutralSite: true }),
        game(104, 1, 999, { week: 3 }),
        game(105, 1, 2, { week: 18, conferenceGame: true, gameNotes: 'Big 12 Tournament - Final', neutralSite: true }),
        game(106, 1, 3, { week: 19, seasonType: 'postseason', tournament: 'NCAA', gameNotes: 'NCAA - 1st Round' }),
        // The College Basketball Crown arrives with no tournament code.
        game(107, 2, 1, { week: 19, seasonType: 'postseason', tournament: '' })
    ];
    const c = cfg();
    const ctx = P.buildHoopsPoolContext(teams, { ranks, cfg: c });

    test('perGame covers only regular D-I games, in football’s entry shape', () => {
        const out = P.projectHoopsTeam(teams[0], sched, ctx, { perGame: true });
        expect(out.perGame.map(g => g.gameId)).toEqual([101, 102, 103]);
        out.perGame.forEach(g => expect(Object.keys(g).sort()).toEqual(['gameId', 'pointsIfLoss', 'pointsIfWin', 'week', 'winProb']));
        out.perGame.forEach(g => expect(g.pointsIfLoss).toBe(0));
        expect(out.perGame.map(g => g.week)).toEqual([1, 2, 3]);
        // vs #40 at home = Q2, at #210 away = Q3, vs #210 neutral = Q4
        expect(out.perGame.map(g => g.pointsIfWin)).toEqual([c.values.q2Win, c.values.q3Win, c.values.q4Win]);
        expect(c.values.q3Win).not.toBe(c.values.q4Win);
    });

    test('expected wins hit the D-I-adjusted record, and regular = sum of p * points', () => {
        const out = P.projectHoopsTeam(teams[0], sched, ctx, { perGame: true });
        // 25-7 is 0.78125 over the 4 regular games, minus the non-D-I game.
        const expected = 0.78125 * 4 - P.NON_D1_WIN_RATE;
        expect(out.projWins).toBeCloseTo(expected, 6);
        const sum = out.perGame.reduce((s, g) => s + g.winProb * g.pointsIfWin, 0);
        expect(out.regular).toBeCloseTo(sum, 10);
        expect(out.total).toBe(out.regular);
        expect(out).toMatchObject({ confChamp: 0, ncaa: 0, upset: 0, postseason: 0, cfp: 0, bowl: 0, makeProb: null });
        // The standings projection sums football's three terms.
        expect(out.cfp + out.confChamp + out.bowl).toBe(0);
    });

    test('opts.expectedWins overrides the target and null skips calibration', () => {
        const forced = P.projectHoopsTeam(teams[0], sched, ctx, { expectedWins: 1.2 });
        expect(forced.projWins).toBeCloseTo(1.2, 6);
        const raw = P.projectHoopsTeam(teams[0], sched, ctx, { expectedWins: null, perGame: true });
        expect(raw.perGame[0].winProb).toBeCloseTo(P.teamWinProb(0.9, 0.7, 'home'), 10);
        expect(raw.perGame[1].winProb).toBeCloseTo(P.teamWinProb(0.9, 0.4, 'away'), 10);
    });

    test('a league with the bad-loss penalty projects it on Q4 losses', () => {
        const c2 = resolveConfig('any-league', { model: 'hoops', enabled: ['badLoss'] });
        // #200 is Q4 at home and Q3 on the road, so only the home loss costs.
        const ctx2 = P.buildHoopsPoolContext([team(1, 0.9, '25-7'), team(4, 0.2, '5-27')], { ranks: { 1: 5, 4: 200 }, cfg: c2 });
        const out = P.projectHoopsTeam(teams[0], [game(1, 1, 4), game(2, 4, 1)], ctx2, { perGame: true });
        expect(out.perGame[0].pointsIfLoss).toBe(c2.values.badLoss);
        expect(out.perGame[0].pointsIfLoss).toBeLessThan(0);
        expect(out.perGame[1].pointsIfLoss).toBe(0);
        const sum = out.perGame.reduce((s, g) => s + g.winProb * g.pointsIfWin + (1 - g.winProb) * g.pointsIfLoss, 0);
        expect(out.regular).toBeCloseTo(sum, 10);
        expect(out.regular).toBeLessThan(out.perGame.reduce((s, g) => s + g.winProb * g.pointsIfWin, 0));
    });

    test('cancelled and postponed rows are never projected', () => {
        const dead = [game(201, 1, 2, { status: 'postponed' }), game(202, 1, 2, { status: 'Cancelled' }), game(203, 1, 2)];
        const out = P.projectHoopsTeam(teams[0], dead, ctx, { perGame: true });
        expect(out.perGame.map(g => g.gameId)).toEqual([203]);
    });

    test('no perGame unless asked', () => {
        expect(P.projectHoopsTeam(teams[0], sched, ctx).perGame).toEqual([]);
    });

    test('a team with no record projects raw, and an unrated team is a coin flip', () => {
        const ctx2 = P.buildHoopsPoolContext([team(1, 0.9, null), team(2, 0.7, '1-1'), { id: 8 }], { ranks, cfg: c });
        const out = P.projectHoopsTeam({ id: 1 }, [game(1, 1, 2)], ctx2, { perGame: true });
        expect(out.perGame[0].winProb).toBeCloseTo(P.teamWinProb(0.9, 0.7, 'home'), 10);
        const unrated = P.projectHoopsTeam({ id: 8 }, [game(2, 8, 2)], ctx2, { perGame: true, expectedWins: null });
        expect(unrated.perGame[0].winProb).toBe(0.5);
    });

    test('perGame plugs straight into the H2H win-probability consumer', () => {
        const a = P.projectHoopsTeam(teams[0], sched, ctx, { perGame: true }).perGame;
        const b = P.projectHoopsTeam(teams[2], sched, ctx, { perGame: true }).perGame;
        const prob = matchupWinProb(a, b);
        expect(prob.a + prob.b).toBeCloseTo(1, 10);
        expect(prob.a).toBeGreaterThan(0);
        expect(prob.a).toBeLessThan(1);
        expect(matchupWinProb(b, a).a).toBeCloseTo(prob.b, 10);
        // Against an empty week, any roster with a game it can win is ahead.
        expect(matchupWinProb(a, []).a).toBeGreaterThan(0.5);
    });
});

describe('remaining-schedule projection', () => {
    test('remainingWinsTarget blends the preseason rate with the real pace by K', () => {
        expect(P.BLEND_GAMES).toBe(30);
        expect(P.remainingWinsTarget(null, 5, 5, 10)).toBeNull();
        expect(P.remainingWinsTarget(0.6, 5, 5, 0)).toBe(0);
        expect(P.remainingWinsTarget(0.6, 0, 0, 10)).toBeCloseTo(6, 10);
        // 10 played, 2 won, K = 30: weight 0.25 -> pace 0.75*0.6 + 0.25*0.2 = 0.5
        expect(P.remainingWinsTarget(0.6, 10, 2, 10)).toBeCloseTo(5, 10);
        expect(P.remainingWinsTarget(0.6, 10, 2, 10, 10)).toBeCloseTo(4, 10);
    });

    test('projectRemaining projects only the games not yet final', () => {
        const teams = [team(1, 0.8, '3-1'), team(2, 0.6, '2-2')];
        const ctx = P.buildHoopsPoolContext(teams, { ranks: { 1: 20, 2: 90 }, cfg: cfg() });
        const sched = [
            game(1, 1, 2, { status: 'final', homePoints: 60, awayPoints: 70 }),
            game(2, 2, 1, { status: 'final', homePoints: 50, awayPoints: 70 }),
            game(3, 1, 2, { week: 2 }),
            game(4, 2, 1, { week: 3 })
        ];
        const out = P.projectRemaining(teams[0], sched, ctx, { perGame: true });
        expect(out.perGame.map(g => g.gameId)).toEqual([3, 4]);
        expect(out).toMatchObject({ played: 2, wins: 1, remaining: 2 });
        const target = P.remainingWinsTarget(0.75, 2, 1, 2);
        expect(out.projWins).toBeCloseTo(target, 6);
        expect(P.wonGame(2, sched[0])).toBe(true);
    });
});

describe('isConfTournamentGame', () => {
    test('conference-tournament notes, not ordinary conference games — the scoring definition', () => {
        // A named tournament is somebody else's (hoops-detectors
        // isConfTournament): scored as a mode game, so projected as one.
        expect(P.isConfTournamentGame(game(1, 1, 2, { tournament: 'X', conferenceGame: true }))).toBe(false);
        expect(P.isConfTournamentGame(game(1, 1, 2, { conferenceGame: true, gameNotes: 'Big East Tournament - Quarterfinal' }))).toBe(true);
        // A coded early-season event is not a conference game and stays in.
        expect(P.isConfTournamentGame(game(1, 1, 2, { tournament: 'Maui' }))).toBe(false);
        expect(P.isConfTournamentGame(game(1, 1, 2, { conferenceGame: true, gameNotes: 'America East Playoffs - Final' }))).toBe(true);
        expect(P.isConfTournamentGame(game(1, 1, 2, { conferenceGame: true }))).toBe(false);
        expect(P.isConfTournamentGame(game(1, 1, 2, { gameNotes: 'Maui Invitational - Championship' }))).toBe(false);
    });
});
