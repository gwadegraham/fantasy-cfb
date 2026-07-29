const { buildRoundRobin, scheduleForWeeks, resolveWeek, seasonH2H } = require('../modules/h2h');

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
    test('ties push — no bonus to either side', () => {
        const res = resolveWeek([['a', 'b']], { a: 14, b: 14 }, 3);
        expect(res.a).toMatchObject({ result: 'T', bonus: 0 });
        expect(res.b).toMatchObject({ result: 'T', bonus: 0 });
    });
    test('missing totals count as 0', () => {
        const res = resolveWeek([['a', 'b']], { a: 5 }, 3);
        expect(res.a.result).toBe('W');
        expect(res.b).toMatchObject({ result: 'L', for: 0 });
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
