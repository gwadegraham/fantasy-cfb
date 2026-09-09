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

describe('resolveLeg — spread, including alternate lines', () => {
    // Alabama 24, LSU 31 — the away side wins by 7.
    const game = mkGame();

    test.each([
        ['away favorite covers the number it laid', 'away', -3, 'win'],
        ['away favorite laying more than it won by loses', 'away', -10, 'loss'],
        ['away favorite landing exactly on the number pushes', 'away', -7, 'push'],
        ['away dog covers with points it did not need', 'away', 3.5, 'win'],
        ['home dog getting more than it lost by covers', 'home', 10, 'win'],
        ['home dog getting less than it lost by does not', 'home', 3, 'loss'],
        ['home dog landing exactly on the number pushes', 'home', 7, 'push']
    ])('%s', (_label, teamSide, line, expected) => {
        const leg = mkLeg({ betType: 'spread', teamSide, line, selection: 'alt' });
        expect(resolveLeg(leg, game)).toBe(expected);
    });

    // Regression. The away branch used to negate the stored line — it graded
    // "LSU -10" as though LSU were getting 10 — so every away spread that
    // wasn't a blowout resolved backwards. It went unnoticed because the board
    // only ever offered the book number, where the error is usually invisible;
    // the alt ladder makes the gap between the pick and the result wide enough
    // to flip results routinely.
    test('an away favorite laying too many points is not credited a win', () => {
        const leg = mkLeg({ betType: 'spread', selection: 'LSU -10', line: -10 });
        expect(resolveLeg(leg, game)).toBe('loss');
    });

    test('grades a leg written before teamSide existed off its selection text', () => {
        expect(resolveLeg(mkLeg({ betType: 'spread', selection: 'LSU -3', line: -3 }), game)).toBe('win');
        expect(resolveLeg(mkLeg({ betType: 'spread', selection: 'Alabama +3', line: 3 }), game)).toBe('loss');
    });

    test('the stored side beats the selection text when they disagree', () => {
        // Selection text is a display string; a name that appears in both teams
        // ("Miami" @ "Miami (OH)") makes reading a side out of it a coin toss.
        const leg = mkLeg({ betType: 'spread', selection: 'LSU -3', teamSide: 'home', line: 3 });
        expect(resolveLeg(leg, game)).toBe('loss');
    });

    test('stays pending rather than guessing when a spread leg has no line', () => {
        expect(resolveLeg(mkLeg({ betType: 'spread', teamSide: 'away', line: null }), game)).toBe('pending');
    });
});

describe('resolveLeg — moneyline side', () => {
    const game = mkGame();

    test('uses the stored side', () => {
        expect(resolveLeg(mkLeg({ betType: 'moneyline', teamSide: 'away', selection: 'x' }), game)).toBe('win');
        expect(resolveLeg(mkLeg({ betType: 'moneyline', teamSide: 'home', selection: 'x' }), game)).toBe('loss');
    });

    test('a tie pushes whichever side was picked', () => {
        const tied = mkGame({ homePoints: 21, awayPoints: 21 });
        expect(resolveLeg(mkLeg({ betType: 'moneyline', teamSide: 'home' }), tied)).toBe('push');
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
