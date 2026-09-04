const { normalizeScoreboardGame } = require('../modules/scoreboard');

describe('normalizeScoreboardGame', () => {
    it('extracts flat fields from a nested scoreboard response', () => {
        const sb = {
            id: 401628455,
            status: 'in_progress',
            period: 3,
            clock: '7:42',
            possession: 'LSU',
            homeTeam: { id: 99, name: 'LSU', points: 52, lineScores: [14, 21, 17] },
            awayTeam: { id: 333, name: 'Alabama', points: 7, lineScores: [0, 7, 0] }
        };

        const result = normalizeScoreboardGame(sb);

        expect(result).toEqual({
            id: 401628455,
            homePoints: 52,
            awayPoints: 7,
            homeLineScores: [14, 21, 17],
            awayLineScores: [0, 7, 0],
            completed: false,
            period: 3,
            clock: '7:42',
            possession: 'LSU',
            status: 'in_progress'
        });
    });

    it('marks completed when status is "completed"', () => {
        const sb = {
            id: 1,
            status: 'completed',
            homeTeam: { points: 31 },
            awayTeam: { points: 24 }
        };

        expect(normalizeScoreboardGame(sb).completed).toBe(true);
    });

    it('marks completed when status is "final"', () => {
        const sb = {
            id: 2,
            status: 'final',
            homeTeam: { points: 10 },
            awayTeam: { points: 3 }
        };

        expect(normalizeScoreboardGame(sb).completed).toBe(true);
    });

    it('handles missing team objects gracefully', () => {
        const sb = { id: 3, status: 'scheduled' };

        const result = normalizeScoreboardGame(sb);

        expect(result.id).toBe(3);
        expect(result.completed).toBe(false);
        expect(result.homePoints).toBeUndefined();
        expect(result.awayPoints).toBeUndefined();
    });

    it('handles null points (game not started)', () => {
        const sb = {
            id: 4,
            status: 'scheduled',
            homeTeam: { id: 99, name: 'LSU', points: null },
            awayTeam: { id: 333, name: 'Alabama', points: null }
        };

        const result = normalizeScoreboardGame(sb);

        expect(result.homePoints).toBeUndefined();
        expect(result.awayPoints).toBeUndefined();
    });

    it('preserves zero scores (game started, no points yet)', () => {
        const sb = {
            id: 5,
            status: 'in_progress',
            period: 1,
            clock: '15:00',
            homeTeam: { points: 0 },
            awayTeam: { points: 0 }
        };

        const result = normalizeScoreboardGame(sb);

        expect(result.homePoints).toBe(0);
        expect(result.awayPoints).toBe(0);
    });

    it('extracts homeWinProb when present', () => {
        const sb = {
            id: 9, status: 'in_progress',
            homeTeam: { points: 14 }, awayTeam: { points: 7 },
            homeWinProb: 0.72
        };
        const result = normalizeScoreboardGame(sb);
        expect(result.homeWinProb).toBe(0.72);
        expect(result.completed).toBe(false);
    });

    it('omits homeWinProb when absent', () => {
        const sb = { id: 10, status: 'in_progress', homeTeam: { points: 0 }, awayTeam: { points: 0 } };
        expect(normalizeScoreboardGame(sb).homeWinProb).toBeUndefined();
    });

    it('extracts situation and lastPlay while a game is in progress', () => {
        const sb = {
            id: 11, status: 'in_progress', period: 3, clock: '7:42', possession: 'LSU',
            situation: '3rd & 7 at LSU 32',
            lastPlay: 'Garrett Nussmeier pass complete to Aaron Anderson for 8 yds',
            homeTeam: { points: 21 }, awayTeam: { points: 17 }
        };
        const result = normalizeScoreboardGame(sb);
        expect(result.situation).toBe('3rd & 7 at LSU 32');
        expect(result.lastPlay).toBe('Garrett Nussmeier pass complete to Aaron Anderson for 8 yds');
    });

    it('omits situation and lastPlay when CFBD sends null (pre-game)', () => {
        const sb = {
            id: 12, status: 'scheduled', situation: null, lastPlay: null,
            homeTeam: { points: null }, awayTeam: { points: null }
        };
        const result = normalizeScoreboardGame(sb);
        expect(result.situation).toBeUndefined();
        expect(result.lastPlay).toBeUndefined();
    });

    // CFBD keeps lastPlay populated on a finished game ("End of 4th quarter."),
    // so normalize still surfaces it — updateFromScoreboard is what nulls both
    // out on the completion tick. Guards the ordering of those two $set groups.
    it('still reports lastPlay on a completed game (the clear happens on write)', () => {
        const sb = {
            id: 13, status: 'completed', lastPlay: 'End of 4th quarter.',
            homeTeam: { points: 31 }, awayTeam: { points: 24 }
        };
        const result = normalizeScoreboardGame(sb);
        expect(result.completed).toBe(true);
        expect(result.lastPlay).toBe('End of 4th quarter.');
    });
});
