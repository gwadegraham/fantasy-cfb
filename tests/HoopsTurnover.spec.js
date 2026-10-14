// Basketball roster turnover (#541): the pure summariser and the page
// reader in modules/hoops-turnover.js.
//
// Rows below are in CBBD's /recruiting/portal and /recruiting/teams shapes
// as measured on 14 Oct 2026 (year=2026).

const { useMongo } = require('./helpers/mongo');
const { portalYear, outcome, summarize, turnoverFor, MAX_LISTED } = require('../modules/hoops-turnover');
const HoopsTeamTurnover = require('../models/hoopsTeamTurnover');

const portal = (first, last, from, to, o = {}) => Object.assign({
    id: Math.floor(Math.random() * 1e9), year: 2026, firstName: first, lastName: last, position: 'G',
    origin: from == null ? null : { id: from, name: `S${from}`, conference: 'X' },
    destination: to == null ? null : { id: to, name: `S${to}`, conference: 'Y' },
    stars: 3, rating: 0.85, eligibility: 'Immediate', yearsRemaining: null
}, o);

const TEAMS = [{ id: 1, school: 'One' }, { id: 2, school: 'Two' }, { id: 3, school: 'Three' }];

describe('which CBBD year', () => {
    // Measured: year=2026 players were on their ORIGIN school's 2025–26
    // roster, and Duke's year=2026 recruits are on its 2026–27 roster.
    test('the turnover into season S is CBBD year S - 1', () => {
        expect(portalYear(2027)).toBe(2026);
        expect(portalYear('2027')).toBe(2026);
    });
});

describe('outcome', () => {
    test('a new school is a move', () => {
        expect(outcome(portal('A', 'B', 1, 2))).toBe('moved');
    });

    test('no school listed is a departure all the same', () => {
        expect(outcome(portal('A', 'B', 1, null))).toBe('left');
    });

    // 35 rows in 2026: withdrawn, no destination. They never left.
    test('withdrawn with no new school stayed', () => {
        expect(outcome(portal('A', 'B', 1, null, { eligibility: 'Withdrawn' }))).toBeNull();
    });

    // 1 row in 2026: withdrawn WITH a destination. He is on his old
    // school's 2026–27 roster, so withdrawn wins.
    test('withdrawn stayed even when a destination is listed', () => {
        expect(outcome(portal('Kyle', 'Marshall', 1, 2, { eligibility: 'Withdrawn' }))).toBeNull();
    });

    // 2 rows in 2026: "transferred" to the school they left.
    test('a destination that is the origin stayed', () => {
        expect(outcome(portal('A', 'B', 1, 1))).toBeNull();
    });

    test('no origin is not a move', () => {
        expect(outcome(portal('A', 'B', null, 2))).toBeNull();
    });
});

describe('summarize', () => {
    test('counts in and out per team, with the other school on each name', () => {
        const { byTeam } = summarize([
            portal('Al', 'Pha', 1, 2, { stars: 4, rating: 0.95 }),
            portal('Be', 'Ta', 3, 2, { stars: 3, rating: 0.85 }),
            portal('Ga', 'Mma', 2, null)
        ], [], TEAMS);

        const two = byTeam.get(2);
        expect(two.in).toEqual({ count: 2, topStars: 1, avgRating: 0.9 });
        expect(two.out).toEqual({ count: 1, topStars: 0, avgRating: 0.85 });
        expect(two.arrivals.map(m => [m.name, m.teamId, m.school])).toEqual([['Al Pha', 1, 'S1'], ['Be Ta', 3, 'S3']]);
        expect(two.departures).toEqual([{ name: 'Ga Mma', position: 'G', stars: 3, rating: 0.85, teamId: null, school: null }]);
        expect(byTeam.get(1).out.count).toBe(1);
        expect(byTeam.get(1).in.count).toBe(0);
    });

    test('every team gets a row, so no moves reads +0 / −0 rather than missing', () => {
        const { byTeam } = summarize([], [], TEAMS);
        expect([...byTeam.keys()]).toEqual([1, 2, 3]);
        expect(byTeam.get(3).in).toEqual({ count: 0, topStars: 0, avgRating: null });
        expect(byTeam.get(3).classRank).toBeNull();
    });

    test('players who stayed are on neither list', () => {
        const { byTeam, rows } = summarize([
            portal('Stay', 'Ed', 1, null, { eligibility: 'Withdrawn' }),
            portal('Back', 'Home', 1, 1)
        ], [], TEAMS);
        expect(byTeam.get(1).out.count).toBe(0);
        expect(byTeam.get(1).in.count).toBe(0);
        expect(rows).toBe(0);
    });

    test('a Division II school keeps its name but no id, so the page does not link a 404', () => {
        const { byTeam, rows, matched } = summarize([
            portal('Up', 'Grade', 900, 1),
            portal('Down', 'Grade', 2, 901),
            portal('Not', 'Ours', 902, 903)
        ], [], TEAMS);
        expect(byTeam.get(1).arrivals[0]).toMatchObject({ teamId: null, school: 'S900' });
        expect(byTeam.get(2).departures[0]).toMatchObject({ teamId: null, school: 'S901' });
        expect(byTeam.has(902)).toBe(false);
        expect([rows, matched]).toEqual([3, 2]);
    });

    test('best first, and the list is capped while the count is not', () => {
        const many = Array.from({ length: MAX_LISTED + 3 }, (_, i) =>
            portal(`P${i}`, 'X', 1, 2, { rating: i === 7 ? 0.99 : 0.8, stars: i === 7 ? 5 : 3 }));
        many.push(portal('Un', 'Rated', 1, 2, { rating: null, stars: 4 }));
        const two = summarize(many, [], TEAMS).byTeam.get(2);
        expect(two.in.count).toBe(MAX_LISTED + 4);
        expect(two.arrivals).toHaveLength(MAX_LISTED);
        expect(two.arrivals[0].name).toBe('P7 X');
        // Unrated sorts below every rated transfer, but its stars still count.
        expect(two.arrivals.map(m => m.name)).not.toContain('Un Rated');
        expect(two.in.topStars).toBe(2);
    });

    test('a row CBBD sends twice counts once', () => {
        const { byTeam } = summarize([portal('Dup', 'Licate', 1, 2, { id: 7 }), portal('Dup', 'Licate', 1, 2, { id: 7 })], [], TEAMS);
        expect(byTeam.get(2).in.count).toBe(1);
        expect(byTeam.get(1).out.count).toBe(1);
    });

    test('two players who share a name and a move are not merged', () => {
        const { byTeam } = summarize([portal('Same', 'Name', 1, 2, { id: 7 }), portal('Same', 'Name', 1, 2, { id: 8 })], [], TEAMS);
        expect(byTeam.get(2).in.count).toBe(2);
    });

    test('rows with no id fall back to name and move', () => {
        const { byTeam } = summarize([portal('No', 'Id', 1, 2, { id: null }), portal('No', 'Id', 1, 2, { id: null })], [], TEAMS);
        expect(byTeam.get(2).in.count).toBe(1);
    });

    test('a nameless row is skipped, not stored with a blank name', () => {
        const { byTeam } = summarize([portal('', '', 1, 2)], [], TEAMS);
        expect(byTeam.get(2).in.count).toBe(0);
    });

    test('class rank and rating attach by teamId; an unranked class is null', () => {
        const { byTeam, classes } = summarize([], [
            { teamId: 2, team: 'Two', year: 2026, ranking: 12, rating: 51.3 },
            { teamId: 999, team: 'Not ours', year: 2026, ranking: 1, rating: 70 },
            { teamId: null, team: 'Broken', ranking: 3 }
        ], TEAMS);
        expect(byTeam.get(2)).toMatchObject({ classRank: 12, classRating: 51.3 });
        expect(byTeam.get(1)).toMatchObject({ classRank: null, classRating: null });
        expect(classes).toBe(1);
    });
});

describe('turnoverFor', () => {
    useMongo();

    const stored = (teamId, o = {}) => Object.assign({
        season: 2027, teamId, fromYear: 2026, school: `S${teamId}`, fetchedAt: new Date('2026-10-14T12:00:00Z'),
        in: { count: 4, topStars: 1, avgRating: 0.9 }, out: { count: 3, topStars: 0, avgRating: null },
        arrivals: [{ name: 'Al Pha', position: 'G', stars: 4, rating: 0.95, teamId: 9, school: 'Nine' }],
        departures: [], classRank: 12, classRating: 51.3
    }, o);

    test('the pool slice is counts and class rank only — no names', async () => {
        await HoopsTeamTurnover.create([stored(1), stored(2, { classRank: null })]);
        const tv = await turnoverFor(2027, [1, 2]);
        expect(tv.source).toEqual({ fromYear: 2026, season: 2027, fetchedAt: new Date('2026-10-14T12:00:00Z') });
        expect(tv.byTeam['1']).toEqual({ in: 4, out: 3, inTop: 1, outTop: 0, classRank: 12 });
        expect(tv.byTeam['2'].classRank).toBeNull();
    });

    // The pool reads 365 teams; the name lists are most of each row's bytes.
    test('the pool read does not even fetch the name lists', async () => {
        const find = jest.spyOn(HoopsTeamTurnover, 'find');
        await turnoverFor(2027, [1]);
        expect(find.mock.calls[0][1]).not.toHaveProperty('arrivals');
        expect(find.mock.calls[0][1]).toMatchObject({ 'in.count': 1, 'out.count': 1, classRank: 1 });
        find.mockRestore();
    });

    test('the full record carries the name lists, for the team page', async () => {
        await HoopsTeamTurnover.create(stored(1));
        const tv = await turnoverFor(2027, [1], { full: true });
        expect(tv.byTeam['1']).toEqual({
            in: 4, out: 3, inTop: 1, outTop: 0, classRank: 12,
            inAvgRating: 0.9, outAvgRating: null, classRating: 51.3,
            arrivals: [{ name: 'Al Pha', position: 'G', stars: 4, rating: 0.95, teamId: 9, school: 'Nine' }],
            departures: []
        });
    });

    test('another season, or a team not asked for, is not read', async () => {
        await HoopsTeamTurnover.create([stored(1, { season: 2026, fromYear: 2025 }), stored(2)]);
        const tv = await turnoverFor(2027, [1]);
        expect(tv).toEqual({ source: null, byTeam: {} });
        expect(Object.keys((await turnoverFor(2027)).byTeam)).toEqual(['2']);
    });
});
