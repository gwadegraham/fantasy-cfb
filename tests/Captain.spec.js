const { captainForWeek, autoCaptainTeamId, resolveCaptain, captainWeeklyBonus } = require('../modules/captain');

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
