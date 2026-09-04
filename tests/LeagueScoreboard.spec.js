// Pure unit tests for modules/league-scoreboard.js — the week resolution,
// owner/points overlay and game shaping that the scoreboard endpoint feeds on.
// No DB: everything here takes plain objects.

const {
    pointsByTeamGame, ownersByTeam, weekWindows, defaultWeek,
    gameState, conferenceList, conferenceLabel, fbsConferenceNames, weekRangeOf,
    weekList, recordsByTeam, spreadSideOf, shapeGames, initialsOf, TAIL_MS
} = require('../modules/league-scoreboard');

const HOUR = 3600 * 1000;

function user(o) {
    return Object.assign({
        _id: 'u1', firstName: 'Garrett', lastName: 'Graham', color: '#ed5858',
        seasons: [{ season: 2026, franchiseName: 'Gridiron Gang', teams: [], weeklyScore: [] }]
    }, o);
}

function game(o) {
    return Object.assign({
        id: 401, week: 2, seasonType: 'regular',
        startDate: '2026-09-05T16:00:00.000Z',
        homeId: 1, homeTeam: 'Ohio State', homeConference: 'Big Ten',
        awayId: 2, awayTeam: 'Texas', awayConference: 'SEC'
    }, o);
}

function ctx(o) {
    return Object.assign({
        owners: {}, points: {}, teams: {}, ranks: {}, lines: {}, records: {},
        nowMs: Date.parse('2026-09-05T18:00:00.000Z')
    }, o);
}

describe('ownersByTeam', () => {
    test('maps every drafted team to its manager', () => {
        const users = [user({
            seasons: [{ season: 2026, franchiseName: 'Gridiron Gang', teams: [{ id: 1 }, { id: 9 }] }]
        })];
        const owners = ownersByTeam(users, 2026);
        expect(Object.keys(owners)).toEqual(['1', '9']);
        expect(owners[1]).toMatchObject({
            userId: 'u1', name: 'Garrett Graham', franchise: 'Gridiron Gang', initials: 'GG'
        });
        expect(owners[1]).toBe(owners[9]);
    });

    test('ignores seasons other than the one asked for', () => {
        const users = [user({ seasons: [{ season: 2025, teams: [{ id: 1 }] }] })];
        expect(ownersByTeam(users, 2026)).toEqual({});
    });

    test('survives a manager with no teams and a missing name', () => {
        const users = [user({ firstName: undefined, lastName: undefined, seasons: [{ season: 2026 }] })];
        const owners = ownersByTeam(users, 2026);
        expect(owners).toEqual({});
        expect(initialsOf(undefined, undefined)).toBe('?');
    });
});

describe('pointsByTeamGame', () => {
    const users = [user({
        seasons: [{
            season: 2026,
            teams: [{ id: 1 }],
            weeklyScore: [
                { week: 1, scoreByTeam: [{ teamId: 1, gameId: 300, score: 9 }] },
                { week: 2, scoreByTeam: [{ teamId: 1, gameId: 401, score: 14 }] }
            ]
        }]
    })];

    test('keys points by team AND game so other weeks cannot bleed in', () => {
        expect(pointsByTeamGame(users, 2026, 2)).toEqual({ '1:401': 14 });
    });

    test('skips entries missing an id — an unscored game is not a zero', () => {
        const partial = [user({
            seasons: [{ season: 2026, weeklyScore: [{ week: 2, scoreByTeam: [{ teamId: 1, score: 3 }] }] }]
        })];
        expect(pointsByTeamGame(partial, 2026, 2)).toEqual({});
    });
});

describe('weekWindows / defaultWeek', () => {
    const games = [
        { week: 1, startDate: '2026-08-29T16:00:00.000Z' },
        { week: 1, startDate: '2026-08-29T23:30:00.000Z' },
        { week: 2, startDate: '2026-09-05T16:00:00.000Z' },
        { week: 3, startDate: '2026-09-12T16:00:00.000Z' }
    ];
    const windows = weekWindows(games);

    test('one window per week, kickoff-bounded and week-ordered', () => {
        expect(windows.map(w => w.week)).toEqual([1, 2, 3]);
        expect(windows[0].first).toBe(Date.parse('2026-08-29T16:00:00.000Z'));
        expect(windows[0].last).toBe(Date.parse('2026-08-29T23:30:00.000Z'));
    });

    test('games with an unparseable date do not create a window', () => {
        expect(weekWindows([{ week: 4, startDate: 'not a date' }])).toEqual([]);
    });

    test('a slate in progress wins', () => {
        expect(defaultWeek(windows, Date.parse('2026-09-05T20:00:00.000Z'))).toBe(2);
    });

    test('the 6h tail keeps a just-finished slate current', () => {
        const justInside = Date.parse('2026-09-05T16:00:00.000Z') + TAIL_MS - HOUR;
        expect(defaultWeek(windows, justInside)).toBe(2);
    });

    test('midweek looks forward, not back at the settled week', () => {
        expect(defaultWeek(windows, Date.parse('2026-09-08T12:00:00.000Z'))).toBe(3);
    });

    test('after the last game it holds on the final week', () => {
        expect(defaultWeek(windows, Date.parse('2027-01-01T00:00:00.000Z'))).toBe(3);
    });

    test('preseason opens on week 1', () => {
        expect(defaultWeek(windows, Date.parse('2026-07-01T00:00:00.000Z'))).toBe(1);
    });

    test('no games at all resolves to null rather than throwing', () => {
        expect(defaultWeek([], Date.now())).toBe(null);
    });
});

describe('gameState', () => {
    const start = Date.parse('2026-09-05T16:00:00.000Z');

    test('completed is final regardless of the clock', () => {
        expect(gameState(game({ completed: true, period: 3 }), start + HOUR)).toBe('final');
    });

    test('not yet kicked off is pre', () => {
        expect(gameState(game(), start - HOUR)).toBe('pre');
    });

    test('kicked off and unfinished is live', () => {
        expect(gameState(game(), start + HOUR)).toBe('live');
    });

    test('a stuck completed flag reads final once the 6h window passes', () => {
        expect(gameState(game(), start + TAIL_MS + HOUR)).toBe('final');
    });
});

describe('shapeGames', () => {
    test('kickoff order, ties broken by id so refreshes cannot reshuffle', () => {
        const games = [
            game({ id: 3, startDate: '2026-09-05T20:00:00.000Z' }),
            game({ id: 2, startDate: '2026-09-05T16:00:00.000Z' }),
            game({ id: 1, startDate: '2026-09-05T16:00:00.000Z' })
        ];
        expect(shapeGames(games, ctx()).map(g => g.id)).toEqual([1, 2, 3]);
    });

    test('attaches the owner and that game\'s points to a drafted side', () => {
        const owners = { 1: { userId: 'u1', name: 'Garrett Graham', firstName: 'Garrett', franchise: 'GG', color: '#ed5858', avatarUrl: null, initials: 'GG' } };
        const [g] = shapeGames([game()], ctx({ owners, points: { '1:401': 14 } }));
        expect(g.home.owner).toMatchObject({ name: 'Garrett Graham', points: 14 });
        expect(g.away.owner).toBe(null);
        expect(g.leagueGame).toBe(true);
    });

    test('a game with nobody\'s teams in it is not a league game', () => {
        const [g] = shapeGames([game()], ctx());
        expect(g.leagueGame).toBe(false);
        expect(g.home.owner).toBe(null);
    });

    test('an owned team with no points yet reports null, not 0', () => {
        const owners = { 1: { userId: 'u1', name: 'G G', firstName: 'G', franchise: null, color: null, avatarUrl: null, initials: 'GG' } };
        const [g] = shapeGames([game()], ctx({ owners }));
        expect(g.home.owner.points).toBe(null);
    });

    test('period and clock are dropped once a game is not live', () => {
        const [g] = shapeGames([game({ completed: true, period: 4, clock: '00:00' })], ctx());
        expect(g.state).toBe('final');
        expect(g.period).toBe(null);
        expect(g.clock).toBe(null);
    });

    test('situation rides along on a live game', () => {
        const [g] = shapeGames([game({
            period: 3, clock: '7:42', situation: '3rd & 7 at LSU 32'
        })], ctx());
        expect(g.state).toBe('live');
        expect(g.situation).toBe('3rd & 7 at LSU 32');
    });

    test('situation is dropped once a game is not live', () => {
        const [g] = shapeGames([game({ completed: true, situation: '3rd & 7 at LSU 32' })], ctx());
        expect(g.state).toBe('final');
        expect(g.situation).toBe(null);
    });

    // The card shows down-and-distance only; the play description is a full
    // sentence that belongs on the game detail page, not in a 40-card grid.
    test('lastPlay is not shipped to the scoreboard client', () => {
        const [g] = shapeGames([game({
            period: 3, situation: '3rd & 7 at LSU 32', lastPlay: 'Ewers pass complete for 8 yds'
        })], ctx());
        expect(g.lastPlay).toBeUndefined();
    });

    // CFBD sends the SIDE, not a team name — verified against a live game:
    // { possession: 'away', homeTeam: 'Buffalo Bulls', ... }. The old
    // `possession === team` check compared that to a school name, so it was
    // never true and the marker never rendered on any surface.
    test('possession is flagged from the CFBD side value', () => {
        const [g] = shapeGames([game({ possession: 'away', period: 3 })], ctx());
        expect(g.away.possession).toBe(true);
        expect(g.home.possession).toBe(false);
    });

    test('possession still resolves if CFBD ever sends a team name instead', () => {
        const [g] = shapeGames([game({ possession: 'Texas', period: 3 })], ctx());
        expect(g.away.possession).toBe(true);
        expect(g.home.possession).toBe(false);
    });

    test('no possession value leaves both sides unflagged', () => {
        const [g] = shapeGames([game({ period: 3 })], ctx());
        expect(g.away.possession).toBe(false);
        expect(g.home.possession).toBe(false);
    });

    test('ranked is true when either side is in the AP poll', () => {
        const [g] = shapeGames([game()], ctx({ ranks: { Texas: 7 } }));
        expect(g.ranked).toBe(true);
        expect(g.away.rank).toBe(7);
        expect(g.home.rank).toBe(null);
    });

    test('logo and abbreviation come from the team map, not the game doc', () => {
        const teams = { 1: { abbr: 'OSU', logo: 'https://x/osu.png' } };
        const [g] = shapeGames([game()], ctx({ teams }));
        expect(g.home).toMatchObject({ abbr: 'OSU', logo: 'https://x/osu.png' });
        expect(g.away).toMatchObject({ abbr: null, logo: null });
    });

    test('the record lands on the side it belongs to', () => {
        const [g] = shapeGames([game()], ctx({ records: { 1: '3-1' } }));
        expect(g.home.record).toBe('3-1');
        expect(g.away.record).toBe(null);
    });

    test('only the favoured side carries the spread', () => {
        const [g] = shapeGames([game()], ctx({ lines: { 401: { formattedSpread: 'Ohio State -6.5' } } }));
        expect(g.home.line).toBe('-6.5');
        expect(g.away.line).toBe(null);
    });

    test('the chosen betting line rides along for pregame display', () => {
        const [g] = shapeGames([game()], ctx({ lines: { 401: { formattedSpread: 'Ohio State -6.5', overUnder: 52.5 } } }));
        expect(g.spread).toBe('Ohio State -6.5');
        expect(g.overUnder).toBe(52.5);
    });
});

describe('recordsByTeam', () => {
    test('formats a season record per team', () => {
        expect(recordsByTeam([{ teamId: 1, total: { wins: 3, losses: 1 } }])).toEqual({ 1: '3-1' });
    });

    // 0-0 is a real record, and every team on a slate has a Record doc — dropping
    // it would badge one row and leave its opponent bare.
    test('a team that has not played yet reports 0-0', () => {
        expect(recordsByTeam([{ teamId: 1, total: { wins: 0, losses: 0 } }])).toEqual({ 1: '0-0' });
    });

    test('ties get a third segment', () => {
        expect(recordsByTeam([{ teamId: 1, total: { wins: 3, losses: 1, ties: 1 } }])).toEqual({ 1: '3-1-1' });
    });

    test('docs missing a total or an id are skipped rather than throwing', () => {
        expect(recordsByTeam([{ teamId: 1 }, { total: { wins: 2, losses: 0 } }, null])).toEqual({});
    });
});

describe('spreadSideOf', () => {
    const g = { homeTeam: 'Georgia Tech', awayTeam: 'Colorado' };

    test('attributes the line to the favoured side', () => {
        expect(spreadSideOf('Georgia Tech -7', g)).toEqual({ side: 'home', line: '-7' });
        expect(spreadSideOf('Colorado -3.5', g)).toEqual({ side: 'away', line: '-3.5' });
    });

    // Splitting on '-' would credit this to "Bethune" and match nothing.
    test('a hyphenated team name is parsed from the trailing number', () => {
        const hy = { homeTeam: 'UCF', awayTeam: 'Bethune-Cookman' };
        expect(spreadSideOf('Bethune-Cookman -3.5', hy)).toEqual({ side: 'away', line: '-3.5' });
    });

    test('a whole-number line loses its trailing zero', () => {
        expect(spreadSideOf('Georgia Tech -16.0', g)).toEqual({ side: 'home', line: '-16' });
    });

    // A spread shown against the wrong team is worse than showing none.
    test('a team name that matches neither side is dropped', () => {
        expect(spreadSideOf('Clemson -7', g)).toBe(null);
    });

    test('unparseable or absent input is null', () => {
        expect(spreadSideOf('EVEN', g)).toBe(null);
        expect(spreadSideOf(null, g)).toBe(null);
    });
});

describe('conferenceLabel', () => {
    test('shortens the names too long for the filter control', () => {
        expect(conferenceLabel('American Athletic')).toBe('AAC');
        expect(conferenceLabel('Mountain West')).toBe('MWC');
        expect(conferenceLabel('FCS Independents')).toBe('FCS Ind');
    });

    test('names that are already short pass through untouched', () => {
        expect(conferenceLabel('SEC')).toBe('SEC');
        expect(conferenceLabel('Big 12')).toBe('Big 12');
        expect(conferenceLabel('Pac-12')).toBe('Pac-12');
    });

    // Realignment invents conferences faster than a hardcoded map can track, so
    // an unknown name must degrade to itself rather than to blank or undefined.
    test('an unknown conference falls back to its full name', () => {
        expect(conferenceLabel('Pac-16')).toBe('Pac-16');
    });
});

describe('conferenceList', () => {
    test('deduped, derived from the slate, and labelled for display', () => {
        const games = [
            game(),
            game({ id: 402, homeConference: 'ACC', awayConference: 'Mountain West' })
        ];
        expect(conferenceList(games)).toEqual([
            { name: 'ACC', label: 'ACC' },
            { name: 'Mountain West', label: 'MWC' },
            { name: 'SEC', label: 'SEC' },
            { name: 'Big Ten', label: 'Big Ten' }
        ].sort((a, b) => a.label.localeCompare(b.label)));
    });

    // The value has to stay the full name — that is what the Game docs carry
    // and what the client filters on.
    test('keeps the full name as the value behind a shortened label', () => {
        const [first] = conferenceList([game({ homeConference: 'Conference USA', awayConference: null })]);
        expect(first).toEqual({ name: 'Conference USA', label: 'CUSA' });
    });

    test('sorted by the label the dropdown actually shows', () => {
        const games = [game({ homeConference: 'Mid-American', awayConference: 'Big Sky' })];
        expect(conferenceList(games).map(c => c.label)).toEqual(['Big Sky', 'MAC']);
    });

    test('an independent with no conference does not become a blank option', () => {
        expect(conferenceList([game({ homeConference: null, awayConference: undefined })])).toEqual([]);
    });

    test('narrows to FBS when given the league\'s conference universe', () => {
        const games = [game({ homeConference: 'SEC', awayConference: 'SWAC' })];
        const fbs = new Set(['SEC', 'Big Ten']);
        expect(conferenceList(games, fbs)).toEqual([{ name: 'SEC', label: 'SEC' }]);
    });

    test('without the FBS set every conference is still offered', () => {
        const games = [game({ homeConference: 'SEC', awayConference: 'SWAC' })];
        expect(conferenceList(games).map(c => c.name)).toEqual(['SEC', 'SWAC']);
    });
});

describe('fbsConferenceNames', () => {
    test('collects the conferences of every non-FCS team', () => {
        const teams = [
            { conference: 'SEC', classification: 'fbs' },
            { conference: 'SWAC', classification: 'fcs' },
            { conference: 'Big Ten', classification: 'fbs' }
        ];
        expect([...fbsConferenceNames(teams)].sort()).toEqual(['Big Ten', 'SEC']);
    });

    // Docs written before the classification field all came from CFBD's
    // /teams/fbs endpoint, so an absent value means FBS — same rule as
    // modules/team-scope.js. Treating it as unknown would silently drop
    // conferences from the filter.
    test('a missing classification counts as FBS', () => {
        expect([...fbsConferenceNames([{ conference: 'Pac-12' }])]).toEqual(['Pac-12']);
    });

    test('teams with no conference are skipped', () => {
        expect([...fbsConferenceNames([{ classification: 'fbs' }, null])]).toEqual([]);
    });
});

describe('weekRangeOf', () => {
    const windows = weekWindows([
        { week: 1, startDate: '2026-08-29T16:00:00.000Z' },
        { week: 1, startDate: '2026-09-01T02:30:00.000Z' },
        { week: 2, startDate: '2026-09-05T16:00:00.000Z' }
    ]);

    test('returns the first and last kickoff of the week', () => {
        expect(weekRangeOf(windows, 1)).toEqual({
            first: '2026-08-29T16:00:00.000Z',
            last: '2026-09-01T02:30:00.000Z'
        });
    });

    test('a one-game week collapses to the same instant twice', () => {
        expect(weekRangeOf(windows, 2)).toEqual({
            first: '2026-09-05T16:00:00.000Z',
            last: '2026-09-05T16:00:00.000Z'
        });
    });

    test('a week with no games is null, not a broken range', () => {
        expect(weekRangeOf(windows, 9)).toBe(null);
        expect(weekRangeOf(null, 1)).toBe(null);
    });
});

describe('weekList', () => {
    const windows = weekWindows([
        { week: 1, startDate: '2026-08-29T16:00:00.000Z' },
        { week: 1, startDate: '2026-09-01T02:30:00.000Z' },
        { week: 2, startDate: '2026-09-05T16:00:00.000Z' }
    ]);

    test('every week carries its own dates for the picker', () => {
        expect(weekList(windows)).toEqual([
            { week: 1, first: '2026-08-29T16:00:00.000Z', last: '2026-09-01T02:30:00.000Z' },
            { week: 2, first: '2026-09-05T16:00:00.000Z', last: '2026-09-05T16:00:00.000Z' }
        ]);
    });

    test('no windows is an empty list, not a throw', () => {
        expect(weekList(null)).toEqual([]);
    });
});
