// Hall of Fame depth: the records book and the draft retrospective.
//
// Both are derived from data already on file — user.seasons carries
// weeklyScore[].scoreByTeam, so per-team season points need no Team lookup, and
// the drafts collection is backfilled to 2023.

const { buildRecords, buildDraftHistory, teamPointsFor, pointsForTeam, breakdownFor, isPostseason } = require('../modules/hall-of-fame');

// 2026 is the in-progress season everywhere in these tests.
const isFinished = (yr) => Number(yr) < 2026;
const byKey = (rows) => rows.reduce((m, r) => (m[r.key] = r, m), {});

function user(id, first, seasons) {
    return { _id: id, firstName: first, lastName: 'Test', color: '#111', avatarUrl: null, seasons };
}
// A season with per-week, per-team detail.
function season(yr, total, weeks, teams, franchise) {
    return {
        season: yr, cumulativeScore: total, franchiseName: franchise || null,
        teams: teams || [], weeklyScore: weeks || []
    };
}
const wk = (week, score, byTeam, tag) => ({ week, score, season: tag, scoreByTeam: byTeam || [] });
const tg = (teamId, team, score) => ({ teamId, team, score });

describe('teamPointsFor', () => {
    test('sums a team across every week of the season', () => {
        const s = season(2025, 40, [
            wk(1, 20, [tg(1, 'Iowa', 12), tg(2, 'Duke', 8)]),
            wk(2, 20, [tg(1, 'Iowa', 15), tg(2, 'Duke', 5)])
        ], [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }]);
        expect(teamPointsFor(s)).toEqual([
            { teamId: 1, school: 'Iowa', points: 27 },
            { teamId: 2, school: 'Duke', points: 13 }
        ]);
    });

    // scoreByTeam only started carrying teamId in 2024. Keying purely on it read
    // every 2023 team as 0 and silently dropped the whole season.
    test('resolves a legacy name-only entry against the roster', () => {
        const s = season(2023, 12, [wk(1, 12, [{ team: 'Georgia', score: 7 }, { team: 'Georgia', score: 5 }])],
            [{ id: 61, school: 'Georgia' }]);
        expect(teamPointsFor(s)).toEqual([{ teamId: 61, school: 'Georgia', points: 12 }]);
    });

    test('keeps a name-only entry that matches no roster team, rather than dropping it', () => {
        const s = season(2023, 5, [wk(1, 5, [{ team: 'Ghost', score: 5 }])], []);
        expect(teamPointsFor(s)).toEqual([{ teamId: null, school: 'Ghost', points: 5 }]);
    });

    // A season carrying both shapes must not count the same team twice.
    test('mixed id and name entries for one team collapse to a single row', () => {
        const s = season(2024, 9, [wk(1, 9, [{ team: 'Iowa', score: 4 }, tg(1, 'Iowa', 5)])],
            [{ id: 1, school: 'Iowa' }]);
        expect(teamPointsFor(s)).toEqual([{ teamId: 1, school: 'Iowa', points: 9 }]);
    });

    test('handles an empty season', () => {
        expect(teamPointsFor(null)).toEqual([]);
        expect(teamPointsFor(season(2025, 0, []))).toEqual([]);
    });
});

describe('pointsForTeam', () => {
    const rows = [{ teamId: 61, school: 'Georgia', points: 30 }, { teamId: null, school: 'Ghost', points: 5 }];
    test('matches by id first', () => {
        expect(pointsForTeam(rows, { id: 61, school: 'Wrong Name' })).toBe(30);
    });
    test('falls back to the school name when there is no id match', () => {
        expect(pointsForTeam(rows, { id: 999, school: 'Ghost' })).toBe(5);
    });
    test('an unknown team is worth zero, not undefined', () => {
        expect(pointsForTeam(rows, { id: 1, school: 'Nobody' })).toBe(0);
        expect(pointsForTeam(null, { id: 1 })).toBe(0);
    });
});

describe('buildRecords', () => {
    const users = [
        user('a', 'Ann', [
            season(2024, 120, [wk(1, 70, [tg(1, 'Iowa', 40), tg(2, 'Duke', 30)]), wk(2, 50, [tg(1, 'Iowa', 50)])],
                [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }], 'Anvils'),
            season(2025, 60, [wk(1, 60, [tg(1, 'Iowa', 60)])], [{ id: 1, school: 'Iowa' }])
        ]),
        user('b', 'Bob', [
            season(2024, 90, [wk(1, 45, [tg(3, 'Utah', 45)]), wk(1, 45, [tg(3, 'Utah', 45)], 'postseason')],
                [{ id: 3, school: 'Utah' }])
        ])
    ];

    test('crowns the highest season, with the holder and their franchise', () => {
        const r = byKey(buildRecords(users, isFinished));
        expect(r.bestSeason).toMatchObject({ value: 120, season: 2024, suffix: 'pts' });
        expect(r.bestSeason.holder).toMatchObject({ name: 'Ann Test', franchise: 'Anvils' });
    });

    test('biggest week names the week', () => {
        const r = byKey(buildRecords(users, isFinished));
        expect(r.bestWeek).toMatchObject({ value: 70, season: 2024, detail: 'Week 1' });
    });

    // Postseason games score on a different scale (Claunts 4-10 a game vs a
    // regular max of 4) AND the whole postseason collapses into one weeklyScore
    // entry, so it out-games a Saturday too. Both records read "best postseason"
    // before this — twice.
    describe('postseason is kept out of the week and single-game records', () => {
        const withHugePost = [user('c', 'Cal', [season(2024, 200, [
            wk(1, 20, [tg(1, 'Iowa', 12), tg(2, 'Duke', 8)]),
            wk(1, 180, [tg(1, 'Iowa', 90), tg(2, 'Duke', 90)], 'postseason')
        ], [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }])])];

        test('the biggest week is the best REGULAR week', () => {
            const r = byKey(buildRecords(withHugePost, isFinished));
            expect(r.bestWeek).toMatchObject({ value: 20, detail: 'Week 1' });
        });

        test('the best single game is the best REGULAR game', () => {
            const r = byKey(buildRecords(withHugePost, isFinished));
            expect(r.bestTeamGame).toMatchObject({ value: 12, detail: 'Iowa · Week 1' });
        });

        // week > 16 is the other way a postseason row is tagged.
        test('a row tagged only by week number is also excluded', () => {
            const byWeekNum = [user('d', 'Dee', [season(2024, 100, [
                wk(1, 10, [tg(1, 'Iowa', 10)]), wk(17, 90, [tg(1, 'Iowa', 90)])
            ], [{ id: 1, school: 'Iowa' }])])];
            const r = byKey(buildRecords(byWeekNum, isFinished));
            expect(r.bestWeek.value).toBe(10);
            expect(r.bestTeamGame.value).toBe(10);
        });

        // The achievement isn't deleted — it gets a record where everyone is
        // measured against the same thing.
        test('the postseason gets its own record, with its game count', () => {
            const r = byKey(buildRecords(withHugePost, isFinished));
            expect(r.bestPostseason).toMatchObject({ value: 180, season: 2024, detail: '2 games' });
            expect(r.bestPostseason.holder.name).toBe('Cal Test');
        });

        test('several postseason rows in a season sum into one record', () => {
            const split = [user('e', 'Eve', [season(2024, 30, [
                wk(1, 10, [tg(1, 'Iowa', 10)], 'postseason'),
                wk(2, 20, [tg(1, 'Iowa', 20)], 'postseason')
            ], [{ id: 1, school: 'Iowa' }])])];
            expect(byKey(buildRecords(split, isFinished)).bestPostseason)
                .toMatchObject({ value: 30, detail: '2 games' });
        });

        test('a league that never played a postseason has no such record', () => {
            const regOnly = [user('f', 'Fay', [season(2024, 10, [wk(1, 10, [tg(1, 'Iowa', 10)])], [{ id: 1, school: 'Iowa' }])])];
            expect(byKey(buildRecords(regOnly, isFinished)).bestPostseason).toBeUndefined();
        });
    });

    test('best single game beats best full season for the same team', () => {
        const r = byKey(buildRecords(users, isFinished));
        expect(r.bestTeamGame).toMatchObject({ value: 60, detail: 'Iowa · Week 1' });   // regular only
        // Iowa 2024: 40 + 50 = 90 across the season, more than any one game.
        expect(r.bestTeamSeason).toMatchObject({ value: 90, detail: 'Iowa', season: 2024 });
    });

    // The in-progress season is excluded everywhere else on the page too.
    test('the current season cannot set a record', () => {
        const withLive = users.concat([user('z', 'Zed', [
            season(2026, 999, [wk(1, 999, [tg(4, 'Texas', 999)])], [{ id: 4, school: 'Texas' }])
        ])]);
        const r = byKey(buildRecords(withLive, isFinished));
        expect(r.bestSeason.value).toBe(120);
        expect(r.bestWeek.value).toBe(70);
    });

    test('leanest season ignores a season that was never played', () => {
        const withEmpty = users.concat([user('e', 'Eve', [season(2024, 0, [], [])])]);
        const r = byKey(buildRecords(withEmpty, isFinished));
        expect(r.worstSeason).toMatchObject({ value: 60, season: 2025 });   // not Eve's unplayed 0
    });

    test('no finished seasons yields no records rather than empty rows', () => {
        expect(buildRecords(users, () => false)).toEqual([]);
        expect(buildRecords([], isFinished)).toEqual([]);
    });
});

describe('buildDraftHistory', () => {
    // Ann took Iowa 1st (it flopped) and Duke 4th (it carried her).
    // Bob took Utah 2nd and Rice 3rd.
    const usersById = {
        a: user('a', 'Ann', [season(2025, 100, [
            wk(1, 100, [tg(1, 'Iowa', 5), tg(2, 'Duke', 95)])
        ], [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }], 'Anvils')]),
        b: user('b', 'Bob', [season(2025, 60, [
            wk(1, 60, [tg(3, 'Utah', 50), tg(4, 'Rice', 10)])
        ], [{ id: 3, school: 'Utah' }, { id: 4, school: 'Rice' }])])
    };
    const picks = [
        { overall: 1, round: 1, userId: 'a', team: { id: 1, school: 'Iowa', logos: ['i.png'] } },
        { overall: 2, round: 1, userId: 'b', team: { id: 3, school: 'Utah' } },
        { overall: 3, round: 2, userId: 'b', team: { id: 4, school: 'Rice' } },
        { overall: 4, round: 2, userId: 'a', team: { id: 2, school: 'Duke' } }
    ];
    const run = (over) => buildDraftHistory(Object.assign({ 2025: picks }, over || {}), usersById, isFinished);

    test('reports the season, pick count and who went first overall', () => {
        const [s] = run();
        expect(s).toMatchObject({ season: 2025, picks: 4, rounds: 2 });
        expect(s.firstOverall).toMatchObject({ overall: 1, team: 'Iowa', manager: 'Ann Test', points: 5 });
    });

    test('the steal is the pick that most outperformed its slot', () => {
        // Duke went 4th and finished 1st in points -> +3.
        expect(run()[0].steal).toMatchObject({ team: 'Duke', manager: 'Ann Test', overall: 4, finish: 1, delta: 3, points: 95 });
    });

    test('the bust is the pick that most underperformed it', () => {
        // Iowa went 1st and finished 4th -> -3.
        expect(run()[0].bust).toMatchObject({ team: 'Iowa', overall: 1, finish: 4, delta: -3, points: 5 });
    });

    test('top scorer is the best pick outright, regardless of slot', () => {
        expect(run()[0].topScorer).toMatchObject({ team: 'Duke', points: 95 });
    });

    // A team two leagues drafted is judged on what it did for THIS one.
    test('points come from the drafting manager\'s own scoring', () => {
        const shared = [{ overall: 1, round: 1, userId: 'b', team: { id: 2, school: 'Duke' } }];
        // Bob never scored Duke, so it's worth 0 to him even though Ann got 95.
        expect(buildDraftHistory({ 2025: shared }, usersById, isFinished)[0].firstOverall.points).toBe(0);
    });

    test('an unscored season names no steal or bust', () => {
        const blank = { a: user('a', 'Ann', [season(2025, 0, [], [])]), b: usersById.b };
        const only = [{ overall: 1, round: 1, userId: 'a', team: { id: 1, school: 'Iowa' } }];
        const [s] = buildDraftHistory({ 2025: only }, blank, isFinished);
        expect(s.steal).toBeNull();
        expect(s.bust).toBeNull();
        expect(s.topScorer).toBeNull();
    });

    // A draft where everyone landed roughly where they should have shouldn't
    // manufacture drama.
    test('a perfectly-ordered draft has no steal and no bust', () => {
        const ordered = { a: user('a', 'Ann', [season(2025, 30, [wk(1, 30, [tg(1, 'Iowa', 20), tg(2, 'Duke', 10)])], [])]) };
        const p = [
            { overall: 1, round: 1, userId: 'a', team: { id: 1, school: 'Iowa' } },
            { overall: 2, round: 1, userId: 'a', team: { id: 2, school: 'Duke' } }
        ];
        const [s] = buildDraftHistory({ 2025: p }, ordered, isFinished);
        expect(s.steal).toBeNull();
        expect(s.bust).toBeNull();
    });

    test('seasons come back newest first, and the live one is excluded', () => {
        const out = run({ 2024: picks, 2026: picks });
        expect(out.map(s => s.season)).toEqual([2025, 2024]);
    });

    test('survives a pick whose manager is no longer on file', () => {
        const orphan = [{ overall: 1, round: 1, userId: 'gone', team: { id: 1, school: 'Iowa' } }];
        const [s] = buildDraftHistory({ 2025: orphan }, usersById, isFinished);
        expect(s.firstOverall).toMatchObject({ manager: 'Unknown', points: 0 });
    });

    test('skips malformed picks instead of throwing', () => {
        const messy = [{ overall: 1, round: 1, userId: 'a' }, { team: { id: 2 }, userId: 'a' }, null];
        expect(buildDraftHistory({ 2025: messy }, usersById, isFinished)[0]).toEqual({ season: 2025, picks: 0 });
    });

    test('no drafts at all is an empty list', () => {
        expect(buildDraftHistory({}, usersById, isFinished)).toEqual([]);
    });
});

// Defensive paths — real league data has gaps (a season entry created but never
// scored, a manager with no last name, a roster row missing a school).
describe('edge cases', () => {
    test('a season that was never scored sets no records', () => {
        const u = [user('a', 'Ann', [{ season: 2024, cumulativeScore: null, weeklyScore: [], teams: [] }])];
        expect(buildRecords(u, isFinished)).toEqual([]);
    });

    test('a holder with no last name still gets a name and initials', () => {
        const u = [{ _id: 'a', firstName: 'Cher', seasons: [season(2024, 10, [wk(1, 10, [tg(1, 'Iowa', 10)])], [{ id: 1, school: 'Iowa' }])] }];
        const r = byKey(buildRecords(u, isFinished));
        expect(r.bestSeason.holder).toMatchObject({ name: 'Cher', initials: 'C', franchise: null, avatarUrl: null });
    });

    test('a roster row with no school does not break name resolution', () => {
        const s = season(2023, 5, [wk(1, 5, [{ team: 'Georgia', score: 5 }])], [{ id: 61 }, null]);
        expect(teamPointsFor(s)).toEqual([{ teamId: null, school: 'Georgia', points: 5 }]);
    });

    test('a scoreByTeam entry with neither id nor name is still counted, not dropped', () => {
        const s = season(2024, 3, [wk(1, 3, [{ score: 3 }])], []);
        expect(teamPointsFor(s)).toEqual([{ teamId: null, school: null, points: 3 }]);
    });

    test('a zero-point week never becomes the biggest week', () => {
        const u = [user('a', 'Ann', [season(2024, 0, [wk(1, 0, [tg(1, 'Iowa', 0)])], [{ id: 1, school: 'Iowa' }])])];
        const r = byKey(buildRecords(u, isFinished));
        expect(r.bestWeek).toBeUndefined();
        expect(r.bestTeamSeason).toBeUndefined();
        expect(r.bestSeason).toBeDefined();   // the season itself still exists
    });
});

// A bare "76 pts · 16 games" says nothing; the teams behind it are the story.
// Built only for the records that actually won, so a candidate never pays for it.
describe('record breakdowns', () => {
    const rec = (users, key) => byKey(buildRecords(users, isFinished))[key];

    test('a season record lists its teams, biggest first', () => {
        const u = [user('a', 'Ann', [season(2024, 30, [
            wk(1, 30, [tg(1, 'Iowa', 10), tg(2, 'Duke', 20)])
        ], [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }])])];
        expect(rec(u, 'bestSeason').breakdown).toEqual({
            kind: 'teams', rows: [{ label: 'Duke', value: 20 }, { label: 'Iowa', value: 10 }]
        });
    });

    // "Eight of nine won" is as much the story as the total.
    test('a week record keeps teams that scored nothing', () => {
        const u = [user('a', 'Ann', [season(2024, 6, [
            wk(3, 6, [tg(1, 'Iowa', 4), tg(2, 'Duke', 2), tg(3, 'Utah', 0)])
        ], [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }, { id: 3, school: 'Utah' }])])];
        expect(rec(u, 'bestWeek').breakdown.rows).toEqual([
            { label: 'Iowa', value: 4 }, { label: 'Duke', value: 2 }, { label: 'Utah', value: 0 }
        ]);
    });

    // A deep run reads as a game count — this is the shape of a title run.
    test('a postseason record groups by team and counts games', () => {
        const u = [user('a', 'Ann', [season(2024, 28, [
            wk(1, 28, [tg(1, 'Ohio State', 6), tg(1, 'Ohio State', 6), tg(1, 'Ohio State', 10), tg(2, 'Duke', 6)], 'postseason')
        ], [{ id: 1, school: 'Ohio State' }, { id: 2, school: 'Duke' }])])];
        expect(rec(u, 'bestPostseason').breakdown.rows).toEqual([
            { label: 'Ohio State', value: 22, sub: '3 games' },
            { label: 'Duke', value: 6, sub: '1 game' }
        ]);
    });

    test('a team-season record is that team week by week, postseason included', () => {
        const u = [user('a', 'Ann', [season(2024, 12, [
            wk(1, 5, [tg(1, 'Iowa', 3), tg(2, 'Duke', 2)]),
            wk(2, 0, [tg(2, 'Duke', 0)]),
            wk(1, 7, [tg(1, 'Iowa', 7)], 'postseason')
        ], [{ id: 1, school: 'Iowa' }, { id: 2, school: 'Duke' }])])];
        expect(rec(u, 'bestTeamSeason').breakdown).toEqual({
            kind: 'weeks', rows: [{ label: 'Week 1', value: 3 }, { label: 'Postseason', value: 7 }]
        });
    });

    // Its one line already states the whole fact, and the opponent can't be
    // recovered — 2023 entries carry no gameId.
    test('the single-game record gets no breakdown', () => {
        const u = [user('a', 'Ann', [season(2024, 5, [wk(1, 5, [tg(1, 'Iowa', 5)])], [{ id: 1, school: 'Iowa' }])])];
        expect(rec(u, 'bestTeamGame').breakdown).toBeUndefined();
    });

    test('the internal context never reaches the payload', () => {
        const u = [user('a', 'Ann', [season(2024, 5, [wk(1, 5, [tg(1, 'Iowa', 5)])], [{ id: 1, school: 'Iowa' }])])];
        buildRecords(u, isFinished).forEach(r => expect(r._ctx).toBeUndefined());
    });

    test('a name-only legacy season still breaks down', () => {
        const u = [user('a', 'Ann', [season(2023, 8, [wk(1, 8, [{ team: 'Georgia', score: 8 }])], [{ id: 61, school: 'Georgia' }])])];
        expect(rec(u, 'bestWeek').breakdown.rows).toEqual([{ label: 'Georgia', value: 8 }]);
    });
});

describe('breakdownFor guards', () => {
    test('no context yields nothing', () => {
        expect(breakdownFor('bestSeason', null)).toBeNull();
    });
    test('a key with no breakdown of its own yields nothing', () => {
        expect(breakdownFor('bestTeamGame', { season: season(2024, 5, [wk(1, 5, [tg(1, 'Iowa', 5)])], []) })).toBeNull();
        expect(breakdownFor('somethingNew', { season: season(2024, 5, [], []) })).toBeNull();
    });
    test('an empty season yields nothing rather than an empty list', () => {
        expect(breakdownFor('bestSeason', { season: season(2024, 0, [], []) })).toBeNull();
        expect(breakdownFor('bestPostseason', { season: season(2024, 0, [], []) })).toBeNull();
        expect(breakdownFor('bestWeek', { season: null, entry: { scoreByTeam: [] } })).toBeNull();
        expect(breakdownFor('bestTeamSeason', { season: season(2024, 0, [], []), teamId: 1 })).toBeNull();
    });
});

describe('isPostseason', () => {
    test('recognises both tagging shapes', () => {
        expect(isPostseason({ season: 'postseason', week: 1 })).toBe(true);
        expect(isPostseason({ week: 17 })).toBe(true);
        expect(isPostseason({ week: 5 })).toBe(false);
        expect(isPostseason(null)).toBe(false);
    });
});
