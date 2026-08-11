// Real-looking values so the asserted URLs read as URLs rather than
// "undefined/rankings/undefined/...".
process.env.URL = 'http://test.local';
process.env.YEAR = '2026';

const { postseasonWeeksToScore } = require('../modules/score-update');

// --- pipeline ordering -------------------------------------------------------
// The H2H win bonus is folded into weeklyScore[].score, and updateCumulativeScores
// then SUMS those scores into cumulativeScore. So applyH2HBonuses must run after
// updateScores (a week's result needs every manager's total) and before
// updateCumulativeScores. Reorder these and the bonus silently stops reaching the
// season total of record — exactly the bug this replaced. Hence the assertion.

// The calendar mock hands back a regular-season window that is open right now, so
// runFullUpdate resolves a week the ordinary way. This used to be `null`, which
// the old current-week loop silently turned into "regular week 1" — the exact
// fallback resolveCurrentWeek now refuses, so the ordering tests below have to
// supply a real window.
jest.mock('../modules/cfbd-calendar', () => ({
    getCalendar: jest.fn(async () => [
        { week: 7, seasonType: 'regular', firstGameStart: '2000-01-01', lastGameStart: '2100-01-01' }
    ])
}));
jest.mock('../modules/internal-api', () => ({
    internalFetch: jest.fn(async () => ({ status: 200, json: async () => ({}) }))
}));
jest.mock('../modules/retrieve-games.js', () => ({
    retrieveTeams: jest.fn(async () => []),
    massRetrieveGames: jest.fn(async () => ({ newGames: [], existingGames: [], remainingCalls: 900 }))
}));
jest.mock('../modules/team-scoring.js', () => ({ updateAllTeamScores: jest.fn(async () => {}) }));
jest.mock('../modules/records.js', () => ({ updateAllTeamRecords: jest.fn(async () => {}) }));
jest.mock('../modules/betting.js', () => ({ updateAllBettingLines: jest.fn(async () => {}) }));
jest.mock('../modules/scoring.js', () => {
    const calls = [];
    return {
        _calls: calls,
        updateScores: jest.fn(async () => { calls.push('updateScores'); }),
        applyH2HBonuses: jest.fn(async () => { calls.push('applyH2HBonuses'); }),
        updateCumulativeScores: jest.fn(async () => { calls.push('updateCumulativeScores'); })
    };
});

describe('runFullUpdate scoring order', () => {
    const { runFullUpdate } = require('../modules/score-update');
    const scoringModule = require('../modules/scoring.js');
    const retrieveGames = require('../modules/retrieve-games.js');

    const { internalFetch } = require('../modules/internal-api');

    beforeEach(() => {
        scoringModule._calls.length = 0;
        scoringModule.updateScores.mockClear();
        retrieveGames.massRetrieveGames.mockClear();
        internalFetch.mockClear();
        // Default: no trailing regular week outstanding (the endpoint answers
        // { week: null }, which this bare body stands in for).
        internalFetch.mockImplementation(async () => ({ status: 200, json: async () => ({}) }));
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { jest.restoreAllMocks(); });

    it('applies H2H bonuses between weekly scoring and cumulative totals (regular season)', async () => {
        await runFullUpdate({ withBetting: false });
        expect(scoringModule._calls).toEqual(['updateScores', 'applyH2HBonuses', 'updateCumulativeScores']);
    });

    it('also applies them on a postseason run, before cumulative totals', async () => {
        retrieveGames.massRetrieveGames.mockResolvedValueOnce({
            newGames: [{ week: 1 }], existingGames: [], remainingCalls: 900
        });
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce([
            { week: 1, seasonType: 'postseason', firstGameStart: '2000-01-01', lastGameStart: '2100-01-01' }
        ]);
        await runFullUpdate({ withBetting: false });
        const calls = scoringModule._calls;
        expect(calls.indexOf('applyH2HBonuses')).toBeGreaterThan(calls.indexOf('updateScores'));
        expect(calls.indexOf('applyH2HBonuses')).toBeLessThan(calls.indexOf('updateCumulativeScores'));
    });

    // Postseason games resolve rankings from the week-1 REGULAR poll, and no
    // postseason rule reads a rank at all — so asking for a `postseason` rankings
    // doc was asking for something nothing reads. CFBD publishes no postseason
    // poll until after the title game, so retrieveRankings 400'd on every run for
    // the whole bowl season, spending a CFBD call each time.
    it('ensures the week-1 regular poll on a postseason run, never a postseason one', async () => {
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce([
            { week: 1, seasonType: 'postseason', firstGameStart: '2000-01-01', lastGameStart: '2100-01-01' }
        ]);
        await runFullUpdate({ withBetting: false });

        const rankingUrls = internalFetch.mock.calls
            .map(c => c[0]).filter(u => /\/rankings\//.test(u));
        expect(rankingUrls).toEqual([`${process.env.URL}/rankings/${process.env.YEAR}/1/regular`]);
        expect(rankingUrls.join(' ')).not.toMatch(/postseason/);
    });

    it('ensures the current week\'s regular poll during the regular season', async () => {
        await runFullUpdate({ withBetting: false });
        const rankingUrls = internalFetch.mock.calls
            .map(c => c[0]).filter(u => /\/rankings\//.test(u));
        expect(rankingUrls).toEqual([`${process.env.URL}/rankings/${process.env.YEAR}/7/regular`]);
    });

    it('does not try to create a poll that already exists', async () => {
        await runFullUpdate({ withBetting: false });
        const posts = internalFetch.mock.calls.filter(c => /retrieveRankings/.test(c[0]));
        expect(posts).toHaveLength(0);   // the GET answered 200
    });

    it('creates the poll for the week the engine reads when it is missing', async () => {
        internalFetch.mockImplementation(async (url) => /\/rankings\/\d+\/\d+\//.test(url)
            ? { status: 400, json: async () => ({ message: 'not found' }) }
            : { status: 201, json: async () => ({}) });
        await runFullUpdate({ withBetting: false });

        const post = internalFetch.mock.calls.find(c => /retrieveRankings/.test(c[0]));
        expect(post).toBeDefined();
        expect(JSON.parse(post[1].body)).toEqual({ season: process.env.YEAR, seasonType: 'regular', week: '7' });
    });

    // CFBD's postseason window opens BEFORE the regular season's last game kicks
    // off (2026: week-15 window closes 2026-12-12T07:59Z, Army–Navy kicks off
    // 20:00Z that day), and the postseason pull is `seasonType=postseason` — which
    // never contains that game. Without the trailing pass, week 15 keeps its 0.
    const POSTSEASON_CALENDAR = [
        { week: 1, seasonType: 'postseason', firstGameStart: '2000-01-01', lastGameStart: '2100-01-01' }
    ];

    it('finalizes a trailing regular week alongside the postseason', async () => {
        internalFetch.mockImplementation(async (url) => /pending-regular/.test(url)
            ? { status: 200, json: async () => ({ season: '2026', week: 15 }) }
            : { status: 200, json: async () => ({}) });
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce(POSTSEASON_CALENDAR);

        await runFullUpdate({ withBetting: false });

        // Regular week 15 pulled and scored FIRST, so the shared H2H / cumulative
        // / team-score passes below fold in both phases.
        expect(retrieveGames.massRetrieveGames.mock.calls).toEqual([[15, 'regular'], [null, 'postseason']]);
        expect(scoringModule.updateScores.mock.calls).toEqual([['regular', 15], ['postseason', 1]]);
        const calls = scoringModule._calls;
        expect(calls.lastIndexOf('updateScores')).toBeLessThan(calls.indexOf('applyH2HBonuses'));
    });

    it('leaves the postseason run alone when no regular week is outstanding', async () => {
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce(POSTSEASON_CALENDAR);
        await runFullUpdate({ withBetting: false });
        expect(retrieveGames.massRetrieveGames.mock.calls).toEqual([[null, 'postseason']]);
        expect(scoringModule.updateScores.mock.calls).toEqual([['postseason', 1]]);
    });

    it('falls back to postseason-only when the trailing-week check fails', async () => {
        internalFetch.mockImplementation(async (url) => {
            if (/pending-regular/.test(url)) throw new Error('boom');
            return { status: 200, json: async () => ({}) };
        });
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce(POSTSEASON_CALENDAR);
        await runFullUpdate({ withBetting: false });
        expect(scoringModule.updateScores.mock.calls).toEqual([['postseason', 1]]);
    });

    it('never runs the trailing pass during the regular season', async () => {
        internalFetch.mockImplementation(async (url) => /pending-regular/.test(url)
            ? { status: 200, json: async () => ({ season: '2026', week: 15 }) }
            : { status: 200, json: async () => ({}) });
        await runFullUpdate({ withBetting: false });
        expect(retrieveGames.massRetrieveGames.mock.calls).toEqual([[7, 'regular']]);
        expect(scoringModule.updateScores.mock.calls).toEqual([['regular', 7]]);
    });

    // The whole point of resolveCurrentWeek throwing/skipping instead of
    // defaulting to week 1: out of season the pipeline must not score ANYTHING,
    // and with an unusable calendar it must fail rather than pick a week.
    it('scores nothing at all when the season is over', async () => {
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce([
            { week: 1, seasonType: 'postseason', firstGameStart: '2000-01-01', lastGameStart: '2000-02-01' }
        ]);
        const r = await runFullUpdate({ withBetting: false });
        expect(r.skipped).toMatch(/season over/);
        expect(r.week).toBeNull();
        expect(scoringModule._calls).toEqual([]);
        expect(retrieveGames.massRetrieveGames).not.toHaveBeenCalled();
    });

    it('fails loudly on an empty calendar rather than rescoring week 1', async () => {
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce([]);
        await expect(runFullUpdate({ withBetting: false })).rejects.toThrow(/calendar/i);
        expect(scoringModule._calls).toEqual([]);
    });
});

// saturday-scores fires at 15:00/18:00/22:00 on the minute and the live poller
// fires on every :00 mark, so two full updates overlapped three times every
// Saturday — two CFBD pulls of the same slate, and two passes mutating the same
// weeklyScore arrays.
describe('runFullUpdate overlap guard', () => {
    const scoreUpdate = require('../modules/score-update');
    const scoringModule = require('../modules/scoring.js');
    const retrieveGames = require('../modules/retrieve-games.js');

    beforeEach(() => {
        scoringModule._calls.length = 0;
        scoringModule.updateScores.mockClear();
        retrieveGames.massRetrieveGames.mockClear();
        scoreUpdate._clearInFlight();
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { jest.restoreAllMocks(); });

    it('runs the first update and skips the one that lands on top of it', async () => {
        const [first, second] = await Promise.all([
            scoreUpdate.runFullUpdate({ withBetting: false }),
            scoreUpdate.runFullUpdate({ withBetting: false })
        ]);
        expect(first.skipped).toBeUndefined();
        expect(second.skipped).toMatch(/already running/);
        // One pull, one scoring pass — not two of each.
        expect(retrieveGames.massRetrieveGames).toHaveBeenCalledTimes(1);
        expect(scoringModule.updateScores).toHaveBeenCalledTimes(1);
    });

    it('releases the guard so the next scheduled run proceeds', async () => {
        await scoreUpdate.runFullUpdate({ withBetting: false });
        const next = await scoreUpdate.runFullUpdate({ withBetting: false });
        expect(next.skipped).toBeUndefined();
        expect(scoringModule.updateScores).toHaveBeenCalledTimes(2);
    });

    it('releases the guard even when the run throws', async () => {
        require('../modules/cfbd-calendar').getCalendar.mockResolvedValueOnce([]);
        await expect(scoreUpdate.runFullUpdate({ withBetting: false })).rejects.toThrow(/calendar/i);
        const next = await scoreUpdate.runFullUpdate({ withBetting: false });
        expect(next.skipped).toBeUndefined();
    });
});

describe('resolveCurrentWeek', () => {
    const { resolveCurrentWeek } = require('../modules/score-update');
    const at = (iso) => new Date(iso);
    const w = (week, seasonType, start, end) =>
        ({ week, seasonType, firstGameStart: start, lastGameStart: end });

    // The REAL 2026 CFBD calendar (GET /calendar?year=2026). Its windows are
    // contiguous — each entry's lastGameStart is the next one's firstGameStart —
    // which is why "the current week" is the last window that has opened.
    const CAL_2026 = [
        w(1, 'regular', '2026-08-29T07:00:00.000Z', '2026-09-08T06:59:00.000Z'),
        w(2, 'regular', '2026-09-08T07:00:00.000Z', '2026-09-14T06:59:00.000Z'),
        w(13, 'regular', '2026-11-23T08:00:00.000Z', '2026-11-30T07:59:00.000Z'),
        w(14, 'regular', '2026-11-30T08:00:00.000Z', '2026-12-07T07:59:00.000Z'),
        w(15, 'regular', '2026-12-07T08:00:00.000Z', '2026-12-12T07:59:00.000Z'),
        w(1, 'postseason', '2026-12-12T08:00:00.000Z', '2027-01-28T07:59:00.000Z')
    ];

    it('reads the current regular week off the live 2026 calendar', () => {
        expect(resolveCurrentWeek(CAL_2026, at('2026-11-28T20:00:00.000Z')))
            .toEqual({ week: 13, seasonType: 'regular' });
        expect(resolveCurrentWeek(CAL_2026, at('2026-12-05T22:00:00.000Z')))
            .toEqual({ week: 14, seasonType: 'regular' });
    });

    it('recognizes the postseason from the entry, not from the week number', () => {
        expect(resolveCurrentWeek(CAL_2026, at('2026-12-19T22:00:00.000Z')))
            .toEqual({ week: 1, seasonType: 'postseason' });
    });

    // These two are the bug. The old loop hit its `calendarWeek.week == 1` branch
    // (postseason is numbered week 1) and its `weekNumber = 1` initializer, so
    // both of these resolved to "regular week 1" and rescored week 1 — every
    // night, for months, while reporting success.
    it('skips before the season opens instead of scoring week 1', () => {
        expect(resolveCurrentWeek(CAL_2026, at('2026-08-10T18:00:00.000Z')).skip)
            .toMatch(/preseason/);
    });

    it('skips once the final window closes instead of scoring week 1', () => {
        expect(resolveCurrentWeek(CAL_2026, at('2027-01-28T12:00:00.000Z')).skip)
            .toMatch(/season over/);
        expect(resolveCurrentWeek(CAL_2026, at('2027-06-15T12:00:00.000Z')).skip)
            .toMatch(/season over/);
    });

    it('still scores inside the final window (the title game is in there)', () => {
        expect(resolveCurrentWeek(CAL_2026, at('2027-01-19T01:00:00.000Z')))
            .toEqual({ week: 1, seasonType: 'postseason' });
    });

    it('lands on the week that just ended when a gap opens between windows', () => {
        const gapped = [
            w(3, 'regular', '2026-09-14T07:00:00.000Z', '2026-09-19T06:59:00.000Z'),
            w(4, 'regular', '2026-09-21T07:00:00.000Z', '2026-09-28T06:59:00.000Z')
        ];
        expect(resolveCurrentWeek(gapped, at('2026-09-20T12:00:00.000Z')))
            .toEqual({ week: 3, seasonType: 'regular' });
    });

    it('does not trust array order', () => {
        const shuffled = [CAL_2026[5], CAL_2026[2], CAL_2026[0], CAL_2026[4], CAL_2026[3], CAL_2026[1]];
        expect(resolveCurrentWeek(shuffled, at('2026-12-05T22:00:00.000Z')))
            .toEqual({ week: 14, seasonType: 'regular' });
    });

    it('ignores rows with no parseable kickoff boundary', () => {
        const messy = [
            w(9, 'regular', 'not a date', 'not a date'),
            w(10, 'regular', '2026-11-02T08:00:00.000Z', '2026-11-09T07:59:00.000Z')
        ];
        expect(resolveCurrentWeek(messy, at('2026-11-05T20:00:00.000Z')))
            .toEqual({ week: 10, seasonType: 'regular' });
    });

    it('throws rather than guess when the calendar is unusable', () => {
        expect(() => resolveCurrentWeek(null, at('2026-10-10T20:00:00.000Z'))).toThrow(/calendar/i);
        expect(() => resolveCurrentWeek([], at('2026-10-10T20:00:00.000Z'))).toThrow(/calendar/i);
        expect(() => resolveCurrentWeek({}, at('2026-10-10T20:00:00.000Z'))).toThrow(/calendar/i);
        expect(() => resolveCurrentWeek(
            [w(undefined, 'regular', 'garbage', 'garbage')], at('2026-10-10T20:00:00.000Z')
        )).toThrow(/no usable week windows/i);
    });
});

describe('postseasonWeeksToScore', () => {
    const g = (week) => ({ week });

    it('returns the distinct weeks present, ascending', () => {
        const result = { newGames: [g(1), g(2)], existingGames: [g(2), g(3)] };
        expect(postseasonWeeksToScore(result)).toEqual([1, 2, 3]);
    });

    it('covers a multi-week 12-team CFP (first round → championship)', () => {
        // e.g. first round wk1, quarters wk2, semis wk3, final wk4
        const result = { newGames: [g(4), g(1)], existingGames: [g(3), g(2), g(1)] };
        expect(postseasonWeeksToScore(result)).toEqual([1, 2, 3, 4]);
    });

    it('falls back to [1] when no games/weeks are present', () => {
        expect(postseasonWeeksToScore({ newGames: [], existingGames: [] })).toEqual([1]);
        expect(postseasonWeeksToScore({})).toEqual([1]);
        expect(postseasonWeeksToScore(null)).toEqual([1]);
    });

    it('ignores games with a missing week', () => {
        const result = { newGames: [g(1), { }], existingGames: [g(null)] };
        expect(postseasonWeeksToScore(result)).toEqual([1]);
    });
});
