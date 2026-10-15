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

// --- basketball ----------------------------------------------------------
//
// Same grade layer, basketball's projection under it. The three traps #554
// named for this file: games keyed on homeTeamId (football's grouping drops
// every one), the postseason column (football's cfp + confChamp + bowl is the
// conference title alone for basketball), and the make-the-field count
// (P(NCAA bracket) must not be reported under a CFP label).
describe('computeGrades — a basketball draft', () => {
    const hoopsDraft = require('../modules/hoops-draft-projection');
    const { resolveConfig } = require('../modules/scoring-defaults');
    const config = resolveConfig('hoops-league', { model: 'hoops' });
    const CONFS = ['ACC', 'Big Ten', 'SEC'];

    // `n` teams ranked 1..n, barthag falling with rank, ids NOT in rank order
    // (id = idBase - 7·rank) so an id/rank mix-up shows.
    function country(n, { idBase = 500, conf } = {}) {
        const byId = {};
        for (let r = 1; r <= n; r++) {
            const id = idBase - 7 * r;
            byId[String(id)] = {
                id, school: `H${id}`, conference: conf || CONFS[r % 3],
                preseason: { rank: r, barthag: 0.97 - r * 0.02, adjOE: 125 - r, adjDE: 90 + r,
                             projectedRecord: `${Math.max(8, 28 - r)}-${Math.min(23, 3 + r)}` }
            };
        }
        return byId;
    }
    // Every team plays the next four by rank, home and away alternating — a
    // real schedule shape, with HoopsGame's field names.
    function schedule(byId) {
        const ids = Object.keys(byId).map(Number).sort((a, b) => byId[a].preseason.rank - byId[b].preseason.rank);
        const games = [];
        let gid = 1;
        ids.forEach((id, i) => {
            for (let k = 1; k <= 4 && i + k < ids.length; k++) {
                const [home, away] = k % 2 ? [id, ids[i + k]] : [ids[i + k], id];
                games.push({ id: gid++, season: 2027, seasonType: 'regular', week: k, status: 'scheduled',
                    homeTeamId: home, awayTeamId: away, neutralSite: k === 4, conferenceGame: false });
            }
        });
        return games;
    }
    const teamsById = country(20);
    const games = schedule(teamsById);
    const byRank = Object.keys(teamsById).sort((a, b) => teamsById[a].preseason.rank - teamsById[b].preseason.rank);
    const usersById = { a: { firstName: 'Ann', lastName: 'A' }, b: { firstName: 'Bo', lastName: 'B' } };
    const picks = [];
    for (let r = 0; r < 4; r++) {                       // a: ranks 1,4,5,8  b: 2,3,6,7
        const [first, second] = r % 2 ? ['b', 'a'] : ['a', 'b'];
        picks.push(pick(first, { id: Number(byRank[r * 2]), school: 'x' }, r * 2 + 1, r + 1));
        picks.push(pick(second, { id: Number(byRank[r * 2 + 1]), school: 'y' }, r * 2 + 2, r + 1));
    }
    const draft = { season: 2027, league: 'hoops-league', totalRounds: 4, poolSize: 12, draftOrder: ['a', 'b'], picks };
    const grades = computeGrades(draft, usersById, teamsById, { games, config, sport: 'basketball' });
    const proj = hoopsDraft.projectHoopsTeams(Object.values(teamsById), games, { cfg: config, projectIds: byRank });
    const mine = (uid) => picks.filter(p => p.userId === uid).map(p => proj[String(p.team.id)]);
    const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);

    test('the regular season is projected from the HoopsGame rows, not zeroed', () => {
        ['a', 'b'].forEach(uid => {
            const g = grades.find(m => m.userId === uid);
            expect(g.regPoints).toBeGreaterThan(0);
            expect(g.regPoints).toBe(Math.round(sum(mine(uid), p => p.regular)));
        });
    });

    test('the postseason column is the whole basketball postseason', () => {
        const a = grades.find(m => m.userId === 'a');
        expect(a.postPoints).toBe(Math.round(sum(mine('a'), p => p.postseason)));
        // Football's sum would be the conference title alone — far less.
        expect(a.postPoints).toBeGreaterThan(Math.round(sum(mine('a'), p => p.confChamp)) + 5);
        expect(a.projPoints).toBe(Math.round(sum(mine('a'), p => p.total)));
    });

    test('the make-the-field count is the NCAA bracket, never under a CFP label', () => {
        grades.forEach(g => {
            expect(g).not.toHaveProperty('cfpCount');
            expect(g.ncaaCount).toBe(Math.round(sum(mine(g.userId), p => p.makeProb) * 10) / 10);
            expect(g.ncaaCount).toBeGreaterThan(0);
        });
    });

    // The bands are the POOL's (top poolSize by preseason rank) — what could
    // be drafted. Teams below the pool exist only as opponents. Banded over
    // the whole country, the replacement anchor would sit among teams nobody
    // could draft. (It can only bite once the replacement rank, L·R, reaches
    // the end of the pool — 60 of 120 in the real league — hence a tiny pool.)
    test('the bands are the pool\'s, not the whole country\'s', () => {
        const { computeLeagueBands } = require('../modules/draft-projection');
        const deep = { ...draft, poolSize: 6 };            // L·R = 8 > the 6-team pool
        const letterOver = (ids) => {
            const totals = ids.map(id => proj[id].total).sort((x, y) => y - x);
            const b = computeLeagueBands(totals, 2, 4);
            const avg = sum(mine('b'), p => p.total) / 4;
            return letterFor(Math.max(0, Math.min(1, (avg - b.replacementAvg) / (b.eliteAvg - b.replacementAvg))));
        };
        const poolLetter = letterOver(byRank.slice(0, 6));
        // The fixture has to tell the two apart, or this proves nothing.
        expect(poolLetter).not.toBe(letterOver(byRank));
        const got = computeGrades(deep, usersById, teamsById, { games, config, sport: 'basketball' });
        expect(got.find(m => m.userId === 'b').grade).toBe(poolLetter);
    });

    test('a drafted team is graded even if the pool cap no longer covers it', () => {
        const capped = computeGrades({ ...draft, poolSize: 3 }, usersById, teamsById, { games, config, sport: 'basketball' });
        const a = capped.find(m => m.userId === 'a');
        expect(a.regPoints).toBe(Math.round(sum(mine('a'), p => p.regular)));
    });
});
