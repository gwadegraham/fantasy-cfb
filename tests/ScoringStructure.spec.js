// Phase 2 behavior: the engine honors structural overrides in a resolved
// config — a flipped combine mode and disabled postseason events.

const scoring = require('../modules/scoring');
const { resolveConfig, fieldsForModel } = require('../modules/scoring-defaults');

function mockRankings(ranks) {
    global.fetch = jest.fn(() => Promise.resolve({
        json: () => Promise.resolve({ polls: [{ poll: 'AP Top 25', ranks }] })
    }));
}
afterEach(() => { jest.restoreAllMocks(); });

function homeWin({ conf = false, homeConf = 'SEC', awayConf = 'ACC', notes = null, seasonType = 'regular' } = {}) {
    return {
        seasonType, notes, conferenceGame: conf,
        homeId: 1, awayId: 2, homeTeam: 'MyTeam', awayTeam: 'Opp',
        homePoints: 30, awayPoints: 20, homeConference: homeConf, awayConference: awayConf
    };
}
const quarterfinal = {
    seasonType: 'postseason', notes: 'CFP Quarterfinal at the Rose Bowl Game',
    homeId: 1, awayId: 2, homeTeam: 'A', awayTeam: 'B', homePoints: 30, awayPoints: 20
};
const bowl = {
    seasonType: 'postseason', notes: 'Famous Toastery Bowl',
    homeId: 1, awayId: 2, homeTeam: 'A', awayTeam: 'B', homePoints: 30, awayPoints: 20
};

describe('combine mode override', () => {
    it("Claunts flipped to 'sum' stacks conference + ranked instead of first-match", async () => {
        mockRankings([{ school: 'Opp', rank: 5 }]);
        // Default (first): conference win vs ranked = 2. Flipped to sum:
        // conferenceWin(2) + baseWin(1) both match => 3 (nonConfRankedWin needs
        // a non-conference game, so it does not apply here).
        const cfg = resolveConfig('claunts-league', { combineMode: 'sum' });
        expect(cfg.combineMode).toBe('sum');
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: true, awayConf: 'SEC' }), 5, 2025, cfg)).toBe(3);
    });

    it("Graham forced to 'first' takes only the base win, not additive bonuses", async () => {
        mockRankings([{ school: 'Opp', rank: 5 }]);
        // Default (sum): base 1 + top10 2 = 3. Forced 'first': just base 1.
        const cfg = resolveConfig('graham-league', { combineMode: 'first' });
        expect(await scoring.calculateScoreV2(1, homeWin(), 5, 2025, cfg)).toBe(1);
    });
});

describe('Fixed-shape optional win categories (Claunts)', () => {
    it('are off by default, so scoring is unchanged', async () => {
        mockRankings([{ school: 'Opp', rank: 5 }]); // #5 => top-10
        const cfg = resolveConfig('claunts-league', null);
        // A conference win vs a top-10 opponent still scores the flat Conference win (2).
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: true, awayConf: 'SEC' }), 5, 2025, cfg)).toBe(2);
        // A non-conference win vs a top-10 opponent still scores the flat ranked win (3).
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: false }), 5, 2025, cfg)).toBe(3);
    });

    it('opting into "Conference win vs #1-10" scores it above the flat conference win', async () => {
        mockRankings([{ school: 'Opp', rank: 5 }]);
        const cfg = resolveConfig('claunts-league', { enabled: ['confWinTop10'] });
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: true, awayConf: 'SEC' }), 5, 2025, cfg)).toBe(4);
    });

    it('a conference win outside the opted-in tier falls back to the flat conference win', async () => {
        mockRankings([{ school: 'Opp', rank: 15 }]); // #15 => #11-25, not top-10
        const cfg = resolveConfig('claunts-league', { enabled: ['confWinTop10'] });
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: true, awayConf: 'SEC' }), 5, 2025, cfg)).toBe(2);
    });

    it('non-conference tiers (flat ranked rule turned off) score by rank', async () => {
        const cfg = resolveConfig('claunts-league', {
            enabled: ['nonConfWinTop10', 'nonConfWinTop25'], disabled: ['nonConfRankedWin']
        });
        mockRankings([{ school: 'Opp', rank: 5 }]);    // top-10
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: false }), 5, 2025, cfg)).toBe(4);
        mockRankings([{ school: 'Opp', rank: 15 }]);   // #11-25
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: false }), 5, 2025, cfg)).toBe(3);
        mockRankings([]);                               // unranked -> base win
        expect(await scoring.calculateScoreV1(1, homeWin({ conf: false }), 5, 2025, cfg)).toBe(1);
    });

    it('fieldsForModel marks the new categories toggleable + off by default, on when opted in', () => {
        const off = fieldsForModel('claunts', [], []).find(f => f.condition === 'confWinTop10');
        expect(off).toMatchObject({ toggleable: true, defaultOff: true, enabled: false, group: 'regular' });
        const on = fieldsForModel('claunts', [], ['confWinTop10']).find(f => f.condition === 'confWinTop10');
        expect(on.enabled).toBe(true);
    });
});

describe('disabled postseason events', () => {
    it('disabling bowlWin (Claunts) leaves only the bowl appearance points', async () => {
        mockRankings([]);
        // Default: appearance 4 + win 5 = 9. Disable bowlWin -> 4.
        const cfg = resolveConfig('claunts-league', { disabled: ['bowlWin'] });
        expect(await scoring.calculateScoreV1(1, bowl, 1, 2025, cfg)).toBe(4);
    });

    it('disabling the top-4 bye bonus (Graham) drops QF from 12 to 6', async () => {
        mockRankings([]);
        // Home team (id 1) is the top-4 seed. Default QF = 6 + 6 bye = 12.
        const cfg = resolveConfig('graham-league', { disabled: ['cfpQuarterfinalTop4Bonus'] });
        expect(await scoring.calculateScoreV2(1, quarterfinal, 1, 2025, cfg)).toBe(6);
    });

    it('disabling the entire bowl set (Claunts) makes a bowl win score 0', async () => {
        mockRankings([]);
        const cfg = resolveConfig('claunts-league', { disabled: ['bowlAppearance', 'bowlWin'] });
        expect(await scoring.calculateScoreV1(1, bowl, 1, 2025, cfg)).toBe(0);
    });
});

// A league can widen which conferences count as "power" for the non-P5 upset
// bonus. Motivating case: Notre Dame sits in FBS Independents, so under the bare
// four it drew the +2 underdog bonus on every power-conference win — ~19 points a
// season for a top-5 program the rule was never meant to reward.
describe('powerConferences override (non-P5 upset bonus)', () => {
    const POWER_PLUS = ['ACC', 'Big 12', 'Big Ten', 'SEC', 'FBS Independents'];
    const ndOverAcc = () => homeWin({ homeConf: 'FBS Independents', awayConf: 'ACC' });
    const macOverBigTen = () => homeWin({ homeConf: 'Mid-American', awayConf: 'Big Ten' });

    it('defaults to the bare four, so an unconfigured league scores as before', async () => {
        mockRankings([]);
        const cfg = resolveConfig('graham-league', null);
        expect(cfg.powerConferences).toBeUndefined();
        // base 1 + nonP5 upset 2
        expect(await scoring.calculateScoreV2(1, ndOverAcc(), 5, 2025, cfg)).toBe(3);
    });

    it('drops the bonus for an independent once the league counts them as power', async () => {
        mockRankings([]);
        const cfg = resolveConfig('graham-league', { powerConferences: POWER_PLUS });
        expect(await scoring.calculateScoreV2(1, ndOverAcc(), 5, 2025, cfg)).toBe(1);   // base only
    });

    it('leaves a genuine Group-of-5 upset paying, and starts paying wins over independents', async () => {
        mockRankings([]);
        const cfg = resolveConfig('graham-league', { powerConferences: POWER_PLUS });
        expect(await scoring.calculateScoreV2(1, macOverBigTen(), 5, 2025, cfg)).toBe(3);
        const macOverNd = homeWin({ homeConf: 'Mid-American', awayConf: 'FBS Independents' });
        expect(await scoring.calculateScoreV2(1, macOverNd, 5, 2025, cfg)).toBe(3);
    });

    it('is inert for Claunts, whose model has no upset rule at all', async () => {
        mockRankings([]);
        const plain = resolveConfig('claunts-league', null);
        const widened = resolveConfig('claunts-league', { powerConferences: POWER_PLUS });
        // Non-conference win vs an unranked opponent = 1 either way.
        expect(await scoring.calculateScoreV1(1, ndOverAcc(), 5, 2025, plain)).toBe(1);
        expect(await scoring.calculateScoreV1(1, ndOverAcc(), 5, 2025, widened)).toBe(1);
    });

    it('falls back to the default when the stored value is malformed', () => {
        [null, 'SEC', [], [''], [42], undefined].forEach(bad => {
            expect(resolveConfig('graham-league', { powerConferences: bad }).powerConferences).toBeUndefined();
        });
        expect(resolveConfig('graham-league', { powerConferences: [' SEC '] }).powerConferences).toEqual(['SEC']);
    });
});

// The gap that let a merged, tested, admin-editable setting do nothing: every
// earlier test either handed evaluate() a config directly or checked what the
// route returned. Nothing covered the path the scoring JOB takes — load the
// config over HTTP, re-resolve it, then score — and that re-resolve was
// dropping the field. These walk the real path.
describe('config survives the load-then-score path', () => {
    const POWER_PLUS = ['ACC', 'Big 12', 'Big Ten', 'SEC', 'FBS Independents'];

    function mockConfigRoute(body) {
        global.fetch = jest.fn((url) => {
            if (String(url).includes('/scoring-config/')) {
                return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(body) });
            }
            return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ polls: [{ poll: 'AP Top 25', ranks: [] }] }) });
        });
    }

    it('carries every stored field through getScoringConfig', async () => {
        mockConfigRoute({
            model: 'graham', values: { baseWin: 1 }, combineMode: 'sum',
            disabled: ['bowlWin'], enabled: [], powerConferences: POWER_PLUS,
            engagementBySeason: { 2026: { captainEnabled: true, captainMultiplier: 2 } }
        });
        const cfg = await scoring.getScoringConfig('graham-league');
        expect(cfg.powerConferences).toEqual(POWER_PLUS);
        expect(cfg.disabled).toEqual(['bowlWin']);
        expect(cfg.engagementBySeason).toEqual({ 2026: { captainEnabled: true, captainMultiplier: 2 } });
    });

    it('scores Notre Dame with the loaded list, not the engine default', async () => {
        const ndOverAcc = homeWin({ homeConf: 'FBS Independents', awayConf: 'ACC' });
        const base = { model: 'graham', values: {}, combineMode: 'sum', disabled: [], enabled: [] };

        mockConfigRoute(Object.assign({}, base, { powerConferences: POWER_PLUS }));
        const closed = await scoring.getScoringConfig('graham-league');
        expect(await scoring.calculateScoreV2(1, ndOverAcc, 5, 2025, closed)).toBe(1);

        mockConfigRoute(base);                                   // league never set one
        const open = await scoring.getScoringConfig('graham-league');
        expect(await scoring.calculateScoreV2(1, ndOverAcc, 5, 2025, open)).toBe(3);
    });
});

describe('fieldsForModel', () => {
    it('marks postseason fields toggleable and reflects disabled state', () => {
        const fields = fieldsForModel('claunts', ['bowlWin']);
        const bowlWin = fields.find(f => f.condition === 'bowlWin');
        const confWin = fields.find(f => f.condition === 'conferenceWin');
        expect(bowlWin).toMatchObject({ group: 'postseason', toggleable: true, enabled: false });
        expect(confWin).toMatchObject({ group: 'regular', toggleable: false, enabled: true });
    });

    it('every field key resolves to a default point value', () => {
        for (const model of ['claunts', 'graham']) {
            const cfg = resolveConfig(model === 'graham' ? 'graham-league' : 'claunts-league', null);
            for (const f of fieldsForModel(model, [])) {
                expect(typeof cfg.values[f.key]).toBe('number');
            }
        }
    });
});
