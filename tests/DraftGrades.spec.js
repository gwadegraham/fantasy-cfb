// Coverage for modules/draft-grades.js — the post-draft, per-league
// expected-points grade. The projection engine itself is exercised in
// DraftProjection.spec.js; this pins the grade LAYER on top of it: the fixed
// letter bands, the per-user aggregation/shape, the absolute grade ordering,
// and the steal/reach (bestPick/worstPick) thresholds.

const { computeGrades, letterFor, spFor, winsFor } = require('../modules/draft-grades');

const GRADE_ORDER = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D'];

// --- fixtures ------------------------------------------------------------

// A pool team with an SP+ rating for `season`. Expected wins track SP+ so the
// projection spreads out; conference lets the conf-title softmax find peers.
function poolTeam(id, sp, conf) {
    return {
        id, school: `T${id}`, logos: [`t${id}.png`], conference: conf, alternateNames: [],
        seasons: [{
            season: 2025, spRating: sp, conference: conf,
            expectedWins: Math.max(1, Math.min(12, 6 + sp / 6))
        }]
    };
}

// 30-team pool, SP+ 29 → 0, conferences cycled so softmax denominators exist.
function buildPool() {
    const confs = ['SEC', 'Big Ten', 'ACC', 'Big 12'];
    const teamsById = {};
    for (let i = 0; i < 30; i++) {
        const id = 100 + i;
        teamsById[String(id)] = poolTeam(id, 29 - i, confs[i % confs.length]);
    }
    return teamsById;
}

function pick(userId, team, overall, round) {
    return { userId, team, overall, round };
}

describe('letterFor (fixed absolute bands)', () => {
    test('each band boundary maps to the expected letter', () => {
        expect(letterFor(0.85)).toBe('A');
        expect(letterFor(0.75)).toBe('A-');
        expect(letterFor(0.65)).toBe('B+');
        expect(letterFor(0.55)).toBe('B');
        expect(letterFor(0.45)).toBe('B-');
        expect(letterFor(0.35)).toBe('C+');
        expect(letterFor(0.25)).toBe('C');
        expect(letterFor(0.24)).toBe('D');
        expect(letterFor(0)).toBe('D');
    });
    test('a value just under a boundary drops to the lower grade', () => {
        expect(letterFor(0.8499)).toBe('A-');
        expect(letterFor(0.6499)).toBe('B');
    });
});

describe('computeGrades — aggregation & shape', () => {
    const teamsById = buildPool();
    const bySp = Object.keys(teamsById).sort((a, b) => teamsById[b].seasons[0].spRating - teamsById[a].seasons[0].spRating);
    const top5 = bySp.slice(0, 5).map(id => teamsById[id]);
    const bottom5 = bySp.slice(-5).map(id => teamsById[id]);

    const usersById = {
        a: { firstName: 'Ann', lastName: 'Adams', avatarUrl: 'ann.png', seasons: [{ season: 2025, franchiseName: 'Anvils' }] },
        b: { firstName: 'Bob', lastName: 'Barns', seasons: [{ season: 2025 }] }   // no franchise, no avatar
    };
    // Manager A drafts the 5 best teams, B the 5 worst. Overalls interleaved.
    const picks = [];
    for (let r = 0; r < 5; r++) {
        picks.push(pick('a', top5[r], r * 2 + 1, r + 1));
        picks.push(pick('b', bottom5[r], r * 2 + 2, r + 1));
    }
    const draft = { season: 2025, league: 'graham-league', totalRounds: 5, draftOrder: ['a', 'b'], picks };
    const grades = computeGrades(draft, usersById, teamsById, {});

    test('returns exactly one entry per drafting manager', () => {
        expect(grades).toHaveLength(2);
        expect(grades.map(g => g.userId).sort()).toEqual(['a', 'b']);
    });

    test('display name is "First L." and franchise/avatar fall back to null', () => {
        const a = grades.find(g => g.userId === 'a');
        const b = grades.find(g => g.userId === 'b');
        expect(a.name).toBe('Ann A.');
        expect(a.franchise).toBe('Anvils');
        expect(a.avatarUrl).toBe('ann.png');
        expect(b.franchise).toBeNull();
        expect(b.avatarUrl).toBeNull();
    });

    test('every entry has the documented numeric shape', () => {
        grades.forEach(g => {
            expect(GRADE_ORDER).toContain(g.grade);
            expect(Number.isInteger(g.projPoints)).toBe(true);
            expect(Number.isInteger(g.regPoints)).toBe(true);
            expect(Number.isInteger(g.postPoints)).toBe(true);
            expect(typeof g.projWins).toBe('number');
            expect(typeof g.cfpCount).toBe('number');
        });
    });

    test('the elite roster grades absolutely better than the scrub roster', () => {
        const a = grades.find(g => g.userId === 'a');
        const b = grades.find(g => g.userId === 'b');
        expect(a.projPoints).toBeGreaterThan(b.projPoints);
        expect(GRADE_ORDER.indexOf(a.grade)).toBeLessThan(GRADE_ORDER.indexOf(b.grade));
        expect(a.grade).not.toBe('D');   // top-5-caliber roster is not replacement level
        expect(b.grade).toBe('D');       // last-5-caliber roster bottoms out
    });

    test('output is sorted best grade first (then by projected points)', () => {
        for (let i = 1; i < grades.length; i++) {
            expect(GRADE_ORDER.indexOf(grades[i - 1].grade))
                .toBeLessThanOrEqual(GRADE_ORDER.indexOf(grades[i].grade));
        }
        expect(grades[0].userId).toBe('a');   // elite manager on top
    });

    test('no picks → no grades', () => {
        const empty = computeGrades({ season: 2025, league: 'graham-league', totalRounds: 5, draftOrder: [], picks: [] }, {}, teamsById, {});
        expect(empty).toEqual([]);
    });
});

describe('computeGrades — steal (bestPick) & reach (worstPick)', () => {
    // Six independents so the conf-title softmax is out of the picture; grades
    // then rank purely on CFP odds (+ one team's regular slate). Distinct odds
    // make the projected-points order strict, so we can place a known steal and
    // a known reach at the draft's ends.
    function indep(id, makeOdds, champOdds, extra) {
        return Object.assign({
            id, school: `I${id}`, logos: [`i${id}.png`], conference: 'FBS Independents', alternateNames: [],
            seasons: [{ season: 2025, spRating: 5, conference: 'FBS Independents', expectedWins: 6, cfpMakeOdds: makeOdds, cfpChampOdds: champOdds }]
        }, extra || {});
    }
    // FLOOR (worst odds) is taken FIRST; ELITE (best odds + a winning slate) LAST.
    const FLOOR = indep(10, +500, +5000);
    const ELITE = indep(60, -600, +150, { seasons: [{ season: 2025, spRating: 40, conference: 'FBS Independents', expectedWins: 11, cfpMakeOdds: -600, cfpChampOdds: +150 }] });
    const midOdds = [[20, +250, +2000], [30, +120, +900], [40, -110, +500], [50, -250, +250]];
    const mids = midOdds.map(([id, m, c]) => indep(id, m, c));

    const teamsById = {};
    [FLOOR, ...mids, ELITE].forEach(t => { teamsById[String(t.id)] = t; });

    // ELITE beats three non-pool cupcakes → it (and only it) banks regular points.
    const games = [9001, 9002, 9003].map((oppId, i) => ({
        id: i + 1, season: 2025, week: i + 1, seasonType: 'regular', conferenceGame: false, neutralSite: false,
        homeId: 60, homeTeam: 'I60', homeConference: 'FBS Independents', homePoints: 1,
        awayId: oppId, awayTeam: `Cupcake${oppId}`, awayConference: 'ACC', awayPoints: 0
    }));

    // One manager drafts all six. FLOOR at overall 1, ELITE at overall 6.
    const draftOrderIds = [FLOOR, mids[0], mids[1], mids[2], mids[3], ELITE];
    const picks = draftOrderIds.map((t, i) => pick('m', t, i + 1, i + 1));
    const draft = { season: 2025, league: 'graham-league', totalRounds: 6, draftOrder: ['m'], picks };
    const usersById = { m: { firstName: 'Mel', lastName: 'Moss', seasons: [{ season: 2025 }] } };

    const grades = computeGrades(draft, usersById, teamsById, { games });
    const g = grades[0];

    test('the late-drafted powerhouse surfaces as the steal (bestPick)', () => {
        expect(g.bestPick).not.toBeNull();
        expect(g.bestPick.teamId).toBe('60');      // ELITE (teamId is stringified)
        expect(g.bestPick.value).toBeGreaterThanOrEqual(5);
        expect(g.bestPick.logo).toBe('i60.png');
        expect(Number.isInteger(g.bestPick.points)).toBe(true);
    });

    test('the early-drafted weakling surfaces as the reach (worstPick)', () => {
        expect(g.worstPick).not.toBeNull();
        expect(g.worstPick.teamId).toBe('10');     // FLOOR (teamId is stringified)
        expect(g.worstPick.value).toBeLessThanOrEqual(-5);
    });

    test('bestPick/worstPick stay null when no pick beats its slot by the ±5 threshold', () => {
        // Two teams, drafted in projected-points order → every value is small.
        const two = { 60: ELITE, 50: teamsById['50'] };
        const p = [pick('m', ELITE, 1, 1), pick('m', teamsById['50'], 2, 2)];
        const small = computeGrades({ season: 2025, league: 'graham-league', totalRounds: 2, draftOrder: ['m'], picks: p }, usersById, two, { games })[0];
        expect(small.bestPick).toBeNull();
        expect(small.worstPick).toBeNull();
    });
});

describe('re-exported season helpers', () => {
    test('spFor / winsFor read the current season, falling back to the prior one', () => {
        const team = { seasons: [{ season: 2024, spRating: 12, expectedWins: 9 }] };
        expect(spFor(team, 2024)).toBe(12);
        expect(spFor(team, 2025)).toBe(12);   // no 2025 → prior-season fallback
        expect(winsFor(team, 2025)).toBe(9);
        expect(spFor({ seasons: [] }, 2025)).toBeNull();
    });
});
