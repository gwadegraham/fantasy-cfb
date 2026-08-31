const { resolveLeg, deriveParlayStatus } = require('../modules/parlay-resolve');

// A minimal game fixture matching the Game schema shape.
function mkGame(overrides) {
    return {
        completed: true,
        homeTeam: 'Alabama',
        awayTeam: 'LSU',
        homePoints: 24,
        awayPoints: 31,
        teamStats: null,
        ...overrides
    };
}

function mkLeg(overrides) {
    return { result: 'pending', betType: 'spread', selection: '', line: 0, odds: -110, ...overrides };
}

describe('resolveLeg — stat_over_under', () => {
    const gameWithStats = mkGame({
        teamStats: {
            home: { totalYards: 385, rushingYards: 140, turnovers: 2, netPassingYards: 245 },
            away: { totalYards: 420, rushingYards: 180, turnovers: 1, netPassingYards: 240 }
        }
    });

    it('wins when actual > line and picked over', () => {
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'LSU Over 350 Total Yards',
            line: 350,
            statCategory: 'totalYards',
            statTeamSide: 'away'
        });
        expect(resolveLeg(leg, gameWithStats)).toBe('win');
    });

    it('loses when actual < line and picked over', () => {
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'Alabama Over 400 Total Yards',
            line: 400,
            statCategory: 'totalYards',
            statTeamSide: 'home'
        });
        expect(resolveLeg(leg, gameWithStats)).toBe('loss');
    });

    it('wins when actual < line and picked under', () => {
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'Alabama Under 2.5 Turnovers',
            line: 2.5,
            statCategory: 'turnovers',
            statTeamSide: 'home'
        });
        expect(resolveLeg(leg, gameWithStats)).toBe('win');
    });

    it('pushes when actual equals line', () => {
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'Alabama Over 140 Rush Yards',
            line: 140,
            statCategory: 'rushingYards',
            statTeamSide: 'home'
        });
        expect(resolveLeg(leg, gameWithStats)).toBe('push');
    });

    it('stays pending when game has no teamStats', () => {
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'LSU Over 300 Total Yards',
            line: 300,
            statCategory: 'totalYards',
            statTeamSide: 'away'
        });
        expect(resolveLeg(leg, mkGame())).toBe('pending');
    });

    it('stays pending when statCategory is missing from the leg', () => {
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'LSU Over 300 Total Yards',
            line: 300,
            statTeamSide: 'away'
        });
        expect(resolveLeg(leg, gameWithStats)).toBe('pending');
    });

    it('stays pending when game is not completed', () => {
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'LSU Over 300 Total Yards',
            line: 300,
            statCategory: 'totalYards',
            statTeamSide: 'away'
        });
        expect(resolveLeg(leg, mkGame({ completed: false }))).toBe('pending');
    });

    it('works with Mongoose Map-like .get accessor', () => {
        const statsMap = new Map([
            ['home', { totalYards: 385 }],
            ['away', { totalYards: 420 }]
        ]);
        const game = mkGame({ teamStats: statsMap });
        const leg = mkLeg({
            betType: 'stat_over_under',
            selection: 'LSU Over 400 Total Yards',
            line: 400,
            statCategory: 'totalYards',
            statTeamSide: 'away'
        });
        expect(resolveLeg(leg, game)).toBe('win');
    });
});

describe('resolveLeg — existing types still work', () => {
    const game = mkGame();

    it('resolves spread correctly', () => {
        const leg = mkLeg({ betType: 'spread', selection: 'LSU -3', line: -3 });
        expect(resolveLeg(leg, game)).toBe('win');
    });

    it('resolves moneyline correctly', () => {
        const leg = mkLeg({ betType: 'moneyline', selection: 'LSU ML' });
        expect(resolveLeg(leg, game)).toBe('win');
    });

    it('resolves over_under correctly', () => {
        const leg = mkLeg({ betType: 'over_under', selection: 'Over 50', line: 50 });
        expect(resolveLeg(leg, game)).toBe('win');
    });
});

describe('deriveParlayStatus', () => {
    it('returns won when all non-push legs win', () => {
        expect(deriveParlayStatus([
            { result: 'win' }, { result: 'win' }, { result: 'push' }
        ])).toBe('won');
    });

    it('returns lost when any leg loses', () => {
        expect(deriveParlayStatus([
            { result: 'win' }, { result: 'loss' }
        ])).toBe('lost');
    });

    it('returns pending when a stat leg is still pending', () => {
        expect(deriveParlayStatus([
            { result: 'win' }, { result: 'pending' }
        ])).toBe('pending');
    });
});
