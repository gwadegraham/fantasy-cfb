// Pure logic for the live draft board (modules/draft-board.js).
//
// The scarcity math is the whole point of the page, so it gets the attention:
// a 6-team snake gives the 2nd seat a 9-pick wait after round 1 and a 3-pick
// wait after round 2, and the advice has to change shape accordingly.

const board = require('../modules/draft-board');

const ORDER = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
const ME = 'u2';

function draft(overrides = {}) {
    return Object.assign({
        league: 'graham-league', season: 2026,
        draftOrder: ORDER, snake: true, totalRounds: 10,
        currentOverall: 1, picks: []
    }, overrides);
}

// 20 teams, descending value: T1 = 40, T2 = 39, ...
const POOL = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, school: `T${i + 1}`, total: 40 - i }));

function pickedThrough(overall) {
    // Every pick up to `overall` takes the best team left, in snake order.
    const picks = [];
    const engine = require('../modules/draft-engine');
    const order = engine.pickOrder(draft());
    for (let o = 1; o <= overall; o++) {
        const slot = order[o - 1];
        picks.push({ overall: o, round: slot.round, userId: slot.userId, team: POOL[o - 1] });
    }
    return picks;
}

describe('pick schedule', () => {
    it('knows the 2nd seat picks 2, 11, 14, 23 …', () => {
        expect(board.picksFor(draft(), ME).map(p => p.overall))
            .toEqual([2, 11, 14, 23, 26, 35, 38, 47, 50, 59]);
    });

    it('reports the wait between this turn and the next', () => {
        const s = board.pickSchedule(draft(), ME);
        expect(s.next.overall).toBe(2);
        expect(s.after.overall).toBe(11);
        expect(s.gap).toBe(8);          // picks 3-10 belong to other managers
    });

    it('the round 2 -> 3 turn is a much shorter wait', () => {
        const s = board.pickSchedule(draft({ currentOverall: 11 }), ME);
        expect(s.next.overall).toBe(11);
        expect(s.after.overall).toBe(14);
        expect(s.gap).toBe(2);          // the snake turn: only 2 picks in between
        expect(s.onTheClock).toBe(true);
    });

    it('has no gap left on the final pick', () => {
        const s = board.pickSchedule(draft({ currentOverall: 59 }), ME);
        expect(s.next.overall).toBe(59);
        expect(s.after).toBeNull();
        expect(s.gap).toBeNull();
    });

    it('is empty once the manager is done picking', () => {
        expect(board.pickSchedule(draft({ currentOverall: 60 }), ME).next).toBeNull();
    });
});

describe('available board', () => {
    it('drops drafted teams and keeps the rest best-first', () => {
        const avail = board.available(POOL, draft({ picks: pickedThrough(3) }));
        expect(avail).toHaveLength(17);
        expect(avail[0].school).toBe('T4');
        expect(avail.map(t => t.total)).toEqual([...avail.map(t => t.total)].sort((a, b) => b - a));
    });

    it('is unaffected by a pick whose team lacks an id', () => {
        const d = draft({ picks: [{ overall: 1, round: 1, userId: 'u1', team: {} }] });
        expect(board.available(POOL, d)).toHaveLength(20);
    });
});

describe('advice', () => {
    it('prices what a long wait costs', () => {
        const d = draft({ currentOverall: 2, picks: pickedThrough(1) });
        const a = board.advise(board.available(POOL, d), board.pickSchedule(d, ME));
        expect(a.take.school).toBe('T2');            // best left
        // 8 picks in between, so T10 is the best expected to survive: 39 - 31 = 8
        expect(a.survivorRank).toBe(8);
        expect(a.cost).toBe(8);
        expect(a.atRisk.map(t => t.school)).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
        expect(a.safeToWait[0].school).toBe('T10');
    });

    it('prices a short wait as costing much less', () => {
        const d = draft({ currentOverall: 11, picks: pickedThrough(10) });
        const a = board.advise(board.available(POOL, d), board.pickSchedule(d, ME));
        expect(a.take.school).toBe('T11');
        expect(a.survivorRank).toBe(2);
        expect(a.cost).toBe(2);                      // 30 - 28
        expect(a.atRisk.map(t => t.school)).toEqual(['T11', 'T12']);
    });

    it('gives no scarcity read on the final pick', () => {
        // Only 10 taken so the board isn't empty — it's the absent NEXT turn,
        // not an exhausted pool, that has to switch the scarcity read off.
        const d = draft({ currentOverall: 59, picks: pickedThrough(10) });
        const a = board.advise(board.available(POOL, d), board.pickSchedule(d, ME));
        expect(a.take).not.toBeNull();
        expect(a.cost).toBeNull();
        expect(a.atRisk).toEqual([]);
    });

    it('does not run off the end of a board shorter than the wait', () => {
        const thin = POOL.slice(0, 3);
        const d = draft({ currentOverall: 2, picks: [] });
        const a = board.advise(board.available(thin, d), board.pickSchedule(d, ME));
        expect(a.survivorRank).toBe(2);              // clamped to the last team
        expect(a.safeToWait).toEqual([]);
        expect(a.cost).toBe(2);
    });

    it('handles an empty board', () => {
        const a = board.advise([], board.pickSchedule(draft(), ME));
        expect(a.take).toBeNull();
        expect(a.cost).toBeNull();
    });
});

describe('roster', () => {
    it('lists this manager only, in pick order, with projections attached', () => {
        const d = draft({ currentOverall: 15, picks: pickedThrough(14) });
        const mine = board.rosterFor(d, ME, POOL);
        expect(mine.map(p => p.overall)).toEqual([2, 11, 14]);
        expect(mine[0]).toMatchObject({ school: 'T2', total: 39, round: 1 });
    });

    it('survives a team that is not in the projection pool', () => {
        const d = draft({ picks: [{ overall: 2, round: 1, userId: ME, team: { id: 999, school: 'Ghost' } }] });
        expect(board.rosterFor(d, ME, POOL)).toEqual([{ overall: 2, round: 1, id: 999, school: 'Ghost', total: null }]);
    });
});
