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
