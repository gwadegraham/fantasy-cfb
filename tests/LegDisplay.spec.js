// public/leg-display.js — what a parlay leg's second line says.
//
// Written because the betting page kept showing "Stanford @ Duke" under a leg
// whose game had finished hours earlier. The tick beside it already said the
// leg won; the only thing the row would not tell you was the score.

const { isFinal, needsManualGrading, finalScore, finalScoreText, matchupText, legTally } = require('../public/leg-display.js');

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

// The history table's "Legs" column. It used to count picks that had a game
// attached, so every settled row read 4/4 and the column said nothing about the
// week it sat on.
describe('legTally', () => {
    const slip = (status, results) => ({
        status,
        legs: results.map(r => (r === null ? {} : { gameId: 1, result: r }))
    });

    it('counts picks in while the week is still live', () => {
        const t = legTally(slip('pending', ['pending', 'pending', null, null]));
        expect(t.text).toBe('2/4');
        expect(t.title).toBe('2 of 4 picks in');
    });

    it('counts legs that hit once the week has settled', () => {
        expect(legTally(slip('lost', ['win', 'win', 'win', 'loss'])).text).toBe('3/4');
        expect(legTally(slip('won', ['win', 'win', 'win', 'win'])).text).toBe('4/4');
    });

    // Matching the payout: deriveParlayStatus drops pushes out of the slip, so
    // they must not sit in the denominator making a clean week look missed.
    it('leaves pushes out of the denominator and names them', () => {
        const t = legTally(slip('lost', ['win', 'win', 'loss', 'push']));
        expect(t.text).toBe('2/3');
        expect(t.title).toBe('2 of 3 legs hit (1 push not counted)');
    });

    it('pluralises more than one push', () => {
        expect(legTally(slip('lost', ['win', 'loss', 'push', 'push'])).title)
            .toBe('1 of 2 legs hit (2 pushes not counted)');
    });

    // A slip goes 'lost' the moment one leg loses, hours before the late games
    // settle. The fraction has to describe what is decided so far, not read as a
    // wipeout, and say that it is still moving.
    it('counts only decided legs while the rest of a lost slip is pending', () => {
        const t = legTally(slip('lost', ['win', 'loss', 'pending', 'pending']));
        expect(t.text).toBe('1/2');
        expect(t.title).toBe('1 of 2 legs hit, 2 still to settle');
    });

    it('prints no fraction when every leg pushed', () => {
        const t = legTally(slip('push', ['push', 'push']));
        expect(t.text).toBe('—');
        expect(t.title).toBe('All 2 legs pushed');
    });

    it('does not pluralise a single leg or a single push', () => {
        expect(legTally(slip('push', ['push'])).title).toBe('All 1 leg pushed');
        expect(legTally(slip('lost', ['win', 'loss', 'push'])).title)
            .toBe('1 of 2 legs hit (1 push not counted)');
    });

    // The bug this whole column change exists to kill, in its last hiding place.
    // A slip stays 'pending' forever when a custom leg never gets graded, so
    // keying the switch off parlay.status left week 3 reading a meaningless 4/4
    // in October.
    it('shows hits on a slip stuck pending with an ungraded leg', () => {
        const t = legTally(slip('pending', ['win', 'win', 'win', 'pending']));
        expect(t.text).toBe('3/3');
        expect(t.title).toBe('3 of 3 legs hit, 1 still to settle');
    });

    // Picks close when the slip leaves 'pending' — routes/betting.js refuses a
    // PATCH after that, admins included. So an unpicked leg on a settled slip is
    // a gap in the week, not something to check back on.
    it('calls out legs nobody ever picked, and does not call them pending', () => {
        const t = legTally(slip('lost', ['win', 'loss', null, null]));
        expect(t.text).toBe('1/2');
        expect(t.title).toBe('1 of 2 legs hit, 2 never picked');
    });

    // Latent today: deriveParlayStatus cannot return 'lost' with nothing
    // decided. If it ever does, the column must not invent a push week — the
    // old "nothing decided means everything pushed" guard said exactly that.
    it('does not claim a push week when a settled slip has nothing decided', () => {
        const t = legTally(slip('lost', ['pending', 'pending', 'pending', 'pending']));
        expect(t.title).not.toMatch(/pushed/);
        expect(t.text).toBe('4/4');
    });

    it('handles a slip with no legs at all', () => {
        expect(legTally({ status: 'pending', legs: [] }).text).toBe('—');
        expect(legTally(null).text).toBe('—');
    });
});
