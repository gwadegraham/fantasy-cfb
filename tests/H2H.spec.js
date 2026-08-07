const { buildRoundRobin, scheduleForWeeks, resolveWeek, seasonH2H, gameStatus, isWeekFinal, matchupWinProb,
        baseWeekScore, persistedBonus, h2hManagerIds, computeH2HAwards, applyAwards } = require('../modules/h2h');

describe('buildRoundRobin', () => {
    test('6 managers → 5 rounds, everyone plays everyone exactly once, 3 pairs/round', () => {
        const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
        const rounds = buildRoundRobin(ids);
        expect(rounds).toHaveLength(5);
        rounds.forEach(r => expect(r).toHaveLength(3));
        // Each manager appears once per round, and every pair is unique across the season.
        const seen = new Set();
        rounds.forEach(r => {
            const inRound = new Set();
            r.forEach(([a, b]) => {
                [a, b].forEach(x => { expect(inRound.has(x)).toBe(false); inRound.add(x); });
                const key = [a, b].sort().join('|');
                expect(seen.has(key)).toBe(false); seen.add(key);
            });
        });
        expect(seen.size).toBe(15); // C(6,2)
    });

    test('odd count → each round has exactly one manager on a bye', () => {
        const ids = ['a', 'b', 'c', 'd', 'e'];
        const rounds = buildRoundRobin(ids);
        expect(rounds).toHaveLength(5);
        rounds.forEach(r => {
            expect(r).toHaveLength(2);                       // 2 pairs, 1 sits out
            const playing = new Set(r.flat());
            expect(playing.size).toBe(4);
        });
    });

    test('fewer than two managers → no rounds', () => {
        expect(buildRoundRobin(['a'])).toEqual([]);
        expect(buildRoundRobin([])).toEqual([]);
    });
});

describe('scheduleForWeeks', () => {
    test('cycles the round-robin across more weeks than rounds', () => {
        const ids = ['a', 'b', 'c', 'd'];
        const rounds = buildRoundRobin(ids);          // 3 rounds
        const sched = scheduleForWeeks(ids, [1, 2, 3, 4, 5]);
        expect(sched[4]).toEqual(rounds[0]);          // week 4 wraps to round 0
        expect(sched[5]).toEqual(rounds[1]);
        expect(sched[1]).toEqual(rounds[0]);
    });
});

describe('resolveWeek', () => {
    const pairs = [['a', 'b'], ['c', 'd']];
    test('higher weekly total wins the bonus; loser gets none', () => {
        const res = resolveWeek(pairs, { a: 30, b: 20, c: 10, d: 25 }, 3);
        expect(res.a).toMatchObject({ result: 'W', bonus: 3, opponent: 'b', for: 30, against: 20 });
        expect(res.b).toMatchObject({ result: 'L', bonus: 0 });
        expect(res.d).toMatchObject({ result: 'W', bonus: 3, opponent: 'c' });
    });
    test('ties push — no bonus to either side by default', () => {
        const res = resolveWeek([['a', 'b']], { a: 14, b: 14 }, 3);
        expect(res.a).toMatchObject({ result: 'T', bonus: 0 });
        expect(res.b).toMatchObject({ result: 'T', bonus: 0 });
    });
    test('a configured tie bonus is awarded to both sides on a tie', () => {
        const res = resolveWeek([['a', 'b']], { a: 14, b: 14 }, 3, 1);
        expect(res.a).toMatchObject({ result: 'T', bonus: 1 });
        expect(res.b).toMatchObject({ result: 'T', bonus: 1 });
    });
    test('missing totals count as 0', () => {
        const res = resolveWeek([['a', 'b']], { a: 5 }, 3);
        expect(res.a.result).toBe('W');
        expect(res.b).toMatchObject({ result: 'L', for: 0 });
    });
});

describe('gameStatus', () => {
    const now = Date.parse('2025-09-13T20:00:00Z');
    test('completed → final', () => {
        expect(gameStatus({ completed: true, startDate: '2025-09-13T16:00:00Z' }, now)).toBe('final');
    });
    test('kickoff in the past, not completed → live', () => {
        expect(gameStatus({ completed: false, startDate: '2025-09-13T19:30:00Z' }, now)).toBe('live');
    });
    test('kickoff in the future → scheduled', () => {
        expect(gameStatus({ completed: false, startDate: '2025-09-13T23:30:00Z' }, now)).toBe('scheduled');
    });
    test('time TBD or unparseable → scheduled', () => {
        expect(gameStatus({ completed: false, startTimeTbd: true, startDate: '2025-09-13T19:00:00Z' }, now)).toBe('scheduled');
        expect(gameStatus({ completed: false, startDate: 'not-a-date' }, now)).toBe('scheduled');
    });
    test('no game → bye', () => {
        expect(gameStatus(null, now)).toBe('bye');
    });
});

describe('isWeekFinal', () => {
    test('true only when every game is completed', () => {
        expect(isWeekFinal([{ completed: true }, { completed: true }])).toBe(true);
        expect(isWeekFinal([{ completed: true }, { completed: false }])).toBe(false);
        expect(isWeekFinal([])).toBe(false);   // no games → not a played week
        expect(isWeekFinal(null)).toBe(false);
    });
});

describe('matchupWinProb', () => {
    const near = (x, y) => Math.abs(x - y) < 1e-9;
    test('no games on either side → null', () => {
        expect(matchupWinProb([], [])).toBeNull();
    });
    test('one certain scorer vs a sure zero → 100% / 0%', () => {
        const r = matchupWinProb([{ winProb: 1, pointsIfWin: 20 }], [{ winProb: 0, pointsIfWin: 30 }]);
        expect(r.a).toBeCloseTo(1, 10);
        expect(r.b).toBeCloseTo(0, 10);
    });
    test('identical single-team sides → coin flip (tie splits evenly)', () => {
        const r = matchupWinProb([{ winProb: 0.5, pointsIfWin: 20 }], [{ winProb: 0.5, pointsIfWin: 20 }]);
        // outcomes: (0,0)→tie, (20,0)→a, (0,20)→b, (20,20)→tie ⇒ a = .25 + .5·.5 = .5
        expect(r.a).toBeCloseTo(0.5, 10);
        expect(r.b).toBeCloseTo(0.5, 10);
    });
    test('probabilities always sum to 1', () => {
        const r = matchupWinProb(
            [{ winProb: 0.7, pointsIfWin: 18 }, { winProb: 0.4, pointsIfWin: 9 }],
            [{ winProb: 0.55, pointsIfWin: 22 }]
        );
        expect(near(r.a + r.b, 1)).toBe(true);
        expect(r.a).toBeGreaterThan(0);
        expect(r.a).toBeLessThan(1);
    });
    test('a lopsided favorite reads as the favorite', () => {
        const r = matchupWinProb(
            [{ winProb: 0.9, pointsIfWin: 25 }, { winProb: 0.85, pointsIfWin: 20 }],
            [{ winProb: 0.2, pointsIfWin: 12 }]
        );
        expect(r.a).toBeGreaterThan(0.9);
    });
    // Live behavior: a game that's already final is fed as a certainty
    // ({ winProb: 1, pointsIfWin: actualScore }); this shifts the odds vs the
    // pre-game projection as results bank.
    test('a banked win shifts the odds vs the pre-game coin flip', () => {
        const pre = matchupWinProb([{ winProb: 0.5, pointsIfWin: 20 }], [{ winProb: 0.5, pointsIfWin: 20 }]);
        expect(pre.a).toBeCloseTo(0.5, 10);
        // A's team already won (locked 20); B's still a coin flip.
        // A=20 always; B=20 (p.5)→tie, B=0 (p.5)→A wins ⇒ a = .5 + .5·.5 = .75
        const live = matchupWinProb([{ winProb: 1, pointsIfWin: 20 }], [{ winProb: 0.5, pointsIfWin: 20 }]);
        expect(live.a).toBeCloseTo(0.75, 10);
        expect(live.a).toBeGreaterThan(pre.a);
    });
});

// --- persisting the win bonus into the weekly scores -------------------------
// The bonus is folded INTO weeklyScore[].score so updateCumulativeScores sums it
// into cumulativeScore (the number the Hall of Fame, My Team rank, the recap and
// the projections all read). These cover the invariants that makes safe.

describe('baseWeekScore / persistedBonus', () => {
    test('base strips a banked bonus back out; a pre-bonus entry is unchanged', () => {
        expect(baseWeekScore({ score: 25, h2hBonus: 3 })).toBe(22);
        expect(baseWeekScore({ score: 25 })).toBe(25);
        expect(baseWeekScore(null)).toBe(0);
    });
    test('persistedBonus sums what is already folded into the season', () => {
        expect(persistedBonus({ weeklyScore: [{ h2hBonus: 3 }, {}, { h2hBonus: 3 }] })).toBe(6);
        expect(persistedBonus({ weeklyScore: [] })).toBe(0);
        expect(persistedBonus(null)).toBe(0);
    });
});

describe('h2hManagerIds', () => {
    const u = (id, season, weeks) => ({ _id: id, seasons: [{ season, weeklyScore: weeks }] });
    test('is sorted, so pairings do not depend on document order', () => {
        const forward = [u('c', 2026, [{ week: 1, score: 5 }]), u('a', 2026, [{ week: 1, score: 5 }]), u('b', 2026, [{ week: 1, score: 5 }])];
        const reversed = forward.slice().reverse();
        expect(h2hManagerIds(forward, 2026)).toEqual(['a', 'b', 'c']);
        expect(h2hManagerIds(reversed, 2026)).toEqual(h2hManagerIds(forward, 2026));
    });
    test('excludes managers with no scored week, and other seasons', () => {
        const users = [u('a', 2026, [{ week: 1, score: 5 }]), u('b', 2026, []), u('c', 2025, [{ week: 1, score: 5 }])];
        expect(h2hManagerIds(users, 2026)).toEqual(['a']);
    });
    test('matches a season passed as a string or a number', () => {
        const users = [u('a', 2026, [{ week: 1, score: 5 }])];
        expect(h2hManagerIds(users, '2026')).toEqual(['a']);
    });
});

describe('computeH2HAwards', () => {
    // Two managers, one drafted team each, weeks 1-2.
    const users = [
        { _id: 'a', seasons: [{ season: 2026, teams: [{ id: 1 }], weeklyScore: [{ week: 1, score: 20 }, { week: 2, score: 10 }] }] },
        { _id: 'b', seasons: [{ season: 2026, teams: [{ id: 2 }], weeklyScore: [{ week: 1, score: 14 }, { week: 2, score: 30 }] }] }
    ];
    const game = (week, homeId, completed) => ({ id: week * 10 + homeId, week, homeId, awayId: 99, completed });
    const opts = { season: 2026, winBonus: 3, tieBonus: 0, lastWeek: 14 };

    test('awards the higher base total once every drafted game is complete', () => {
        const games = [game(1, 1, true), game(1, 2, true)];
        const { awards, finalWeeks, currentWeek } = computeH2HAwards({ users, games, ...opts });
        expect(finalWeeks).toEqual([1]);
        expect(currentWeek).toBeNull();
        expect(awards.a[1]).toMatchObject({ result: 'W', bonus: 3, opponent: 'b', for: 20, against: 14 });
        expect(awards.b[1]).toMatchObject({ result: 'L', bonus: 0 });
        expect(awards.a[2]).toBeUndefined();      // week 2 has no games loaded
    });

    test('a week with an unfinished game does not settle — it becomes the current week', () => {
        const games = [game(1, 1, true), game(1, 2, false)];
        const { awards, finalWeeks, currentWeek } = computeH2HAwards({ users, games, ...opts });
        expect(finalWeeks).toEqual([]);
        expect(currentWeek).toBe(1);
        expect(awards.a[1]).toBeUndefined();
    });

    test('resolves from the BASE total, so an already-banked bonus never decides its own week', () => {
        // a trails b on base (18 vs 20) but leads on the stored score (21 vs 20)
        // because a's week-1 bonus is already folded in. b must still win.
        const banked = [
            { _id: 'a', seasons: [{ season: 2026, teams: [{ id: 1 }], weeklyScore: [{ week: 1, score: 21, h2hBonus: 3 }] }] },
            { _id: 'b', seasons: [{ season: 2026, teams: [{ id: 2 }], weeklyScore: [{ week: 1, score: 20 }] }] }
        ];
        const games = [game(1, 1, true), game(1, 2, true)];
        const { awards } = computeH2HAwards({ users: banked, games, ...opts });
        expect(awards.b[1]).toMatchObject({ result: 'W', bonus: 3 });
        expect(awards.a[1]).toMatchObject({ result: 'L', bonus: 0 });
    });

    test('postseason entries and weeks past the cap never award', () => {
        const late = [
            { _id: 'a', seasons: [{ season: 2026, teams: [{ id: 1 }], weeklyScore: [{ week: 15, score: 20 }, { week: 1, season: 'postseason', score: 30 }] }] },
            { _id: 'b', seasons: [{ season: 2026, teams: [{ id: 2 }], weeklyScore: [{ week: 15, score: 10 }] }] }
        ];
        const games = [{ id: 1, week: 15, homeId: 1, awayId: 99, completed: true }];
        const { awards, finalWeeks } = computeH2HAwards({ users: late, games, ...opts });
        expect(finalWeeks).toEqual([]);
        expect(awards.a).toEqual({});
    });

    test('fewer than two scored managers awards nothing', () => {
        const solo = [users[0]];
        const { awards } = computeH2HAwards({ users: solo, games: [game(1, 1, true)], ...opts });
        expect(awards.a).toEqual({});
    });
});

describe('applyAwards', () => {
    const weekly = () => [{ week: 1, score: 20 }, { week: 2, score: 10 }, { week: 1, season: 'postseason', score: 30 }];

    test('folds the bonus into score and records the result', () => {
        const { weeklyScore, changed } = applyAwards(weekly(), { 1: { result: 'W', bonus: 3, opponent: 'b' } });
        expect(changed).toBe(true);
        expect(weeklyScore[0]).toMatchObject({ score: 23, h2hBonus: 3, h2hResult: 'W', h2hOpponentId: 'b' });
        expect(weeklyScore[1]).toMatchObject({ score: 10 });
        expect(weeklyScore[1].h2hBonus).toBeUndefined();
        expect(weeklyScore[2].score).toBe(30);                    // postseason untouched
    });

    test('is idempotent — applying the same awards twice does not compound', () => {
        const awards = { 1: { result: 'W', bonus: 3, opponent: 'b' } };
        const once = applyAwards(weekly(), awards);
        const twice = applyAwards(once.weeklyScore, awards);
        expect(twice.weeklyScore[0].score).toBe(23);
        expect(twice.changed).toBe(false);                        // nothing to write
    });

    test('a changed bonus value re-bases rather than stacking', () => {
        const once = applyAwards(weekly(), { 1: { result: 'W', bonus: 3, opponent: 'b' } });
        const again = applyAwards(once.weeklyScore, { 1: { result: 'W', bonus: 5, opponent: 'b' } });
        expect(again.weeklyScore[0]).toMatchObject({ score: 25, h2hBonus: 5 });
        expect(again.changed).toBe(true);
    });

    test('a flipped result on a rescore moves the bonus to the other side', () => {
        const won = applyAwards(weekly(), { 1: { result: 'W', bonus: 3, opponent: 'b' } });
        const lost = applyAwards(won.weeklyScore, { 1: { result: 'L', bonus: 0, opponent: 'b' } });
        expect(lost.weeklyScore[0]).toMatchObject({ score: 20, h2hResult: 'L' });
        expect(lost.weeklyScore[0].h2hBonus).toBeUndefined();
    });

    test('turning H2H off strips the bonus back out entirely', () => {
        const on = applyAwards(weekly(), { 1: { result: 'W', bonus: 3, opponent: 'b' } });
        const off = applyAwards(on.weeklyScore, {});
        expect(off.changed).toBe(true);
        expect(off.weeklyScore[0].score).toBe(20);
        expect(off.weeklyScore[0].h2hBonus).toBeUndefined();
        expect(off.weeklyScore[0].h2hResult).toBeUndefined();
    });

    test('a tie bonus is awarded and folded in like a win', () => {
        const { weeklyScore } = applyAwards(weekly(), { 1: { result: 'T', bonus: 1, opponent: 'b' } });
        expect(weeklyScore[0]).toMatchObject({ score: 21, h2hBonus: 1, h2hResult: 'T' });
    });

    test('does not mutate the entries it was given', () => {
        const original = weekly();
        applyAwards(original, { 1: { result: 'W', bonus: 3, opponent: 'b' } });
        expect(original[0]).toEqual({ week: 1, score: 20 });
    });

    test('a fractional captain bonus stays clean after folding (no float drift)', () => {
        const withCaptain = [{ week: 1, score: 20.5, captainBonus: 5.5 }];
        const { weeklyScore } = applyAwards(withCaptain, { 1: { result: 'W', bonus: 3, opponent: 'b' } });
        expect(weeklyScore[0].score).toBe(23.5);
    });
});

describe('seasonH2H', () => {
    test('accumulates records, bonus, and points for/against across weeks', () => {
        const ids = ['a', 'b', 'c', 'd'];
        // rounds: [ [a-d,b-c], [a-c,d-b], [a-b,c-d] ] (circle method, fixed=a)
        const totals = {
            a: { 1: 30, 2: 10, 3: 20 },
            b: { 1: 25, 2: 15, 3: 20 },   // week 3: a vs b tie at 20
            c: { 1: 5, 2: 25, 3: 30 },
            d: { 1: 40, 2: 12, 3: 8 }
        };
        const h = seasonH2H(ids, [1, 2, 3], totals, 3);
        // a: wk1 a-d 30v40 L; wk2 a-c 10v25 L; wk3 a-b 20v20 T
        expect(h.a).toMatchObject({ wins: 0, losses: 2, ties: 1, bonus: 0, pointsFor: 60, pointsAgainst: 85 });
        // d: wk1 d-a 40v30 W; wk2 d-b 12v15 L; wk3 c-d 8 vs c30 → d L
        expect(h.d).toMatchObject({ wins: 1, losses: 2, ties: 0, bonus: 3 });
        // total games each = 3
        ids.forEach(id => expect(h[id].wins + h[id].losses + h[id].ties).toBe(3));
        // bonus always a multiple of the win bonus
        ids.forEach(id => expect(h[id].bonus).toBe(h[id].wins * 3));
    });
});
