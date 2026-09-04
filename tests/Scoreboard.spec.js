const {
    normalizeScoreboardGame, buildSnapshot, buildFinalSnapshot, isDuplicateSnapshot
} = require('../modules/scoreboard');

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

    // Regression: this used to read a top-level sb.homeWinProb, which CFBD has
    // never sent — the real field is nested per team. The old test asserted the
    // same wrong shape, so it passed while liveHomeWinProb was never written.
    it('extracts win probability from the nested homeTeam object', () => {
        const sb = {
            id: 9, status: 'in_progress',
            homeTeam: { points: 14, winProbability: 0.351 },
            awayTeam: { points: 7, winProbability: 0.649 }
        };
        const result = normalizeScoreboardGame(sb);
        expect(result.homeWinProb).toBe(0.351);
        expect(result.completed).toBe(false);
    });

    it('ignores a top-level homeWinProb, which is not a real CFBD field', () => {
        const sb = {
            id: 9.5, status: 'in_progress', homeWinProb: 0.72,
            homeTeam: { points: 14 }, awayTeam: { points: 7 }
        };
        expect(normalizeScoreboardGame(sb).homeWinProb).toBeUndefined();
    });

    it('omits win probability when absent', () => {
        const sb = { id: 10, status: 'in_progress', homeTeam: { points: 0 }, awayTeam: { points: 0 } };
        expect(normalizeScoreboardGame(sb).homeWinProb).toBeUndefined();
    });

    // CFBD sends winProbability: null outside in_progress — both before kickoff
    // and once the game is final. Neither is an error; both mean "no sample".
    it('omits win probability when CFBD sends null (scheduled or completed)', () => {
        const pre = { id: 10.1, status: 'scheduled', homeTeam: { winProbability: null }, awayTeam: { winProbability: null } };
        const post = { id: 10.2, status: 'completed', homeTeam: { points: 10, winProbability: null }, awayTeam: { points: 15, winProbability: null } };
        expect(normalizeScoreboardGame(pre).homeWinProb).toBeUndefined();
        expect(normalizeScoreboardGame(post).homeWinProb).toBeUndefined();
    });

    it('preserves a 0 win probability rather than dropping it as falsy', () => {
        const sb = {
            id: 10.3, status: 'in_progress',
            homeTeam: { points: 0, winProbability: 0 }, awayTeam: { points: 48, winProbability: 1 }
        };
        expect(normalizeScoreboardGame(sb).homeWinProb).toBe(0);
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

describe('win-probability snapshots', () => {
    const NOW = new Date('2026-09-05T20:30:00Z');
    const live = (over = {}) => Object.assign({
        completed: false, period: 3, clock: '7:42', homeWinProb: 0.62,
        homePoints: 21, awayPoints: 17
    }, over);

    describe('buildSnapshot', () => {
        it('captures the full game moment, not just the probability', () => {
            const snap = buildSnapshot(live({
                situation: '3rd & 7 at LSU 32', lastPlay: 'Nussmeier pass complete for 8 yds'
            }), NOW);
            expect(snap).toEqual({
                at: NOW, period: 3, clock: '7:42', homeWinProb: 0.62,
                homePoints: 21, awayPoints: 17,
                situation: '3rd & 7 at LSU 32', lastPlay: 'Nussmeier pass complete for 8 yds'
            });
        });

        it('records nothing when CFBD withheld the probability', () => {
            expect(buildSnapshot(live({ homeWinProb: undefined }), NOW)).toBeNull();
        });

        it('records nothing for a completed game — the final point is built separately', () => {
            expect(buildSnapshot(live({ completed: true }), NOW)).toBeNull();
        });

        it('keeps a 0 probability, which is a real sample and not an absent one', () => {
            expect(buildSnapshot(live({ homeWinProb: 0 }), NOW).homeWinProb).toBe(0);
        });
    });

    describe('buildFinalSnapshot', () => {
        const final = (h, a) => buildFinalSnapshot(
            { completed: true, period: 4, homePoints: h, awayPoints: a }, NOW
        );

        it('closes the curve at 1 when the home team won', () => {
            expect(final(31, 24)).toEqual({
                at: NOW, period: 4, clock: '0:00', homeWinProb: 1, homePoints: 31, awayPoints: 24
            });
        });

        it('closes the curve at 0 when the away team won', () => {
            expect(final(10, 15).homeWinProb).toBe(0);
        });

        it('returns null for a game still in progress', () => {
            expect(buildFinalSnapshot(live(), NOW)).toBeNull();
        });

        it('returns null when the final score is missing', () => {
            expect(buildFinalSnapshot({ completed: true, homePoints: null, awayPoints: null }, NOW)).toBeNull();
        });
    });

    describe('isDuplicateSnapshot', () => {
        // The poller runs on a wall clock while the game clock stops, so a
        // timeout or a review can produce two ticks at the identical moment.
        it('rejects a repeat of the same game moment', () => {
            const a = buildSnapshot(live(), NOW);
            const b = buildSnapshot(live(), new Date(NOW.getTime() + 120000));
            expect(isDuplicateSnapshot(a, b)).toBe(true);
        });

        it('accepts the next tick once the clock has moved', () => {
            const a = buildSnapshot(live(), NOW);
            const b = buildSnapshot(live({ clock: '5:12' }), NOW);
            expect(isDuplicateSnapshot(a, b)).toBe(false);
        });

        it('accepts a tick where the clock held but the probability moved', () => {
            const a = buildSnapshot(live(), NOW);
            const b = buildSnapshot(live({ homeWinProb: 0.71 }), NOW);
            expect(isDuplicateSnapshot(a, b)).toBe(false);
        });

        it('accepts the first snapshot of a game', () => {
            expect(isDuplicateSnapshot(null, buildSnapshot(live(), NOW))).toBe(false);
        });

        // Same clock reading, different quarter — 7:42 comes around four times.
        it('does not confuse the same clock in a different period', () => {
            const a = buildSnapshot(live({ period: 2 }), NOW);
            const b = buildSnapshot(live({ period: 3 }), NOW);
            expect(isDuplicateSnapshot(a, b)).toBe(false);
        });
    });
});
