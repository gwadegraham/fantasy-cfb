// Coverage for modules/season-status.js hasScoredGames.
//
// This gates a permission: a League Manager may not change scoring once the
// season is underway (only an admin, who can also run a rescore). So the
// interesting case is not "does it find scored games" — it is what it answers
// when it CANNOT tell, because the safe answer and the empty answer are
// opposites here.
//
// Before #312 the season argument was always process.env.YEAR, a string that
// was always set. Now it comes from seasonForLeague(), which returns null for a
// league whose sport has no stored season — and Number(null) is 0, which
// matches no season, which read as "nothing scored yet" and quietly OPENED the
// lock. A basketball league created before its season row (exactly the ordering
// #313 introduces) would have let a League Manager rewrite scoring mid-season.

const { useMongo } = require('./helpers/mongo');
const User = require('../models/user');
const { hasScoredGames } = require('../modules/season-status');

const LEAGUE = 'graham-league';

useMongo();

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

// A manager with a scored week. No `teams` — the team subdoc requires half a
// dozen CFBD fields and hasScoredGames never looks at it; the query keys purely
// off a scoreByTeam entry existing.
async function seedScored(season) {
    await User.create({
        firstName: 'Garrett', lastName: 'Graham', league: LEAGUE,
        seasons: [{
            season,
            weeklyScore: [{ week: 1, score: 12, scoreByTeam: [{ teamId: 333, gameId: 1, score: 12 }] }]
        }]
    });
}

describe('the ordinary cases', () => {
    test('true once a manager has a scored game in that season', async () => {
        await seedScored(2026);
        expect(await hasScoredGames(LEAGUE, 2026)).toBe(true);
    });

    test('false before anything is scored', async () => {
        await User.create({
            firstName: 'James', lastName: 'McMain', league: LEAGUE,
            seasons: [{ season: 2026, weeklyScore: [] }]
        });
        expect(await hasScoredGames(LEAGUE, 2026)).toBe(false);
    });

    test('scoped to the season asked about', async () => {
        await seedScored(2025);
        expect(await hasScoredGames(LEAGUE, 2025)).toBe(true);
        expect(await hasScoredGames(LEAGUE, 2026)).toBe(false);
    });

    test('scoped to the league asked about', async () => {
        await seedScored(2026);
        expect(await hasScoredGames('claunts-league', 2026)).toBe(false);
    });

    test('accepts the season as a string, as every caller used to pass it', async () => {
        await seedScored(2026);
        expect(await hasScoredGames(LEAGUE, '2026')).toBe(true);
    });
});

describe('when the season cannot be resolved, it fails CLOSED', () => {
    // Each of these used to cast to 0 or NaN, match nothing, and answer false —
    // i.e. "season not underway", i.e. unlocked.
    test.each([
        ['null', null],
        ['undefined', undefined],
        ['zero', 0],
        ['an empty string', ''],
        ['a non-number', 'soon'],
        ['NaN', NaN]
    ])('%s is treated as underway, not as an empty season', async (_label, season) => {
        await seedScored(2026);
        expect(await hasScoredGames(LEAGUE, season)).toBe(true);
    });

    test('says which league and value it could not resolve', async () => {
        await hasScoredGames(LEAGUE, null);
        const lines = console.error.mock.calls.map(c => String(c[0]));
        expect(lines.some(l => l.includes('unusable season null') && l.includes(LEAGUE))).toBe(true);
    });

    test('answers locked even with no data at all, rather than reading as open', async () => {
        expect(await hasScoredGames(LEAGUE, null)).toBe(true);
    });
});
