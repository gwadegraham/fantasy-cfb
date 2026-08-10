// Coverage for public/league-rank.js — league placement by season total.
//
// It replaced "sort the league, read off the index" in public/userHome.js's
// computeRank. That approach leaked input order into the answer: Array#sort is
// stable, so tied managers kept whatever order the DB returned, and every manager
// sits at 0 before the season starts. So the cases that matter here are ties and
// order-independence.
const { competitionRanks, leagueRank } = require('../public/league-rank');

// One manager with a season total, in the /users/league/:league payload shape
// (routes/users.js $elemMatch's the active season, so seasons[0] is the only one).
const mgr = (id, cumulativeScore) => ({ _id: id, seasons: [{ season: 2026, cumulativeScore }] });

// The primitive the standings table and the H2H route rank through: an array of
// { rank, tie } aligned with the input, so callers keep their own display order.
describe('competitionRanks', () => {
    const ranks = (scores) => competitionRanks(scores.map(s => ({ s })), (x) => x.s);

    it('ranks highest-first and skips the placements a tie consumed', () => {
        expect(ranks([50, 30, 30, 10]).map(r => r.rank)).toEqual([1, 2, 2, 4]);
        expect(ranks([50, 30, 30, 10]).map(r => r.tie)).toEqual([false, true, true, false]);
    });

    it('does not care what order the items arrive in', () => {
        // The property the old sort-index approach lacked.
        expect(ranks([30, 50, 30]).map(r => r.rank)).toEqual([2, 1, 2]);
    });

    it('ties an all-equal field for 1st (the preseason shape)', () => {
        expect(ranks([0, 0, 0])).toEqual([
            { rank: 1, tie: true }, { rank: 1, tie: true }, { rank: 1, tie: true }
        ]);
    });

    it('handles three-way ties and a single item', () => {
        expect(ranks([20, 20, 20, 5]).map(r => r.rank)).toEqual([1, 1, 1, 4]);
        expect(ranks([7])).toEqual([{ rank: 1, tie: false }]);
    });

    it('passes the index to the accessor and tolerates an empty list', () => {
        expect(competitionRanks(['x', 'y'], (item, i) => i).map(r => r.rank)).toEqual([2, 1]);
        expect(competitionRanks([], () => 0)).toEqual([]);
        expect(competitionRanks(null, () => 0)).toEqual([]);
    });
});

describe('leagueRank', () => {
    const league = [mgr('a', 120), mgr('b', 90), mgr('c', 90), mgr('d', 40)];

    it('ranks by season total, 1 = best', () => {
        expect(leagueRank(league, 'a')).toEqual({ rank: 1, tie: false, total: 4 });
        expect(leagueRank(league, 'd')).toEqual({ rank: 4, tie: false, total: 4 });
    });

    it('tied managers share a placement and are flagged', () => {
        expect(leagueRank(league, 'b')).toEqual({ rank: 2, tie: true, total: 4 });
        expect(leagueRank(league, 'c')).toEqual({ rank: 2, tie: true, total: 4 });
    });

    it('skips the placements a tie consumed (competition ranking)', () => {
        // a=1st, b and c share 2nd, so d is 4th — not 3rd.
        expect(leagueRank(league, 'd').rank).toBe(4);
    });

    it('gives the same answer whatever order the league arrives in', () => {
        // The old index-of-sorted approach handed the tied pair different ranks
        // depending on document order; this must not.
        const shuffled = [league[2], league[0], league[3], league[1]];
        ['a', 'b', 'c', 'd'].forEach(id => {
            expect(leagueRank(shuffled, id)).toEqual(leagueRank(league, id));
        });
    });

    it('calls a whole-league tie a shared 1st, not an arbitrary winner', () => {
        // The preseason shape. computeRank gates this case out with
        // seasonHasScoring, but the ranking itself must not invent a leader.
        const flat = [mgr('a', 0), mgr('b', 0), mgr('c', 0)];
        expect(flat.map(m => leagueRank(flat, m._id)))
            .toEqual([{ rank: 1, tie: true, total: 3 }, { rank: 1, tie: true, total: 3 }, { rank: 1, tie: true, total: 3 }]);
    });

    it('treats a missing total as 0', () => {
        const users = [mgr('a', 10), { _id: 'b', seasons: [{ season: 2026 }] }, { _id: 'c' }];
        expect(leagueRank(users, 'b')).toEqual({ rank: 2, tie: true, total: 3 });
        expect(leagueRank(users, 'c')).toEqual({ rank: 2, tie: true, total: 3 });
    });

    it('matches ids across string/ObjectId-ish forms', () => {
        const oid = { toString: () => '64f539d45cf0433f3b6a6a1e' };
        expect(leagueRank([{ _id: oid, seasons: [{ cumulativeScore: 5 }] }], '64f539d45cf0433f3b6a6a1e'))
            .toEqual({ rank: 1, tie: false, total: 1 });
    });

    it('is null for a manager outside the league, and for no league at all', () => {
        expect(leagueRank(league, 'zz')).toBeNull();
        expect(leagueRank([], 'a')).toBeNull();
        expect(leagueRank(null, 'a')).toBeNull();
    });

    it('handles a one-manager league', () => {
        expect(leagueRank([mgr('a', 30)], 'a')).toEqual({ rank: 1, tie: false, total: 1 });
    });
});
