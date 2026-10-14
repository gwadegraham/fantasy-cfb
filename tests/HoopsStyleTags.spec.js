// Basketball style tags (#542): modules/hoops-style-tags.js, pure.
//
// What a manager reads off these is two words per team, so the tests pin the
// words: who gets which tag, which two win when more qualify, and that a
// missing number never reads as an extreme one.

const { tagTeams, slimRow, sharesFor, STYLE_SHARE, ELITE_RANK } = require('../modules/hoops-style-tags');

// A field of `n` plain teams: every metric dead average, no adjusted rank in
// the top 25. Overrides go on by team id.
function field(n = 100, over = {}) {
    const rows = [];
    for (let i = 1; i <= n; i++) {
        rows.push(Object.assign({
            teamId: i, games: 30, pace: 67, threeRate: 39, rimRate: 39, midRate: 21, threePct: 34,
            orbPct: 30, ftRate: 35, forcedTo: 0.17, offRank: 100 + i, defRank: 100 + i
        }, over[i] || {}));
    }
    return rows;
}

// Spread one metric evenly across the field: team i gets base + i * step.
function spread(rows, metric, base, step) {
    rows.forEach(r => { r[metric] = base + r.teamId * step; });
    return rows;
}

const labels = (tags, id) => (tags.get(id) || []).map(t => t.label);

describe('the percentile cut', () => {
    test('the top 15% on three-point rate is "3-point heavy"; the 16th of 100 is not', () => {
        const rows = spread(field(100), 'threeRate', 20, 0.3);   // team 100 shoots the most threes
        const tags = tagTeams(rows);
        expect(labels(tags, 100)).toContain('3-point heavy');
        expect(labels(tags, 86)).toContain('3-point heavy');    // 15th from the top
        expect(labels(tags, 85)).not.toContain('3-point heavy'); // 16th
        expect(STYLE_SHARE).toBe(0.15);
    });

    test('"Slow pace" is the BOTTOM of the field; the fastest are "Fast pace"', () => {
        const rows = spread(field(100), 'pace', 58, 0.15);
        const tags = tagTeams(rows);
        expect(labels(tags, 1)).toEqual(['Slow pace']);
        expect(labels(tags, 100)).toEqual(['Fast pace']);
        expect(labels(tags, 50)).toEqual([]);
    });

    test('an average team gets no tags at all', () => {
        const rows = spread(field(100), 'rimRate', 30, 0.2);
        expect(labels(tagTeams(rows), 50)).toEqual([]);
    });

    test('tied teams always get the same tag: both in, or both out', () => {
        const rows = spread(field(100), 'orbPct', 20, 0.1);
        const at = (id) => rows.find(r => r.teamId === id);
        // Level in 14th and 15th: the middle of the tie is 14.5, inside the cut.
        at(86).orbPct = at(87).orbPct;
        let tags = tagTeams(rows);
        expect(labels(tags, 87)).toContain('Crash the glass');
        expect(labels(tags, 86)).toContain('Crash the glass');
        // Level in 15th and 16th: the middle is 15.5, outside it.
        spread(rows, 'orbPct', 20, 0.1);
        at(85).orbPct = at(86).orbPct;
        tags = tagTeams(rows);
        expect(labels(tags, 86)).not.toContain('Crash the glass');
        expect(labels(tags, 85)).not.toContain('Crash the glass');
    });

    // The mid-rank is what stops this. Placing ties at their BEST place put
    // a whole block of tied teams at "top 1%".
    test('a metric every team ties on tags nobody', () => {
        const tags = tagTeams(field(100));
        expect([...tags.values()].every(t => t.length === 0)).toBe(true);
    });

    test('a team with no number is left out of the field, not ranked as an extreme', () => {
        const rows = spread(field(100), 'pace', 58, 0.15);
        rows[0].pace = null;                     // would otherwise be the slowest
        const tags = tagTeams(rows);
        expect(labels(tags, 1)).toEqual([]);
        // ...and the field is now 99, so its slowest 15% runs to team 15.
        expect(labels(tags, 2)).toEqual(['Slow pace']);
        expect(sharesFor(rows, 'pace', 'low').has(1)).toBe(false);
    });
});

describe('efficiency', () => {
    test(`a top-${ELITE_RANK} defense is "Elite defense"; #26 is not`, () => {
        const tags = tagTeams(field(100, { 1: { defRank: 25 }, 2: { defRank: 26 } }));
        expect(labels(tags, 1)).toEqual(['Elite defense']);
        expect(labels(tags, 2)).toEqual([]);
    });

    test('top 25 at BOTH ends is one tag, "Elite both ends", leaving room for a style', () => {
        // Duke 2025-26: #4 offense, #1 defense, and a lot of shots at the rim.
        const rows = spread(field(100, { 7: { offRank: 4, defRank: 1 } }), 'rimRate', 30, 0.1);
        rows.find(r => r.teamId === 7).rimRate = 99;
        const tags = tagTeams(rows);
        expect(labels(tags, 7)).toEqual(['Elite both ends', 'Rim attackers']);
        expect(tags.get(7)[0].detail).toBe('#4 adjusted offense, #1 adjusted defense');
    });

    test('a team with no adjusted ranks gets no efficiency tag', () => {
        const tags = tagTeams(field(100, { 1: { offRank: null, defRank: null } }));
        expect(labels(tags, 1)).toEqual([]);
    });
});

describe('at most two, the most extreme first', () => {
    test('of four qualifying tags, the two rarest are kept, rarest first', () => {
        // Team 100 tops three metrics; team 99 is second on each.
        let rows = field(100);
        ['threeRate', 'pace', 'ftRate', 'forcedTo'].forEach(m => spread(rows, m, 0, 1));
        // Team 100 tops pace and FT rate, but only 10th on threes and turnovers.
        const t = rows.find(r => r.teamId === 100);
        t.threeRate = 90.5; t.forcedTo = 90.5;
        const tags = tagTeams(rows);
        expect(labels(tags, 100)).toEqual(['Fast pace', 'Gets to the line']);
        expect(tags.get(100).map(x => x.share)).toEqual([0.01, 0.01]);
    });

    test('an elite rank outranks a style tag only when it is rarer', () => {
        // #20 defense of 100 is a 20% share — not elite-rare — while the
        // fastest pace in the field is 1%.
        const rows = spread(field(100, { 100: { defRank: 20 } }), 'pace', 50, 0.2);
        expect(labels(tagTeams(rows), 100)).toEqual(['Fast pace', 'Elite defense']);
    });

    test('the tooltip says where the team stands and quotes the number', () => {
        const rows = spread(field(100), 'pace', 58, 0.15);
        const fast = tagTeams(rows).get(100)[0];
        expect(fast).toMatchObject({ key: 'fast', label: 'Fast pace', detail: 'Top 1% in pace: 73.0 possessions a game' });
        const slow = tagTeams(rows).get(10)[0];
        expect(slow.detail).toBe('Bottom 10% in pace: 59.5 possessions a game');
    });
});

describe('every tag', () => {
    // One team at the top of every metric (and the bottom of pace), with no
    // cap, so each tag's wording is pinned once.
    test('says what it measures in plain words', () => {
        const rows = field(100, { 1: { threeRate: 50, rimRate: 50, pace: 60, orbPct: 40, forcedTo: 0.25,
            threePct: 40, midRate: 30, ftRate: 45, offRank: 3 } });
        const tags = tagTeams(rows, { maxTags: 99 }).get(1);
        expect(Object.fromEntries(tags.map(t => [t.label, t.detail]))).toEqual({
            'Elite offense': '#3 adjusted offense',
            '3-point heavy': 'Top 1% in three-point rate: 50.0% of shots are threes',
            'Rim attackers': 'Top 1% in shots at the rim: 50.0% of shots at the rim',
            'Slow pace': 'Bottom 1% in pace: 60.0 possessions a game',
            'Crash the glass': 'Top 1% in offensive rebounding: grab 40.0% of their misses',
            'Forces turnovers': 'Top 1% in turnovers forced: 25.0 turnovers per 100 opponent possessions',
            'Sharpshooters': 'Top 1% in three-point shooting: 40.0% from three',
            'Mid-range heavy': 'Top 1% in mid-range rate: 30.0% of shots from mid-range',
            'Gets to the line': 'Top 1% in free-throw rate: 45.0 free throws per 100 shots'
        });
    });
});

describe('slimRow', () => {
    // Trimmed from Duke's real 2025-26 leaderboard row.
    const duke = {
        season: 2026, teamId: 72, team: 'Duke',
        record: { games: 38, wins: 35, losses: 3 },
        summary: { pace: 66.5 },
        teamStats: { offensiveReboundPct: 30.8, freeThrowRate: 38.2 },
        opponentStats: { possessions: 2529, turnoverRatio: 0.17, turnovers: { total: 439 } },
        adjustedEfficiency: { rankings: { offense: 4, defense: 1, net: 2 } },
        shotProfile: {
            atRim: { rate: 44.9 },
            threePointJumper: { rate: 43.5, pct: 34.7 },
            distribution: { midrangeRate: 11.6, threeRate: 43.5 }
        }
    };

    test('keeps only the numbers a tag reads', () => {
        expect(slimRow(duke)).toEqual({
            teamId: 72, school: 'Duke', games: 38, wins: 35, losses: 3, pace: 66.5,
            threeRate: 43.5, rimRate: 44.9, midRate: 11.6, threePct: 34.7, orbPct: 30.8, ftRate: 38.2,
            forcedTo: 439 / 2529, offRank: 4, defRank: 1
        });
    });

    // CBBD rounds turnoverRatio to two places, which tied a third of the
    // 2025-26 field and put 95 teams in a "top 15%".
    test('forced turnovers come from the counts, not the rounded ratio', () => {
        expect(slimRow(duke).forcedTo).not.toBe(0.17);
        const noCounts = { ...duke, opponentStats: { turnoverRatio: 0.17 } };
        expect(slimRow(noCounts).forcedTo).toBe(0.17);
    });

    test('a missing number is null, never 0', () => {
        const r = slimRow({ teamId: 1 });
        expect(r.pace).toBeNull();
        expect(r.offRank).toBeNull();
    });

    test('no team id, no row', () => {
        expect(slimRow({ team: 'X' })).toBeNull();
        expect(slimRow(null)).toBeNull();
    });
});
