const { buildWeeklyRecaps, buildSlides, indexUpsets, narrate, recapWindowKey, isRecapSeason } = require('../modules/weekly-recap');

// Two managers, one league, season 2025. Manager A trails after week 1 then
// overtakes in week 2 on a big Oregon week.
function fixture() {
    const teamsA = [
        { id: 1, school: 'Oregon', mascot: 'Ducks', logos: ['o1.png', 'o2.png'] },
        { id: 2, school: 'Duke', mascot: 'Blue Devils', logos: ['d.png'] }
    ];
    const teamsB = [{ id: 3, school: 'Iowa', mascot: 'Hawkeyes', logos: ['i.png'] }];
    const A = {
        _id: 'a', firstName: 'Ann', lastName: 'Adams', league: 'graham-league',
        seasons: [{
            season: 2025, teams: teamsA, cumulativeScore: 80,
            weeklyScore: [
                { week: 1, score: 30, scoreByTeam: [{ team: 'Oregon', teamId: 1, gameId: 100, score: 20 }, { team: 'Duke', teamId: 2, gameId: 101, score: 10 }] },
                { week: 2, score: 50, scoreByTeam: [{ team: 'Oregon', teamId: 1, gameId: 102, score: 35 }, { team: 'Duke', teamId: 2, gameId: 103, score: 15 }] }
            ]
        }]
    };
    const B = {
        _id: 'b', firstName: 'Bob', lastName: 'Barns', league: 'graham-league',
        seasons: [{
            season: 2025, teams: teamsB, cumulativeScore: 60,
            weeklyScore: [
                { week: 1, score: 40, scoreByTeam: [{ team: 'Iowa', teamId: 3, gameId: 200, score: 40 }] },
                { week: 2, score: 20, scoreByTeam: [{ team: 'Iowa', teamId: 3, gameId: 201, score: 20 }] }
            ]
        }]
    };
    return { A, B, users: [A, B] };
}

describe('buildWeeklyRecaps', () => {
    test('produces one recap per played week, oldest first', () => {
        const { A, users } = fixture();
        const { recaps } = buildWeeklyRecaps({ user: A, leagueUsers: users, season: 2025 });
        expect(recaps.map(r => r.week)).toEqual([1, 2]);
    });

    test('rank, movement, and vs-league-average are computed per week', () => {
        const { A, users } = fixture();
        const { recaps } = buildWeeklyRecaps({ user: A, leagueUsers: users, season: 2025 });
        const [w1, w2] = recaps;
        // Week 1: A (30) trails B (40) → 2nd, no prior week so no movement.
        expect(w1.rank).toBe(2);
        expect(w1.rankDelta).toBeNull();
        expect(w1.leagueAvg).toBe(35);       // (30 + 40) / 2
        expect(w1.vsLeagueAvg).toBe(-5);
        // Week 2: A cum 80 vs B cum 60 → 1st, climbed one spot from 2nd.
        expect(w2.rank).toBe(1);
        expect(w2.rankDelta).toBe(1);
        expect(w2.leagueAvg).toBe(35);       // (50 + 20) / 2
        expect(w2.vsLeagueAvg).toBe(15);
    });

    test('MVP team is the roster team that scored most that week', () => {
        const { A, users } = fixture();
        const { recaps } = buildWeeklyRecaps({ user: A, leagueUsers: users, season: 2025 });
        expect(recaps[0].mvpTeam.school).toBe('Oregon');
        expect(recaps[0].mvpTeam.score).toBe(20);
        expect(recaps[0].mvpTeam.logo).toBe('o2.png');    // logos.at(-1)
        expect(recaps[1].mvpTeam.score).toBe(35);
    });

    test('base narrative (no upset context) reads cleanly and flags the climb', () => {
        const { A, users } = fixture();
        const { recaps } = buildWeeklyRecaps({ user: A, leagueUsers: users, season: 2025 });
        expect(recaps[1].isUpset).toBe(false);
        expect(recaps[1].narrative).toContain('climbed 1 spot to 1st');
        expect(recaps[1].narrative).toContain('Oregon');
    });

    test('MVP/dud sum per team when a team appears in multiple games (postseason)', () => {
        const u = {
            _id: 'p', firstName: 'Post', lastName: 'Season', league: 'graham-league',
            seasons: [{
                season: 2025, teams: [{ id: 1, school: 'Oregon', logos: ['o.png'] }, { id: 2, school: 'Duke', logos: ['d.png'] }],
                weeklyScore: [{
                    week: 1, season: 'postseason', score: 24, scoreByTeam: [
                        { team: 'Oregon', score: 6 }, { team: 'Oregon', score: 6 }, { team: 'Oregon', score: 6 },
                        { team: 'Duke', score: 6 }
                    ]
                }]
            }]
        };
        const { recaps } = buildWeeklyRecaps({ user: u, leagueUsers: [u], season: 2025 });
        expect(recaps[0].label).toBe('Postseason');
        expect(recaps[0].mvpTeam).toMatchObject({ school: 'Oregon', score: 18 });   // 3×6, not 6
        expect(recaps[0].dudTeam).toMatchObject({ school: 'Duke', score: 6 });
    });

    test('co-MVPs: teams tied for the week best surface together', () => {
        const u = {
            _id: 'q', firstName: 'Tie', lastName: 'Guy', league: 'graham-league',
            seasons: [{
                season: 2025, teams: [{ id: 1, school: 'Oregon', logos: ['o.png'] }, { id: 2, school: 'Ole Miss', logos: ['om.png'] }, { id: 3, school: 'Duke', logos: ['d.png'] }],
                weeklyScore: [{
                    week: 1, season: 'postseason', score: 42, scoreByTeam: [
                        { team: 'Oregon', score: 6 }, { team: 'Oregon', score: 6 }, { team: 'Oregon', score: 6 },  // 18
                        { team: 'Ole Miss', score: 9 }, { team: 'Ole Miss', score: 9 },                            // 18
                        { team: 'Duke', score: 6 }
                    ]
                }]
            }]
        };
        const { recaps } = buildWeeklyRecaps({ user: u, leagueUsers: [u], season: 2025 });
        const r = recaps[0];
        expect(r.mvpTeams.map(t => t.school).sort()).toEqual(['Ole Miss', 'Oregon']);
        expect(r.mvpTeams.every(t => t.score === 18)).toBe(true);
        const mvp = r.slides.find(s => s.id === 'mvp');
        expect(mvp.kicker).toBe('Co-MVPs');
        expect(mvp.title).toBe('Oregon & Ole Miss');
        expect(mvp.sub).toBe('18 pts each');
        expect(mvp.logos).toEqual(['o.png', 'om.png']);
    });

    test('postseason does not claim a "new season high"; it gets a season-wrap beat', () => {
        const u = {
            _id: 'w', firstName: 'Wrap', lastName: 'Up', league: 'graham-league',
            seasons: [{
                season: 2025, teams: [{ id: 1, school: 'Oregon', logos: ['o.png'] }],
                weeklyScore: [
                    { week: 1, score: 10, scoreByTeam: [{ team: 'Oregon', score: 10 }] },
                    { week: 2, score: 20, scoreByTeam: [{ team: 'Oregon', score: 20 }] }, // regular-season high
                    { week: 1, season: 'postseason', score: 60, scoreByTeam: [{ team: 'Oregon', score: 60 }] } // biggest week overall
                ]
            }]
        };
        const { recaps } = buildWeeklyRecaps({ user: u, leagueUsers: [u], season: 2025 });
        const wk2 = recaps.find(r => r.effWeek === 2);
        const post = recaps.find(r => r.effWeek === 17);
        expect(wk2.isSeasonHigh).toBe(true);                       // regular-season high still fires
        expect(post.isSeasonHigh).toBe(false);                     // postseason does NOT
        expect(post.slides.some(s => s.id === 'seasonhigh')).toBe(false);
        expect(post.slides.some(s => s.id === 'seasonwrap')).toBe(true);
    });

    test('rank ties share a placement and are flagged (T-1st)', () => {
        const mk = (id, fn, s1, s2) => ({
            _id: id, firstName: fn, lastName: 'X', league: 'graham-league',
            seasons: [{ season: 2025, teams: [{ id: 1, school: 'Oregon', logos: ['o.png'] }],
                weeklyScore: [
                    { week: 1, score: s1, scoreByTeam: [{ team: 'Oregon', score: s1 }] },
                    { week: 2, score: s2, scoreByTeam: [{ team: 'Oregon', score: s2 }] }
                ] }]
        });
        // Through week 2: A=30, B=30 (tie for 1st), C=10.
        const A = mk('a', 'Al', 10, 20), B = mk('b', 'Bo', 20, 10), C = mk('c', 'Cy', 5, 5);
        const { recaps } = buildWeeklyRecaps({ user: A, leagueUsers: [A, B, C], season: 2025 });
        const w2 = recaps.find(r => r.effWeek === 2);
        expect(w2.rank).toBe(1);
        expect(w2.rankTie).toBe(true);
        expect(w2.slides.find(s => s.id === 'rank').big).toBe('T-1st');
    });

    test('a manager who debuts after week 1 gets no bogus season-high on their first week', () => {
        const other = { _id: 'o', firstName: 'Op', lastName: 'O', league: 'graham-league',
            seasons: [{ season: 2025, teams: [{ id: 9, school: 'X', logos: ['x.png'] }],
                weeklyScore: [
                    { week: 1, score: 10, scoreByTeam: [{ team: 'X', score: 10 }] },
                    { week: 2, score: 10, scoreByTeam: [{ team: 'X', score: 10 }] }
                ] }] };
        const late = { _id: 'l', firstName: 'La', lastName: 'L', league: 'graham-league',
            seasons: [{ season: 2025, teams: [{ id: 1, school: 'Oregon', logos: ['o.png'] }],
                weeklyScore: [
                    { week: 2, score: 25, scoreByTeam: [{ team: 'Oregon', score: 25 }] },
                    { week: 3, score: 40, scoreByTeam: [{ team: 'Oregon', score: 40 }] }
                ] }] };
        const { recaps } = buildWeeklyRecaps({ user: late, leagueUsers: [other, late], season: 2025 });
        expect(recaps.find(r => r.effWeek === 2).isSeasonHigh).toBe(false);  // no prior week of their own
        expect(recaps.find(r => r.effWeek === 3).isSeasonHigh).toBe(true);   // 40 > 25
    });

    test('multiple entries sharing an effective week fold into one recap', () => {
        const u = { _id: 'm', firstName: 'Mu', lastName: 'M', league: 'graham-league',
            seasons: [{ season: 2025, teams: [{ id: 1, school: 'Oregon', logos: ['o.png'] }],
                weeklyScore: [
                    { week: 1, season: 'postseason', score: 20, scoreByTeam: [{ team: 'Oregon', score: 20 }] },
                    { week: 2, season: 'postseason', score: 14, scoreByTeam: [{ team: 'Oregon', score: 14 }] }
                ] }] };
        const { recaps } = buildWeeklyRecaps({ user: u, leagueUsers: [u], season: 2025 });
        const post = recaps.filter(r => r.effWeek === 17);
        expect(post.length).toBe(1);            // folded, not two "Postseason" recaps
        expect(post[0].score).toBe(34);         // 20 + 14
        expect(post[0].mvpTeam.score).toBe(34); // Oregon summed across both entries
    });

    test('empty when the manager has no weeks that season', () => {
        const { A, users } = fixture();
        const out = buildWeeklyRecaps({ user: A, leagueUsers: users, season: 2099 });
        expect(out.recaps).toEqual([]);
    });
});

describe('indexUpsets + layered narrative', () => {
    // Oregon (away) beats favored Georgia; home spread -7 means Georgia was a
    // 7-pt favorite, so Oregon won as a 7-pt underdog.
    const games = [
        { id: 102, week: 2, homeTeam: 'Georgia', awayTeam: 'Oregon', homePoints: 24, awayPoints: 27, completed: true },
        { id: 103, week: 2, homeTeam: 'Duke', awayTeam: 'Wake', homePoints: 31, awayPoints: 10, completed: true }
    ];
    const spreads = { 102: -7, 103: -14 };   // both home teams favored
    const rankByWeek = { 2: { Georgia: 3 } }; // Georgia was AP #3 entering week 2

    test('indexes only underdog wins, with margin, loser, and AP rank', () => {
        const idx = indexUpsets(games, spreads, rankByWeek);
        expect(idx[102]).toMatchObject({ winner: 'Oregon', loser: 'Georgia', margin: 7, loserRank: 3 });
        expect(idx[103]).toBeUndefined();     // Duke won as a favorite — not an upset
    });

    test('a rostered underdog win takes over that week’s narrative, naming the AP rank', () => {
        const { A, users } = fixture();
        const upsetByGameId = indexUpsets(games, spreads, rankByWeek);
        const { recaps } = buildWeeklyRecaps({ user: A, leagueUsers: users, season: 2025, upsetByGameId });
        const w2 = recaps[1];
        expect(w2.isUpset).toBe(true);
        expect(w2.upset).toMatchObject({ team: 'Oregon', loser: 'Georgia', margin: 7, loserRank: 3 });
        expect(w2.narrative).toContain("Oregon's upset over #3 Georgia");
        expect(w2.narrative).toContain('7-pt underdog');
    });

    test('unranked loser omits the # prefix', () => {
        const idx = indexUpsets(games, spreads);   // no rankByWeek
        expect(idx[102].loserRank).toBeNull();
        const s = narrate({ score: 20, rank: 1, rankDelta: 1, vsLeagueAvg: 5, mvp: null, upset: idx[102] });
        expect(s).toContain('over Georgia');
        expect(s).not.toContain('#');
    });
});

describe('buildSlides (story deck)', () => {
    test('a big week assembles the full conditional deck, in order', () => {
        const r = {
            label: 'Week 8', score: 16, rank: 5, rankDelta: 1, leagueAvg: 11.5, vsLeagueAvg: 4.5,
            weekHigh: true, weekLow: false,
            mvpTeam: { school: 'Louisville', score: 9, logo: 'l.png' }, mvpShare: 56,
            dudTeam: { school: 'Duke', score: 1, logo: 'd.png' },
            isUpset: true, upset: { team: 'Louisville', loser: 'Miami', loserRank: 2, margin: 10.5 },
            isSeasonHigh: true, aboveAvgStreak: 1, belowAvgStreak: 0, cumTotal: 120, milestone: null,
            narrative: 'x'
        };
        const slides = buildSlides(r);
        expect(slides.map(s => s.id)).toEqual(
            ['hook', 'rank', 'weekhigh', 'vsavg', 'mvp', 'dud', 'upset', 'seasonhigh', 'closing']);
        expect(slides.find(s => s.id === 'upset').sub).toContain('#2 Miami');
        expect(slides.find(s => s.id === 'mvp').sub).toBe('56% of your points');
        expect(slides.find(s => s.id === 'closing').cta).toBe(true);
    });

    test('a quiet week stays short (no mvp/dud/upset/momentum)', () => {
        const r = {
            label: 'Week 3', score: 0, rank: 6, rankDelta: 0, leagueAvg: 5, vsLeagueAvg: -5,
            weekHigh: false, weekLow: true, mvpTeam: null, dudTeam: null,
            isUpset: false, isSeasonHigh: false, aboveAvgStreak: 0, belowAvgStreak: 1,
            narrative: 'Quiet week.'
        };
        expect(buildSlides(r).map(s => s.id)).toEqual(['hook', 'rank', 'weeklow', 'vsavg', 'closing']);
    });

    test('buildWeeklyRecaps attaches a slide deck to each week', () => {
        const { A, users } = fixture();
        const { recaps } = buildWeeklyRecaps({ user: A, leagueUsers: users, season: 2025 });
        expect(Array.isArray(recaps[0].slides)).toBe(true);
        expect(recaps[0].slides[0].id).toBe('hook');
    });
});

describe('weekly popup gating', () => {
    test('recapWindowKey returns the most recent Monday 07:00 boundary', () => {
        // Wed 2025-09-10 → that week's Monday is 2025-09-08.
        expect(recapWindowKey(new Date(2025, 8, 10, 12, 0))).toBe('2025-09-08');
        // Monday 2025-09-08 06:59 (before 7am) → previous Monday 2025-09-01.
        expect(recapWindowKey(new Date(2025, 8, 8, 6, 59))).toBe('2025-09-01');
        // Monday 2025-09-08 07:00 exactly → that Monday.
        expect(recapWindowKey(new Date(2025, 8, 8, 7, 0))).toBe('2025-09-08');
        // Sunday 2025-09-14 23:00 → still the 2025-09-08 window.
        expect(recapWindowKey(new Date(2025, 8, 14, 23, 0))).toBe('2025-09-08');
    });

    test('isRecapSeason covers Aug–Jan only', () => {
        expect(isRecapSeason(new Date(2025, 8, 1))).toBe(true);   // September
        expect(isRecapSeason(new Date(2026, 0, 5))).toBe(true);   // January
        expect(isRecapSeason(new Date(2026, 6, 27))).toBe(false); // July (offseason)
    });
});

describe('narrate (pure)', () => {
    test('quiet week when nothing was banked', () => {
        expect(narrate({ score: 0, rank: 4, rankDelta: 0, vsLeagueAvg: 0, mvp: null, upset: null }))
            .toBe('Quiet week — no points banked.');
    });
    test('slip is phrased as a slip', () => {
        const s = narrate({ score: 22, rank: 5, rankDelta: -2, vsLeagueAvg: -8, mvp: { school: 'Duke', score: 12 }, upset: null });
        expect(s).toContain('slipped 2 spots to 5th');
        expect(s).toContain('below the league average');
    });
});
