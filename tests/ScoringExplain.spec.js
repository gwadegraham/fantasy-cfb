// explainGame() powers the member-facing "why did this game score this?"
// breakdown. It must never drift from the real scorer, so every case asserts
// its summed points equal evaluate()'s total for the same inputs.

const scoring = require('../modules/scoring');
const { resolveConfig } = require('../modules/scoring-defaults');

const ranks = (r) => ({ polls: [{ poll: 'AP Top 25', ranks: r }] });
const win = (o = {}) => ({
    seasonType: 'regular', notes: '', conferenceGame: !!o.conf,
    homeId: 1, awayId: 2, homeTeam: 'Us', awayTeam: 'Opp',
    homePoints: 30, awayPoints: 20,
    homeConference: o.homeConf || 'SEC', awayConference: o.awayConf || 'ACC'
});
const bowl = { seasonType: 'postseason', notes: 'Famous Toastery Bowl', homeId: 1, awayId: 2, homeTeam: 'Us', awayTeam: 'Opp', homePoints: 30, awayPoints: 20 };
const quarterfinal = { seasonType: 'postseason', notes: 'CFP Quarterfinal at the Rose Bowl Game', homeId: 1, awayId: 2, homeTeam: 'Us', awayTeam: 'Opp', homePoints: 30, awayPoints: 20 };

function parity(model, league, game, rankings, overrides) {
    const cfg = resolveConfig(league, overrides || null);
    const total = scoring.evaluate(model, 1, game, rankings, cfg);
    const ex = scoring.explainGame(model, 1, game, rankings, cfg);
    expect(ex.total).toBe(total);
    return ex;
}

describe('explainGame parity with evaluate', () => {
    it('matches for Claunts regular wins (conference / non-conf ranked / unranked)', () => {
        parity('claunts', 'claunts-league', win({ conf: true }), ranks([{ school: 'Opp', rank: 5 }]));
        parity('claunts', 'claunts-league', win({ conf: false }), ranks([{ school: 'Opp', rank: 5 }]));
        parity('claunts', 'claunts-league', win({ conf: false }), ranks([]));
    });

    it('matches for a Graham stacking win', () => {
        const ex = parity('graham', 'graham-league', win({ conf: true }), ranks([{ school: 'Opp', rank: 5 }]));
        expect(ex.matched.length).toBeGreaterThan(1); // base + conference + top-10 stack
    });

    it('matches for postseason (bowl appearance+win, and a top-4 quarterfinal)', () => {
        parity('claunts', 'claunts-league', bowl, ranks([]));
        parity('graham', 'graham-league', quarterfinal, ranks([]));
    });

    it('reports the single matched rule for a Claunts non-conference ranked win', () => {
        const ex = parity('claunts', 'claunts-league', win({ conf: false }), ranks([{ school: 'Opp', rank: 5 }]));
        expect(ex.matched.length).toBe(1);
        expect(ex.matched[0].label).toBe('Non-conference win vs. ranked opponent');
        expect(ex.matched[0].points).toBe(3);
    });

    it('reflects an opted-in Claunts tier and stays in parity', () => {
        const ex = parity('claunts', 'claunts-league', win({ conf: true }), ranks([{ school: 'Opp', rank: 5 }]), { enabled: ['confWinTop10'] });
        expect(ex.matched[0].label).toContain('Conference win vs. opponent ranked');
    });
});
