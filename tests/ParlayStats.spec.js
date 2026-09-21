// Per-contributor parlay stats (modules/parlay-stats.js) — the Bettors board.
//
// A parlay is one slip per group per week, so the group's record hides the fact
// that four people are picking separately inside it. These are the numbers that
// split it back out, and the ones people will argue about, so the edges matter:
// what counts as a hit, who gets blamed for a busted slip, and who is allowed
// to hold a title on two legs.

const {
    contributorStats, superlatives, soloKillerIds, streakOf, riskierOdds
} = require('../modules/parlay-stats');

const leg = (contributor, result, odds) => ({ contributor, result, odds });
const slip = (week, legs, status) => ({ week, status: status || 'lost', legs });

const MEMBERS = [{ id: 'ann', name: 'Ann' }, { id: 'bob', name: 'Bob' }, { id: 'cal', name: 'Cal' }];
const byName = (rows, name) => rows.find(r => r.contributor === name);

describe('soloKillerIds', () => {
    // The stat people will actually talk about: three picks came in, one didn't,
    // and everybody lost the payout because of it.
    it('names the one leg that lost an otherwise-winning slip', () => {
        const p = slip(2, [leg('ann', 'win'), leg('bob', 'loss'), leg('cal', 'win')]);
        expect(soloKillerIds(p)).toEqual(['bob']);
    });

    // On a slip that lost 2-2 the others didn't do their jobs either — blaming
    // one of them would make the number meaningless.
    it('blames nobody when the slip lost by more than one leg', () => {
        const p = slip(1, [leg('ann', 'loss'), leg('bob', 'loss'), leg('cal', 'win')]);
        expect(soloKillerIds(p)).toEqual([]);
    });

    it('blames nobody on a slip that won', () => {
        expect(soloKillerIds(slip(3, [leg('ann', 'win'), leg('bob', 'win')], 'won'))).toEqual([]);
    });

    // A slip with a leg still pending isn't over, so nothing has been killed.
    it('waits for the slip to finish', () => {
        const p = slip(4, [leg('ann', 'loss'), leg('bob', 'win'), leg('cal', 'pending')]);
        expect(soloKillerIds(p)).toEqual([]);
    });

    it('counts a push as settled, so a push + a loss still names the loser', () => {
        const p = slip(5, [leg('ann', 'push'), leg('bob', 'loss'), leg('cal', 'win')]);
        expect(soloKillerIds(p)).toEqual(['bob']);
    });
});

describe('riskierOdds', () => {
    // American odds: +150 pays better than -110, and among favourites -110 is a
    // longer shot than -300. So "riskiest" is just the highest number.
    it('prefers the longer shot', () => {
        expect(riskierOdds(-300, -110)).toBe(-110);
        expect(riskierOdds(-110, 150)).toBe(150);
        expect(riskierOdds(150, -110)).toBe(150);
    });

    it('handles a missing side', () => {
        expect(riskierOdds(null, -200)).toBe(-200);
        expect(riskierOdds(-200, null)).toBe(-200);
        expect(riskierOdds(null, null)).toBeNull();
    });
});

describe('streakOf', () => {
    it('counts the run ending at the most recent leg', () => {
        expect(streakOf(['loss', 'win', 'win', 'win'])).toEqual({ type: 'win', count: 3 });
        expect(streakOf(['win', 'loss'])).toEqual({ type: 'loss', count: 1 });
    });

    // A push is no action — it should neither extend nor break a run.
    it('steps over a push', () => {
        expect(streakOf(['win', 'push', 'win'])).toEqual({ type: 'win', count: 2 });
    });

    it('is null with nothing settled', () => {
        expect(streakOf([])).toBeNull();
        expect(streakOf(['push', 'push'])).toBeNull();
    });
});

describe('contributorStats', () => {
    const season = [
        slip(1, [leg('ann', 'win', -150), leg('bob', 'loss', -200), leg('cal', 'loss', -110)]),
        slip(2, [leg('ann', 'win', -300), leg('bob', 'loss', -120), leg('cal', 'win', -140)]),
        slip(3, [leg('ann', 'win', -110), leg('bob', 'win', -180), leg('cal', 'win', -160)], 'won')
    ];

    it('splits the group record out by contributor', () => {
        const rows = contributorStats(season, MEMBERS);
        expect(byName(rows, 'ann')).toMatchObject({ wins: 3, losses: 0, decided: 3, hitRate: 100 });
        expect(byName(rows, 'bob')).toMatchObject({ wins: 1, losses: 2, decided: 3, hitRate: 33.3 });
    });

    // Week 2 lost 2-1 with bob the only loss — that's a solo kill. Week 1 lost
    // by two, so nobody is blamed for it.
    it('counts solo kills, and only those', () => {
        const rows = contributorStats(season, MEMBERS);
        expect(byName(rows, 'bob').soloKills).toBe(1);
        expect(byName(rows, 'cal').soloKills).toBe(0);
    });

    // A six-person group with a name missing reads as a bug, not as "hasn't
    // picked".
    it('includes a member who has never had a leg settle', () => {
        const rows = contributorStats([slip(1, [leg('ann', 'win')])], MEMBERS);
        const cal = byName(rows, 'cal');
        expect(cal).toBeDefined();
        expect(cal.legs).toBe(0);
        expect(cal.hitRate).toBeNull();      // not 0 — they have never lost either
        expect(cal.decided).toBe(0);
    });

    it('keeps pushes out of the hit rate, the way a book does', () => {
        const rows = contributorStats([
            slip(1, [leg('ann', 'win'), leg('bob', 'push')]),
            slip(2, [leg('ann', 'push'), leg('bob', 'win')])
        ], MEMBERS);
        expect(byName(rows, 'ann')).toMatchObject({ wins: 1, pushes: 1, decided: 1, hitRate: 100 });
    });

    it('does not count a pending leg as anything', () => {
        const rows = contributorStats([slip(1, [leg('ann', 'pending'), leg('bob', 'win')])], MEMBERS);
        expect(byName(rows, 'ann')).toMatchObject({ legs: 1, pending: 1, decided: 0, hitRate: null });
    });

    it('records the longest shot each of them landed, not the longest they took', () => {
        const rows = contributorStats([
            slip(1, [leg('ann', 'win', -300), leg('bob', 'loss', 250)])
        ], MEMBERS);
        expect(byName(rows, 'ann').bestOdds).toBe(-300);
        expect(byName(rows, 'bob').bestOdds).toBeNull();   // +250 lost; it doesn't count
    });

    it('builds form oldest-first, whatever order the slips arrive in', () => {
        const rows = contributorStats([
            slip(3, [leg('ann', 'loss')]), slip(1, [leg('ann', 'win')]), slip(2, [leg('ann', 'win')])
        ], MEMBERS);
        expect(byName(rows, 'ann').results).toEqual(['win', 'win', 'loss']);
        expect(byName(rows, 'ann').streak).toEqual({ type: 'loss', count: 1 });
    });

    it('sorts by hit rate, breaking ties on sample size', () => {
        const rows = contributorStats([
            slip(1, [leg('ann', 'win'), leg('bob', 'win'), leg('cal', 'loss')]),
            slip(2, [leg('ann', 'win'), leg('cal', 'loss')])
        ], MEMBERS);
        // ann 2-0 and bob 1-0 both sit at 100%; ann has the bigger sample.
        expect(rows.map(r => r.contributor)).toEqual(['ann', 'bob', 'cal']);
    });

    it('sorts anyone with nothing settled to the bottom, not to 0%', () => {
        const rows = contributorStats([slip(1, [leg('ann', 'loss')])], MEMBERS);
        expect(rows[rows.length - 1].decided).toBe(0);
        expect(rows[0].contributor).toBe('ann');          // 0% still beats no data
    });

    it('survives a leg with no contributor', () => {
        const rows = contributorStats([slip(1, [{ result: 'win' }, leg('ann', 'win')])], MEMBERS);
        expect(byName(rows, 'ann').wins).toBe(1);
        expect(rows).toHaveLength(3);                      // no phantom row
    });

    it('handles an empty season', () => {
        const rows = contributorStats([], MEMBERS);
        expect(rows).toHaveLength(3);
        expect(rows.every(r => r.decided === 0)).toBe(true);
    });
});

describe('superlatives', () => {
    const rowsFor = (parlays) => contributorStats(parlays, MEMBERS);

    it('awards a perfect record over a merely hot one', () => {
        const s = superlatives(rowsFor([
            slip(1, [leg('ann', 'win'), leg('bob', 'win')]),
            slip(2, [leg('ann', 'win'), leg('bob', 'loss')])
        ]));
        expect(s.perfect.contributor).toBe('ann');
        expect(s.hottest.contributor).toBe('ann');
    });

    // A title on one lucky leg is not a title.
    it('needs a real sample before handing out a badge', () => {
        const s = superlatives(rowsFor([slip(1, [leg('ann', 'win'), leg('bob', 'loss')])]));
        expect(s.perfect).toBeNull();
        expect(s.hottest).toBeNull();
        expect(s.coldest).toBeNull();
    });

    it('names the biggest slip killer', () => {
        const s = superlatives(rowsFor([
            slip(1, [leg('ann', 'win'), leg('bob', 'loss'), leg('cal', 'win')]),
            slip(2, [leg('ann', 'win'), leg('bob', 'loss'), leg('cal', 'win')])
        ]));
        expect(s.killer.contributor).toBe('bob');
        expect(s.killer.soloKills).toBe(2);
    });

    it('awards no killer when no slip died on one leg', () => {
        expect(superlatives(rowsFor([slip(1, [leg('ann', 'win'), leg('bob', 'win')], 'won')])).killer)
            .toBeNull();
    });

    // Being the only person with a record must not make you both hottest and
    // coldest — a "cold" badge on the one guy picking is just abuse.
    it('never gives the same person hottest and coldest', () => {
        const s = superlatives(rowsFor([
            slip(1, [leg('ann', 'win')]), slip(2, [leg('ann', 'loss')]), slip(3, [leg('ann', 'win')])
        ]));
        expect(s.coldest).toBeNull();
    });

    it('only calls someone cold when they are actually under water', () => {
        const s = superlatives(rowsFor([
            slip(1, [leg('ann', 'win'), leg('bob', 'win')]),
            slip(2, [leg('ann', 'win'), leg('bob', 'win')])
        ]));
        expect(s.coldest).toBeNull();      // 100% and 100% — nobody is cold
    });

    it('names the longest shot anyone landed', () => {
        const s = superlatives(rowsFor([
            slip(1, [leg('ann', 'win', -300), leg('bob', 'win', 120)]),
            slip(2, [leg('ann', 'win', -250), leg('bob', 'win', -110)])
        ]));
        expect(s.longest.contributor).toBe('bob');
        expect(s.longest.bestOdds).toBe(120);
    });

    it('awards nothing on an empty board', () => {
        const s = superlatives(contributorStats([], MEMBERS));
        expect(s).toEqual({ perfect: null, hottest: null, coldest: null, killer: null, longest: null });
    });
});
