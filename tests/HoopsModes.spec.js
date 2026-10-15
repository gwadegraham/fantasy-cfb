// Which games and weeks the basketball game modes cover, and how a basketball
// tip-off sets the Captain lock (modules/hoops-modes.js). Pure, apart from
// the one schedule read at the bottom.

const { useMongo } = require('./helpers/mongo');
const HoopsGame = require('../models/hoopsGame');
const {
    isModeGame, modeWeeksFrom, seasonModeWeeks, lockInstant, captainShape, captainFocus, lockedWeek
} = require('../modules/hoops-modes');
const { captainShare } = require('../modules/league-scoreboard');
const { buildCaptainReminderPayload } = require('../modules/captain-reminder');

useMongo();

describe('isModeGame', () => {
    test('a regular-season game is covered', () => {
        expect(isModeGame({ seasonType: 'regular', conferenceGame: true })).toBe(true);
        expect(isModeGame({ seasonType: 'regular', conferenceGame: false, gameNotes: 'Champions Classic' })).toBe(true);
    });
    test('a conference tournament game is not, though CBBD calls it regular', () => {
        expect(isModeGame({ seasonType: 'regular', conferenceGame: true, gameNotes: 'Big East Tournament - Quarterfinal' })).toBe(false);
        expect(isModeGame({ seasonType: 'regular', conferenceGame: true, gameNotes: 'America East Playoffs - Final' })).toBe(false);
    });
    test('the postseason is not', () => {
        expect(isModeGame({ seasonType: 'postseason', tournament: 'NCAA' })).toBe(false);
        expect(isModeGame(null)).toBe(false);
    });
});

describe('modeWeeksFrom', () => {
    test('Christmas week is thin and is NOT skipped', () => {
        // The 2026-27 shape: ~300 a week, 145 at Christmas (week 8), 171 in
        // the last week. Football's thin-week rule would stop at week 7.
        const counts = {};
        for (let w = 1; w <= 18; w++) counts[w] = 300;
        counts[8] = 145;
        counts[18] = 171;
        expect(modeWeeksFrom(counts)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    });
    test('a trailing sliver of a week is trimmed', () => {
        expect(modeWeeksFrom({ 1: 300, 2: 300, 3: 300, 4: 6 })).toEqual([1, 2, 3]);
    });
    test('but an interior one never is', () => {
        expect(modeWeeksFrom({ 1: 300, 2: 6, 3: 300 })).toEqual([1, 2, 3]);
    });
    test('nothing scheduled: no weeks', () => {
        expect(modeWeeksFrom({})).toEqual([]);
        expect(modeWeeksFrom(null)).toEqual([]);
        expect(modeWeeksFrom({ 0: 5, x: 3, 2: 0 })).toEqual([]);
    });
    test('an even number of weeks takes the middle pair as the median', () => {
        // median of [2, 10, 10, 10] is 10; 2 < 2.5 trims week 4.
        expect(modeWeeksFrom({ 1: 10, 2: 10, 3: 10, 4: 2 })).toEqual([1, 2, 3]);
    });
});

describe('lockInstant — a TBD tip locks at the start of its Eastern day', () => {
    test('a firm tip is its own time', () => {
        expect(lockInstant({ startDate: '2026-11-04T00:30:00Z', startTimeTbd: false }).toISOString())
            .toBe('2026-11-04T00:30:00.000Z');
    });
    test('a TBD game locks at midnight Eastern that day, whatever the placeholder says', () => {
        // 17:00Z on 3 Nov is noon Eastern; the lock is 00:00 EST = 05:00Z.
        expect(lockInstant({ startDate: '2026-11-03T17:00:00Z', startTimeTbd: true }).toISOString())
            .toBe('2026-11-03T05:00:00.000Z');
        // And in daylight time, 04:00Z.
        expect(lockInstant({ startDate: '2027-03-20T16:00:00Z', startTimeTbd: true }).toISOString())
            .toBe('2027-03-20T04:00:00.000Z');
    });
    test('an unparseable date locks nothing', () => {
        expect(lockInstant({ startDate: 'nope' })).toBeNull();
    });
});

// Two teams: team 1 plays a TBD game on Tuesday, team 2 a firm one Thursday.
const tue = { id: 1, week: 1, seasonType: 'regular', homeTeamId: 1, awayTeamId: 9, startDate: '2026-11-03T05:00:00Z', startTimeTbd: true };
const thu = { id: 2, week: 1, seasonType: 'regular', homeTeamId: 2, awayTeamId: 9, startDate: '2026-11-06T00:00:00Z', startTimeTbd: false };
const nextMon = { id: 3, week: 2, seasonType: 'regular', homeTeamId: 1, awayTeamId: 9, startDate: '2026-11-10T00:00:00Z', startTimeTbd: false };
const games = [tue, thu, nextMon].map(captainShape);
const TUE_LOCK = Date.parse('2026-11-03T05:00:00Z');

describe('the Captain lock and focus on basketball', () => {
    test('a TBD game is NOT passed over for a later firm one', () => {
        // Football's captainWeekWindow drops TBD games while a firm one
        // exists. Here that would keep the pick open through Tuesday's game.
        expect(captainFocus(games, [1, 2], TUE_LOCK - 1).first).toBe(TUE_LOCK);
    });
    test('captainShape keeps the real tip for display, null when TBD', () => {
        expect(games[0].tipoff).toBeNull();
        expect(games[1].tipoff).toBe('2026-11-06T00:00:00.000Z');
        expect(games[0].startTimeTbd).toBe(false);
        expect(captainShape({ id: 4, startDate: 'nope' }).startDate).toBeNull();
    });
    test('once a week locks, the picker moves to the next one', () => {
        const f = captainFocus(games, [1, 2], TUE_LOCK + 1);
        expect(f.week).toBe(2);
        const cur = lockedWeek(games, [1, 2], TUE_LOCK + 1);
        expect(cur.week).toBe(1);
    });
    test('the locked week is reported until its last game day ends', () => {
        // Thursday's game is 00:00Z Fri = 19:00 Thu Eastern; Thursday ends at
        // 05:00Z Friday.
        expect(lockedWeek(games, [1, 2], Date.parse('2026-11-06T04:59:00Z')).week).toBe(1);
        expect(lockedWeek(games, [1, 2], Date.parse('2026-11-06T05:01:00Z'))).toBeNull();
    });
    test('nothing ahead: no focus', () => {
        expect(captainFocus(games, [1, 2], Date.parse('2027-01-01'))).toBeNull();
        expect(captainFocus(games, [7], TUE_LOCK - 1)).toBeNull();
    });
});

describe('seasonModeWeeks reads the stored schedule', () => {
    test('counts regular-season non-tournament games per week', async () => {
        const g = (id, week, o = {}) => Object.assign({ id, season: 2027, week, seasonType: 'regular', startDate: new Date('2026-11-03') }, o);
        await HoopsGame.create([
            g(1, 1), g(2, 1), g(3, 2), g(4, 2), g(5, 3),
            // A week of nothing but conference tournaments is not a mode week.
            g(6, 4, { conferenceGame: true, gameNotes: 'Big Ten Tournament - Final' }),
            g(7, 5, { seasonType: 'postseason', tournament: 'NCAA' }),
            g(8, 1, { season: 2026 })
        ]);
        expect(await seasonModeWeeks(2027)).toEqual([1, 2, 3]);
    });
});

describe('pages split a Captain bonus over doubled games only', () => {
    test('a conference tournament row takes no share', () => {
        const w = { captainTeamId: 1, captainBonus: 10, scoreByTeam: [
            { teamId: 1, gameId: 1, score: 5 }, { teamId: 1, gameId: 2, score: 5 },
            { teamId: 1, gameId: 3, score: 5, noModes: true }
        ] };
        expect(captainShare(w, w.scoreByTeam[0])).toBe(5);
        expect(captainShare(w, w.scoreByTeam[2])).toBe(0);
    });
});

describe('the basketball lock reminder payload', () => {
    test('links to the league and tags by sport', () => {
        const p = buildCaptainReminderPayload({ userId: 'u1', week: 3, lockMs: 2 * 3600e3, nowMs: 0, league: 'hoops-league', sport: 'basketball' });
        expect(p.url).toBe('/userHome?user=u1&league=hoops-league#captain');
        expect(p.tag).toBe('captain-lock-hoops-w3');
        const anon = buildCaptainReminderPayload({ week: 3, lockMs: 1, nowMs: 0, league: 'hoops-league' });
        expect(anon.url).toBe('/userHome?league=hoops-league#captain');
    });
    test("football's is unchanged", () => {
        const p = buildCaptainReminderPayload({ userId: 'u1', week: 3, lockMs: 1, nowMs: 0 });
        expect(p.url).toBe('/userHome?user=u1#captain');
        expect(p.tag).toBe('captain-lock-w3');
    });
});
