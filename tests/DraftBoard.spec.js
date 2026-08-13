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

    // An 8-pick wait against a 3-team board means nothing survives. Clamping the
    // survivor to the last team (as this used to) priced the wait at 2 points
    // while simultaneously listing nothing as safe — two answers to one question.
    it('reports an exhausted board instead of pricing a survivor that will not exist', () => {
        const thin = POOL.slice(0, 3);
        const d = draft({ currentOverall: 2, picks: [] });
        const a = board.advise(board.available(thin, d), board.pickSchedule(d, ME));
        expect(a.exhausted).toBe(true);
        expect(a.survivorRank).toBeNull();
        expect(a.safeToWait).toEqual([]);
        expect(a.cost).toBeNull();                   // waiting costs the pick, not 2 points
        expect(a.take.school).toBe('T1');            // still says what to take
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
        expect(board.rosterFor(d, ME, POOL))
            .toEqual([{ overall: 2, round: 1, id: 999, school: 'Ghost', total: null, regular: null }]);
    });
});

// The weekly Captain doubles ONE rostered team's score, regular season only. So
// a roster's captain value is its best REGULAR projection, and a candidate is
// worth extra only if it raises that. The consequence worth testing: the
// multiplier never touches postseason points, so two teams level on total value
// are not level once the captain is priced in.
describe('captain-aware advice', () => {
    // Same total, very different split. OSU earns in the playoff, TEX in the
    // regular season — only TEX's half gets doubled.
    const OSU = { id: 90, school: 'Buckeyes', total: 34.4, regular: 21.9 };
    const TEX = { id: 91, school: 'Horns',    total: 34.3, regular: 24.0 };
    const MID = { id: 92, school: 'Middling', total: 25.0, regular: 18.0 };
    const POOL2 = [OSU, TEX, MID];
    const on = (anchorRegular, anchorSchool) =>
        ({ enabled: true, multiplier: 2, anchorRegular, anchorSchool });

    it('prices a first pick as also choosing the season captain', () => {
        const d = draft({ currentOverall: 2 });
        const a = board.advise(POOL2, board.pickSchedule(d, ME), { captain: on(0, null) });
        // Board order puts OSU first; effective value flips it to TEX.
        expect(POOL2[0].school).toBe('Buckeyes');
        expect(a.take.school).toBe('Horns');
        expect(a.captain.gain).toBe(24);
        expect(a.effective).toBe(58.3);
    });

    it('leaves the ranking alone when the captain is off', () => {
        const d = draft({ currentOverall: 2 });
        const a = board.advise(POOL2, board.pickSchedule(d, ME), { captain: { enabled: false } });
        expect(a.take.school).toBe('Buckeyes');       // straight board value
        expect(a.captain.enabled).toBe(false);
    });

    it('adds nothing once a better anchor is already rostered', () => {
        const d = draft({ currentOverall: 11 });
        const a = board.advise(POOL2, board.pickSchedule(d, ME), { captain: on(24.0, 'Horns') });
        expect(a.captain.gain).toBe(0);
        expect(a.take.school).toBe('Buckeyes');       // back to pure board value
        expect(a.effective).toBe(34.4);
    });

    it('reports the captain slot settled when nothing left can beat the anchor', () => {
        const d = draft({ currentOverall: 11 });
        const a = board.advise(POOL2, board.pickSchedule(d, ME), { captain: on(24.0, 'Horns') });
        expect(a.captain.settled).toBe(true);
        expect(a.captain.anchorSchool).toBe('Horns');
    });

    it('is not settled while an upgrade is still on the board', () => {
        const d = draft({ currentOverall: 11 });
        const a = board.advise(POOL2, board.pickSchedule(d, ME), { captain: on(20.0, 'Middling') });
        expect(a.captain.settled).toBe(false);
        expect(a.captain.gain).toBe(4);               // 24.0 - 20.0, at 2x
    });

    it('honours a multiplier other than 2', () => {
        expect(board.captainGain({ regular: 24 }, 20, 3)).toBe(8);   // (24-20) x 2
        expect(board.captainGain({ regular: 24 }, 20, 2)).toBe(4);
        expect(board.captainGain({ regular: 18 }, 20, 2)).toBe(0);   // never negative
    });

    it('reads the anchor off the roster, ignoring teams with no projection', () => {
        expect(board.captainAnchor([{ regular: 18 }, { regular: 24 }, { regular: null }])).toBe(24);
        expect(board.captainAnchor([])).toBe(0);
    });

    it('prices the cost of waiting on effective value, not board value', () => {
        // Gap of 8 with a 3-team board clamps the survivor to the last team.
        const d = draft({ currentOverall: 2 });
        const a = board.advise(POOL2, board.pickSchedule(d, ME), { captain: on(0, null) });
        // 8-pick wait, 3-team board: nothing survives, so there is no cost to
        // quote — the point is that waiting forfeits the pick entirely.
        expect(a.exhausted).toBe(true);
        expect(a.cost).toBeNull();
    });
});
