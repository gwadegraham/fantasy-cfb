const {
    captainForWeek, autoCaptainTeamId, resolveCaptain, captainWeeklyBonus,
    captainWeekWindow, captainLockMs, captainFocusWeek
} = require('../modules/captain');

const roster = [{ id: 1, school: 'Oregon' }, { id: 2, school: 'Duke' }, { id: 3, school: 'Iowa' }];

describe('captainForWeek', () => {
    test('returns the picked teamId or null', () => {
        const caps = [{ week: 1, teamId: 2 }, { week: 3, teamId: 1 }];
        expect(captainForWeek(caps, 1)).toBe(2);
        expect(captainForWeek(caps, 3)).toBe(1);
        expect(captainForWeek(caps, 2)).toBeNull();
        expect(captainForWeek(undefined, 1)).toBeNull();
    });
});

describe('autoCaptainTeamId', () => {
    test('picks the best-average team over prior weeks', () => {
        const prior = [
            { week: 1, scoreByTeam: [{ teamId: 1, score: 6 }, { teamId: 2, score: 12 }, { teamId: 3, score: 3 }] },
            { week: 2, scoreByTeam: [{ teamId: 1, score: 20 }, { teamId: 2, score: 4 }, { teamId: 3, score: 3 }] }
        ];
        // averages: t1 13, t2 8, t3 3 → t1
        expect(autoCaptainTeamId(roster, prior)).toBe(1);
    });
    test('week 1 (no prior data) falls back to the first rostered team', () => {
        expect(autoCaptainTeamId(roster, [])).toBe(1);
    });
    test('empty roster → null', () => {
        expect(autoCaptainTeamId([], [])).toBeNull();
    });
});

describe('resolveCaptain', () => {
    test('manual pick wins over the auto default', () => {
        const prior = [{ week: 1, scoreByTeam: [{ teamId: 1, score: 30 }] }];
        expect(resolveCaptain([{ week: 2, teamId: 3 }], 2, roster, prior)).toBe(3);   // picked
        expect(resolveCaptain([], 2, roster, prior)).toBe(1);                          // auto (t1 hot)
    });
});

describe('captainWeeklyBonus', () => {
    test('bonus = captain team total × (multiplier − 1)', () => {
        const sbt = [{ teamId: 1, score: 10 }, { teamId: 2, score: 4 }];
        expect(captainWeeklyBonus(sbt, 1, 2)).toBe(10);   // double team 1 → +10
        expect(captainWeeklyBonus(sbt, 2, 2)).toBe(4);
        expect(captainWeeklyBonus(sbt, 1, 3)).toBe(20);   // triple → +2×
    });
    test('multi-game week: every game of the captained team is boosted', () => {
        const sbt = [{ teamId: 1, score: 6 }, { teamId: 1, score: 6 }, { teamId: 2, score: 9 }];
        expect(captainWeeklyBonus(sbt, 1, 2)).toBe(12);   // (6+6) × 1
    });
    test('no captain / not found → 0', () => {
        expect(captainWeeklyBonus([{ teamId: 1, score: 10 }], null, 2)).toBe(0);
        expect(captainWeeklyBonus([{ teamId: 1, score: 10 }], 99, 2)).toBe(0);
    });
});

const iso = (s) => new Date(s).toISOString();
const ms = (s) => Date.parse(s);

describe('captainWeekWindow', () => {
    // Manager rosters teams 1 & 3. Week games below involve various teams.
    const games = [
        { homeId: 1, awayId: 50, startDate: iso('2026-09-05T16:00:00Z'), startTimeTbd: false }, // team 1, Sat 11am CT
        { homeId: 3, awayId: 51, startDate: iso('2026-09-04T23:30:00Z'), startTimeTbd: false }, // team 3, Fri 6:30pm CT (earliest)
        { homeId: 9, awayId: 8, startDate: iso('2026-09-03T20:00:00Z'), startTimeTbd: false }   // neither team — ignored
    ];

    test('first = earliest of the manager’s own games; last = latest', () => {
        const w = captainWeekWindow(games, [1, 3]);
        expect(w.first).toBe(ms('2026-09-04T23:30:00Z'));   // team 3 Friday
        expect(w.last).toBe(ms('2026-09-05T16:00:00Z'));    // team 1 Saturday
    });

    test('ignores games not involving the manager’s teams', () => {
        expect(captainWeekWindow(games, [9]).first).toBe(ms('2026-09-03T20:00:00Z'));
    });

    test('null when the manager has no game that week', () => {
        expect(captainWeekWindow(games, [77])).toBeNull();
        expect(captainWeekWindow([], [1])).toBeNull();
    });

    test('excludes TBD-kickoff games while a firm-time game exists (no early lock)', () => {
        const g = [
            { homeId: 1, awayId: 5, startDate: iso('2026-09-05T00:00:00Z'), startTimeTbd: true },  // placeholder, would lock too early
            { homeId: 3, awayId: 6, startDate: iso('2026-09-05T19:00:00Z'), startTimeTbd: false }
        ];
        expect(captainWeekWindow(g, [1, 3]).first).toBe(ms('2026-09-05T19:00:00Z'));
    });

    test('falls back to TBD games when no firm-time game exists', () => {
        const g = [{ homeId: 1, awayId: 5, startDate: iso('2026-09-05T17:00:00Z'), startTimeTbd: true }];
        expect(captainWeekWindow(g, [1]).first).toBe(ms('2026-09-05T17:00:00Z'));
    });
});

describe('captainLockMs', () => {
    test('is the manager’s earliest kickoff', () => {
        const g = [
            { homeId: 1, awayId: 5, startDate: iso('2026-09-05T16:00:00Z'), startTimeTbd: false },
            { homeId: 3, awayId: 6, startDate: iso('2026-09-04T23:30:00Z'), startTimeTbd: false }
        ];
        expect(captainLockMs(g, [1, 3])).toBe(ms('2026-09-04T23:30:00Z'));
    });
    test('null on a bye', () => {
        expect(captainLockMs([], [1])).toBeNull();
    });
});

describe('captainFocusWeek', () => {
    const GRACE = 6 * 3600 * 1000;
    // Manager (team 1) plays wk1 Sat 9/5, wk2 Sat 9/12.
    const games = [
        { seasonType: 'regular', week: 1, homeId: 1, awayId: 5, startDate: iso('2026-09-05T17:00:00Z'), startTimeTbd: false },
        { seasonType: 'regular', week: 2, homeId: 1, awayId: 6, startDate: iso('2026-09-12T17:00:00Z'), startTimeTbd: false }
    ];

    test('before wk1 kickoff → focus wk1 (editable)', () => {
        const f = captainFocusWeek(games, [1], ms('2026-09-02T12:00:00Z'), GRACE);
        expect(f.week).toBe(1);
        expect(ms('2026-09-02T12:00:00Z') < f.first).toBe(true);
    });

    test('during wk1 games → still wk1 (shown locked, not advanced yet)', () => {
        const f = captainFocusWeek(games, [1], ms('2026-09-05T18:00:00Z'), GRACE);
        expect(f.week).toBe(1);
    });

    test('after wk1 finishes (+grace) → advances to wk2', () => {
        const f = captainFocusWeek(games, [1], ms('2026-09-06T02:00:00Z'), GRACE);
        expect(f.week).toBe(2);
    });

    test('skips weeks the manager does not play', () => {
        const byeGames = [{ seasonType: 'regular', week: 4, homeId: 1, awayId: 5, startDate: iso('2026-09-26T17:00:00Z'), startTimeTbd: false }];
        const f = captainFocusWeek(byeGames, [1], ms('2026-09-01T12:00:00Z'), GRACE);
        expect(f.week).toBe(4);
    });

    test('null once every played week is done', () => {
        expect(captainFocusWeek(games, [1], ms('2026-12-01T12:00:00Z'), GRACE)).toBeNull();
    });

    test('ignores postseason games', () => {
        const g = [{ seasonType: 'postseason', week: 1, homeId: 1, awayId: 5, startDate: iso('2026-12-20T17:00:00Z'), startTimeTbd: false }];
        expect(captainFocusWeek(g, [1], ms('2026-09-01T12:00:00Z'), GRACE)).toBeNull();
    });
});
