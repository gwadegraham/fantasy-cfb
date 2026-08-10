// Coverage for public/season-scoring.js — the one shared answer to "has this
// season actually been played yet?".
//
// It exists because the nightly scoring job seeds a zero-point weeklyScore entry
// for every manager as soon as a week's games exist (preseason, undrafted rosters
// included), so "a weekly entry exists" is not the same question. The Standings
// highlights + points chart, the Weekly Recap module, and the recap route all
// gate on this, and they must not drift apart.
const { entryHasScoring, seasonHasScoring } = require('../public/season-scoring');

const user = (id, seasons) => ({ _id: id, seasons });

describe('entryHasScoring', () => {
    it('is true for a week with banked points', () => {
        expect(entryHasScoring({ week: 1, score: 12 })).toBe(true);
    });

    it('is false for the zero-point week the nightly job seeds', () => {
        expect(entryHasScoring({ week: 1, score: 0 })).toBe(false);
    });

    it('is false for a missing score or a missing entry', () => {
        expect(entryHasScoring({ week: 1 })).toBe(false);
        expect(entryHasScoring(null)).toBe(false);
        expect(entryHasScoring(undefined)).toBe(false);
    });

    it('counts a banked H2H win bonus — the week clearly got scored', () => {
        // score carries the bonus (modules/h2h.js); any non-zero total means played.
        expect(entryHasScoring({ week: 1, score: 3, h2hBonus: 3 })).toBe(true);
    });
});

describe('seasonHasScoring', () => {
    it('is false when every manager has only seeded zero weeks', () => {
        const users = [
            user('a', [{ season: 2026, teams: [], weeklyScore: [{ week: 1, score: 0 }] }]),
            user('b', [{ season: 2026, teams: [], weeklyScore: [{ week: 1, score: 0 }] }])
        ];
        expect(seasonHasScoring(users, 2026)).toBe(false);
    });

    it('is true once ANY manager has banked points', () => {
        const users = [
            user('a', [{ season: 2026, weeklyScore: [{ week: 1, score: 0 }] }]),
            user('b', [{ season: 2026, weeklyScore: [{ week: 1, score: 0 }, { week: 2, score: 18 }] }])
        ];
        expect(seasonHasScoring(users, 2026)).toBe(true);
    });

    it('asks about the season it was given, not any other', () => {
        const users = [user('a', [
            { season: 2025, weeklyScore: [{ week: 1, score: 40 }] },   // last year scored
            { season: 2026, weeklyScore: [{ week: 1, score: 0 }] }     // this year seeded
        ])];
        expect(seasonHasScoring(users, 2025)).toBe(true);
        expect(seasonHasScoring(users, 2026)).toBe(false);
    });

    it('matches a string season against a numeric one (route params arrive as strings)', () => {
        const users = [user('a', [{ season: 2026, weeklyScore: [{ week: 1, score: 9 }] }])];
        expect(seasonHasScoring(users, '2026')).toBe(true);
    });

    it('reads seasons[0] when no season is given (the $elemMatch payload shape)', () => {
        // routes/users.js $elemMatch's the active season, so seasons[0] is the only one.
        const scored = [user('a', [{ season: 2026, weeklyScore: [{ week: 1, score: 7 }] }])];
        const seeded = [user('a', [{ season: 2026, weeklyScore: [{ week: 1, score: 0 }] }])];
        expect(seasonHasScoring(scored)).toBe(true);
        expect(seasonHasScoring(seeded)).toBe(false);
    });

    it('is false for an empty league, a missing list, or managers without seasons', () => {
        expect(seasonHasScoring([])).toBe(false);
        expect(seasonHasScoring(null)).toBe(false);
        expect(seasonHasScoring([user('a', [])])).toBe(false);
        expect(seasonHasScoring([{ _id: 'a' }])).toBe(false);
        expect(seasonHasScoring([user('a', [{ season: 2026 }])], 2026)).toBe(false);
        expect(seasonHasScoring([user('a', [{ season: 2025, weeklyScore: [{ score: 5 }] }])], 2026)).toBe(false);
    });
});
