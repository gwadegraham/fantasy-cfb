// The weekly recap on a BASKETBALL league (#558), at the pure-module level:
// its weeks, its season window, its completed-week gate and its upset story.
// The route and the Monday push have their own specs
// (RoutesStandingsRecapHoops, RecapNoticeNotify).

const { buildWeeklyRecaps, indexHoopsResults, isRecapSeason, completedWeeks } = require('../modules/weekly-recap');
// The popup mirrors the gate client-side; it hangs itself off `window`.
global.window = global.window || {};
const client = require('../public/weekly-recap.js');

const SEASON = 2027;
const user = (id, weeks, teams = []) => ({
    _id: id, firstName: id,
    seasons: [{ season: SEASON, teams, weeklyScore: weeks }]
});
const wk = (week, score, rows = []) => ({ week, score, scoreByTeam: rows });

describe('recap season window, per sport', () => {
    // Local-time dates, the way both the server and the popup read them.
    const MARCH = new Date(2027, 2, 15);
    const NOVEMBER = new Date(2026, 10, 9);
    const SEPTEMBER = new Date(2026, 8, 14);
    const MAY = new Date(2027, 4, 3);

    test.each([['server', isRecapSeason], ['client', client.isRecapSeason]])('%s: basketball is Nov–Apr', (_, gate) => {
        expect(gate(MARCH, 'basketball')).toBe(true);
        expect(gate(NOVEMBER, 'basketball')).toBe(true);
        expect(gate(new Date(2027, 3, 6), 'basketball')).toBe(true);   // title game week
        expect(gate(SEPTEMBER, 'basketball')).toBe(false);
        expect(gate(MAY, 'basketball')).toBe(false);
    });

    test.each([['server', isRecapSeason], ['client', client.isRecapSeason]])('%s: football is still Aug–Jan', (_, gate) => {
        expect(gate(SEPTEMBER, 'football')).toBe(true);
        expect(gate(SEPTEMBER)).toBe(true);
        expect(gate(MARCH, 'football')).toBe(false);
        expect(gate(MARCH)).toBe(false);
    });
});

describe('basketball weeks are just weeks', () => {
    // Football folds week 17+ into one "Postseason" recap. A hoops season runs
    // ~22 weeks, so the same rule merged February and March into one card.
    test('weeks past 16 each get their own recap, labelled by number', () => {
        const ann = user('a', [wk(16, 10), wk(17, 12), wk(18, 8)]);
        const bob = user('b', [wk(16, 5), wk(17, 6), wk(18, 20)]);
        const out = buildWeeklyRecaps({ user: ann, leagueUsers: [ann, bob], season: SEASON, sport: 'basketball' });
        expect(out.recaps.map(r => r.label)).toEqual(['Week 16', 'Week 17', 'Week 18']);
        expect(out.recaps.map(r => r.score)).toEqual([10, 12, 8]);
        // Rank movement reads week 18 against week 17, not a merged bucket.
        expect(out.recaps[2].rank).toBe(2);
        expect(out.recaps[2].rankDelta).toBe(-1);
        // No football season-wrap beat on a week numbered 17.
        expect(out.recaps[1].slides.some(s => s.id === 'seasonwrap')).toBe(false);
    });
});

describe('basketball MVP is named off the roster', () => {
    // A hoops scoreByTeam row carries teamId and no school name.
    test('the MVP gets the hydrated roster team name', () => {
        const teams = [{ id: 7, school: 'Gonzaga', logos: ['g.png'] }, { id: 8, school: 'Baylor' }];
        const ann = user('a', [wk(1, 9, [{ teamId: 7, gameId: 1, score: 6 }, { teamId: 8, gameId: 2, score: 3 }])], teams);
        const out = buildWeeklyRecaps({ user: ann, leagueUsers: [ann], season: SEASON, sport: 'basketball' });
        expect(out.recaps[0].mvpTeam).toMatchObject({ school: 'Gonzaga', score: 6, logo: 'g.png' });
        expect(out.recaps[0].narrative).toContain("Gonzaga's 6 pts led the way");
    });
});

describe('indexHoopsResults', () => {
    const game = (o) => Object.assign({ id: 1, status: 'final', homeTeamId: 7, awayTeamId: 8, homeTeam: 'Gonzaga', awayTeam: 'Baylor', homePoints: 70, awayPoints: 60 }, o);

    test('indexes a final with winner, loser and seeds', () => {
        expect(indexHoopsResults([game({ homeSeed: 12, awaySeed: 5 })])[1])
            .toMatchObject({ winnerId: 7, winner: 'Gonzaga', loser: 'Baylor', winnerSeed: 12, loserSeed: 5 });
    });

    // CBBD writes 0-0 on a scheduled game; status is the discriminator.
    test('skips anything not final, and a final with no real score', () => {
        expect(indexHoopsResults([
            game({ id: 1, status: 'scheduled', homePoints: 0, awayPoints: 0 }),
            game({ id: 2, status: 'in_progress' }),
            game({ id: 3, homePoints: null })
        ])).toEqual({});
    });
});

describe('the basketball upset story', () => {
    const teams = [{ id: 7, school: 'Gonzaga' }, { id: 8, school: 'Baylor' }];
    const results = indexHoopsResults([
        { id: 1, status: 'final', homeTeamId: 7, awayTeamId: 99, homeTeam: 'Gonzaga', awayTeam: 'Duke', homePoints: 70, awayPoints: 60 },
        { id: 2, status: 'final', homeTeamId: 50, awayTeamId: 8, homeTeam: 'Kansas', awayTeam: 'Baylor', homePoints: 60, awayPoints: 70, homeSeed: 4, awaySeed: 13 },
        { id: 3, status: 'final', homeTeamId: 8, awayTeamId: 51, homeTeam: 'Baylor', awayTeam: 'UNC', homePoints: 50, awayPoints: 70 }
    ]);
    const recapFor = (rows) => {
        const ann = user('a', [wk(20, 12, rows)], teams);
        return buildWeeklyRecaps({ user: ann, leagueUsers: [ann], season: SEASON, sport: 'basketball', upsetByGameId: results }).recaps[0];
    };

    test('a Q1 win tells the story, with the opponent rank it was banked at', () => {
        const r = recapFor([{ teamId: 7, gameId: 1, score: 5, quadrant: 1, oppRank: 3 }]);
        expect(r.upset).toMatchObject({ kind: 'q1', team: 'Gonzaga', loser: 'Duke', loserRank: 3 });
        expect(r.narrative).toBe("Gonzaga's Q1 win over #3 Duke powered your 12-pt week, good for 1st.");
        expect(r.slides.find(s => s.id === 'upset')).toMatchObject({ big: 'Q1', sub: 'beat #3 Duke' });
    });

    test('a seed upset outranks a Q1 win', () => {
        const r = recapFor([
            { teamId: 7, gameId: 1, score: 5, quadrant: 1, oppRank: 3 },
            { teamId: 8, gameId: 2, score: 4, quadrant: 2, oppRank: 40 }
        ]);
        expect(r.upset).toMatchObject({ kind: 'seed', team: 'Baylor', seed: 13, loserSeed: 4, loser: 'Kansas' });
        expect(r.narrative).toContain("No. 13 seed Baylor's upset of No. 4 Kansas");
        expect(r.slides.find(s => s.id === 'upset').sub).toBe('No. 13 seed beat No. 4 Kansas');
    });

    test('a loss, or an ordinary win, is no story', () => {
        const r = recapFor([
            { teamId: 8, gameId: 3, score: -2, quadrant: 1, oppRank: 9 },   // Baylor lost
            { teamId: 7, gameId: 1, score: 1, quadrant: 3, oppRank: 120 }
        ]);
        expect(r.upset).toBeNull();
        expect(r.slides.some(s => s.id === 'upset')).toBe(false);
    });
});

describe('completedWeeks on hoopsgames', () => {
    // hoopsgames has no `completed`; a final is status 'final'.
    const NOW = new Date('2027-03-15T12:00:00Z');
    const g = (o) => Object.assign({ week: 19, status: 'final', startDate: '2027-03-14T20:00:00Z', startTimeTbd: false }, o);

    test('a week counts once its last tip-off has passed', () => {
        expect([...completedWeeks([g(), g({ week: 20, status: 'scheduled', startDate: '2027-03-19T20:00:00Z' })], NOW, 'basketball')]).toEqual([19]);
    });

    // Football would fold 17+ into one postseason bucket and let week 19's
    // finals mark week 20 complete with it.
    test('weeks past 16 are kept apart', () => {
        const done = completedWeeks([g({ week: 17, startDate: '2027-03-01T20:00:00Z' }), g()], NOW, 'basketball');
        expect([...done].sort()).toEqual([17, 19]);
    });

    test('a TBD tip blocks its week until the game is final', () => {
        const tbd = g({ status: 'scheduled', startTimeTbd: true, startDate: '2027-03-14T04:00:00Z' });
        expect([...completedWeeks([g(), tbd], NOW, 'basketball')]).toEqual([]);
        expect([...completedWeeks([g(), Object.assign({}, tbd, { status: 'final' })], NOW, 'basketball')]).toEqual([19]);
    });
});
