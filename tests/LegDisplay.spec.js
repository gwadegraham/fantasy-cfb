// public/leg-display.js — what a parlay leg's second line says.
//
// Written because the betting page kept showing "Stanford @ Duke" under a leg
// whose game had finished hours earlier. The tick beside it already said the
// leg won; the only thing the row would not tell you was the score.

const { isFinal, needsManualGrading, finalScore, finalScoreText, matchupText } = require('../public/leg-display.js');

const game = (o) => Object.assign({
    awayTeam: 'Stanford', homeTeam: 'Duke', awayAbbr: 'STAN', homeAbbr: 'DUKE',
    completed: true, awayPoints: 7, homePoints: 21
}, o);

describe('isFinal', () => {
    it('is true only with the flag AND both scores', () => {
        expect(isFinal(game())).toBe(true);
    });

    it('is false before the game ends', () => {
        expect(isFinal(game({ completed: false }))).toBe(false);
    });

    // `completed` comes from CFBD's /games, and modules/retrieve-games.js
    // deliberately leaves the points alone when they arrive null — so a game can
    // read completed for a tick with nothing to print.
    it('is false when the flag is set but a score is missing', () => {
        expect(isFinal(game({ homePoints: null }))).toBe(false);
        expect(isFinal(game({ awayPoints: null }))).toBe(false);
        expect(isFinal(game({ homePoints: null, awayPoints: null }))).toBe(false);
    });

    // A 0-0 game is a real score, and `0` is falsy — the reason this is an
    // explicit null check rather than a truthiness one.
    it('is true for a scoreless game', () => {
        expect(isFinal(game({ awayPoints: 0, homePoints: 0 }))).toBe(true);
    });

    it('handles a missing game', () => {
        expect(isFinal(null)).toBe(false);
        expect(isFinal(undefined)).toBe(false);
    });
});

describe('finalScore', () => {
    it('reads away side first, the way a scoreboard does', () => {
        expect(finalScore(game())).toEqual({
            away: 'STAN', home: 'DUKE', awayPoints: 7, homePoints: 21, winner: 'home'
        });
    });

    it('names the away side when they won', () => {
        expect(finalScore(game({ awayPoints: 28, homePoints: 10 })).winner).toBe('away');
    });

    // Bolding both sides of a tie would read as a bug rather than a rarity.
    it('picks no winner on a tie', () => {
        expect(finalScore(game({ awayPoints: 21, homePoints: 21 })).winner).toBeNull();
    });

    // A team CFBD has no abbreviation for should cost the row its tidiness, not
    // its score.
    it('falls back to full team names without abbreviations', () => {
        const s = finalScore(game({ awayAbbr: null, homeAbbr: undefined }));
        expect(s.away).toBe('Stanford');
        expect(s.home).toBe('Duke');
    });

    it('is null while the game is unfinished', () => {
        expect(finalScore(game({ completed: false }))).toBeNull();
        expect(finalScore(null)).toBeNull();
    });
});

describe('finalScoreText', () => {
    it('renders the line the row shows', () => {
        expect(finalScoreText(game())).toBe('STAN 7 – 21 DUKE');
    });

    it('is null with no final score', () => {
        expect(finalScoreText(game({ completed: false }))).toBeNull();
    });
});

describe('matchupText', () => {
    it('is what the row says before kickoff', () => {
        expect(matchupText(game({ completed: false }))).toBe('Stanford @ Duke');
    });

    it('handles a missing game', () => {
        expect(matchupText(null)).toBeNull();
    });
});

// A custom leg sat pending for a week on prod. It was on a slip that had already
// lost, so nothing was pressing anyone to grade it — and nothing on the page
// said it was waiting.
describe('needsManualGrading', () => {
    const custom = (o) => Object.assign({ betType: 'custom', result: 'pending' }, o);

    it('flags a custom leg once its game is final', () => {
        expect(needsManualGrading(custom(), game())).toBe(true);
    });

    // THE reason this is not just "pending + final". Every spread leg sits in
    // exactly that state between the whistle and the next scoring run, so
    // flagging them would warn on four rows every Saturday about something that
    // fixes itself — and a flag that cries wolf is how the real one was missed.
    it('does not flag a leg the resolver will grade on its own', () => {
        ['spread', 'moneyline', 'over_under', 'stat_over_under'].forEach(betType => {
            expect(needsManualGrading(custom({ betType }), game())).toBe(false);
        });
    });

    it('does not flag before the game is final', () => {
        expect(needsManualGrading(custom(), game({ completed: false }))).toBe(false);
        expect(needsManualGrading(custom(), game({ homePoints: null }))).toBe(false);
    });

    it('does not flag a leg that already has a result', () => {
        ['win', 'loss', 'push'].forEach(result => {
            expect(needsManualGrading(custom({ result }), game())).toBe(false);
        });
    });

    it('treats a leg with no result at all as pending', () => {
        expect(needsManualGrading({ betType: 'custom' }, game())).toBe(true);
    });

    it('handles a missing leg or game', () => {
        expect(needsManualGrading(null, game())).toBe(false);
        expect(needsManualGrading(custom(), null)).toBe(false);
    });
});
