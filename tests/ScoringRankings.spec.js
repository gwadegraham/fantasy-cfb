// Which rankings doc a game gets scored against (modules/scoring.js
// getRankingsForGame).
//
// Regular season: that week's poll — the ranking a team held at kickoff.
//
// Postseason: the LATEST regular-season poll, i.e. the last one published before
// the bowls, which is where CFBD puts the selection-day Playoff Committee
// Rankings. This used to read `{season}/1/regular` — week 1 of the REGULAR
// season, which is the August preseason poll, published before a game had been
// played. Nothing has scored wrong because of it (no postseason rule reads a
// rank, and every rank-reading rule is gated to isRegular), but it is the wrong
// poll and the first rank-sensitive postseason rule would have inherited it.

const scoringModule = require('../modules/scoring.js');

describe('getRankingsForGame', () => {
    const OLD_ENV = process.env;
    const realFetch = global.fetch;
    let urls;

    beforeEach(() => {
        process.env = { ...OLD_ENV, URL: 'http://test.local', YEAR: '2026' };
        urls = [];
        global.fetch = jest.fn((url) => {
            urls.push(url);
            return Promise.resolve({ status: 200, json: () => Promise.resolve({ polls: [] }) });
        });
    });
    afterEach(() => { process.env = OLD_ENV; global.fetch = realFetch; jest.restoreAllMocks(); });

    const game = (seasonType, week) => ({ seasonType, week });

    it("reads the week's own poll during the regular season", async () => {
        await scoringModule.getRankingsForGame(game('regular', 7), 7, 2026);
        expect(urls).toEqual(['http://test.local/rankings/2026/7/regular']);
    });

    // The fix. Not /2026/1/regular (August), and not /2026/1/postseason (which
    // CFBD does not publish until after the title game).
    it('reads the LATEST regular poll for a postseason game', async () => {
        await scoringModule.getRankingsForGame(game('postseason', 1), 1, 2026);
        expect(urls).toEqual(['http://test.local/rankings/2026/latest/regular']);
    });

    it('ignores the passed week for a postseason game', async () => {
        await scoringModule.getRankingsForGame(game('postseason', 1), 14, 2026);
        expect(urls).toEqual(['http://test.local/rankings/2026/latest/regular']);
    });

    // A conference championship is seasonType 'regular', so it keeps reading its
    // own week — the poll those teams were ranked in at kickoff.
    it('treats a conference championship as the regular-season game it is', async () => {
        await scoringModule.getRankingsForGame(game('regular', 14), 14, 2026);
        expect(urls).toEqual(['http://test.local/rankings/2026/14/regular']);
    });

    describe('caching', () => {
        it('reuses one fetch across every postseason game in a run', async () => {
            const cache = new Map();
            await scoringModule.getRankingsForGame(game('postseason', 1), 1, 2026, cache);
            await scoringModule.getRankingsForGame(game('postseason', 1), 1, 2026, cache);
            await scoringModule.getRankingsForGame(game('postseason', 2), 2, 2026, cache);
            expect(urls).toHaveLength(1);
        });

        it('keeps regular weeks on separate cache keys', async () => {
            const cache = new Map();
            await scoringModule.getRankingsForGame(game('regular', 7), 7, 2026, cache);
            await scoringModule.getRankingsForGame(game('regular', 8), 8, 2026, cache);
            await scoringModule.getRankingsForGame(game('regular', 7), 7, 2026, cache);
            expect(urls).toEqual([
                'http://test.local/rankings/2026/7/regular',
                'http://test.local/rankings/2026/8/regular'
            ]);
        });

        it('does not let a postseason game share a regular week 1 entry', async () => {
            const cache = new Map();
            await scoringModule.getRankingsForGame(game('regular', 1), 1, 2026, cache);
            await scoringModule.getRankingsForGame(game('postseason', 1), 1, 2026, cache);
            expect(urls).toEqual([
                'http://test.local/rankings/2026/1/regular',
                'http://test.local/rankings/2026/latest/regular'
            ]);
        });

        it('fetches every time without a cache, so direct callers stay correct', async () => {
            await scoringModule.getRankingsForGame(game('regular', 7), 7, 2026);
            await scoringModule.getRankingsForGame(game('regular', 7), 7, 2026);
            expect(urls).toHaveLength(2);
        });
    });
});
