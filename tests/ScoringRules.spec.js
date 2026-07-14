const scoring = require('../modules/scoring');

// Rankings come from a fetch to /rankings; mock it per test.
function mockRankings(ranks) {
    global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ polls: [{ poll: 'AP Top 25', ranks }] }) }));
}
function mockNoRankings() { // week with no rankings loaded -> endpoint returns {message}
    global.fetch = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ message: 'No rankings found' }) }));
}

// Home team (id 1) beats away team (id 2).
function regularWin({ conf = false, homeConf = 'SEC', awayConf = 'ACC', opp = 'Opp' } = {}) {
    return {
        seasonType: 'regular', notes: '', conferenceGame: conf,
        homeId: 1, awayId: 2, homeTeam: 'MyTeam', awayTeam: opp,
        homePoints: 30, awayPoints: 20, homeConference: homeConf, awayConference: awayConf
    };
}
const quarterfinal = {
    seasonType: 'postseason', notes: 'CFP Quarterfinal at the Rose Bowl Game',
    homeId: 1, awayId: 2, homeTeam: 'A', awayTeam: 'B', homePoints: 30, awayPoints: 20
};

beforeEach(() => { process.env.URL = 'http://test.local'; });
afterEach(() => { jest.restoreAllMocks(); });

describe('Claunts (V1) scoring rules', () => {
    it('non-conference win vs unranked = 1', async () => {
        mockRankings([]);
        expect(await scoring.calculateScoreV1(1, regularWin(), 5)).toBe(1);
    });
    it('non-conference win vs ranked = 3', async () => {
        mockRankings([{ school: 'Opp', rank: 5 }]);
        expect(await scoring.calculateScoreV1(1, regularWin(), 5)).toBe(3);
    });
    it('conference win vs unranked = 2', async () => {
        mockRankings([]);
        expect(await scoring.calculateScoreV1(1, regularWin({ conf: true, awayConf: 'SEC' }), 5)).toBe(2);
    });
    it('conference win vs ranked = 2 (not 3)', async () => {
        mockRankings([{ school: 'Opp', rank: 5 }]);
        expect(await scoring.calculateScoreV1(1, regularWin({ conf: true, awayConf: 'SEC' }), 5)).toBe(2);
    });
    it('CFP quarterfinal appearance = 8 (not 15)', async () => {
        mockRankings([]);
        expect(await scoring.calculateScoreV1(1, quarterfinal, 1)).toBe(8);
    });
    it('does not crash when a week has no rankings loaded', async () => {
        mockNoRankings();
        expect(await scoring.calculateScoreV1(1, regularWin(), 5)).toBe(1);
    });
});

describe('Graham (V2) scoring rules (additive)', () => {
    it('conference win vs unranked = 2 (base + conference)', async () => {
        mockRankings([]);
        expect(await scoring.calculateScoreV2(1, regularWin({ conf: true, awayConf: 'SEC' }), 5)).toBe(2);
    });
    it('win vs #11-25 = base + 1 (rank 11 counts as #11-25)', async () => {
        mockRankings([{ school: 'Opp', rank: 11 }]);
        expect(await scoring.calculateScoreV2(1, regularWin(), 5)).toBe(2); // 1 base + 1 ranked
    });
    it('win vs #1-10 = base + 2', async () => {
        mockRankings([{ school: 'Opp', rank: 10 }]);
        expect(await scoring.calculateScoreV2(1, regularWin(), 5)).toBe(3); // 1 base + 2 ranked
    });
    it('non-P5 beats a ranked P5 team stacks all bonuses', async () => {
        mockRankings([{ school: 'Opp', rank: 5 }]);
        // 1 base + 2 (ranked #1-10) + 2 (non-P5 over P5) = 5
        expect(await scoring.calculateScoreV2(1, regularWin({ homeConf: 'Sun Belt', awayConf: 'SEC' }), 5)).toBe(5);
    });
    it('does not crash when a week has no rankings loaded', async () => {
        mockNoRankings();
        expect(await scoring.calculateScoreV2(1, regularWin({ conf: true, awayConf: 'SEC' }), 5)).toBe(2);
    });
});
