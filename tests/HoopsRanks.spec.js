// What a team was RANKED when a game was played (#316).
//
// Everything in the basketball model rests on this: the quadrant bands are
// rank thresholds, and scores are banked at TIME OF PLAY, so a rank that is
// wrong on the night is wrong forever.
//
// The blend RAMP is provisional — the real curve is a November measurement
// (#318). So these tests pin the PROPERTIES the ramp must have, not the
// numbers it currently produces: a test that asserts 0.67 in week 4 would
// have to be rewritten by the person doing the measuring, and would tell
// them nothing about what they are allowed to change.

const { useMongo } = require('./helpers/mongo');
const {
    ranksFor, blendRanks, blendWeight, preseasonRanks, liveRanks,
    FULLY_PRESEASON, FULLY_LIVE
} = require('../modules/hoops-ranks');
const HoopsRating = require('../models/hoopsRating');
const HoopsTeam = require('../models/hoopsTeam');

const SEASON = 2027;

describe('the blend ramp', () => {
    test('starts fully on the preseason number', () => {
        expect(blendWeight(0)).toBe(1);
        expect(blendWeight(1)).toBe(1);
        expect(blendWeight(FULLY_PRESEASON)).toBe(1);
    });

    test('ends fully on the live number, and stays there', () => {
        expect(blendWeight(FULLY_LIVE)).toBe(0);
        expect(blendWeight(FULLY_LIVE + 1)).toBe(0);
        expect(blendWeight(40)).toBe(0);
    });

    test('never leaves 0..1, and never goes back up', () => {
        // The two properties that make it a handover rather than a wobble.
        let last = 1;
        for (let w = 0; w <= 40; w++) {
            const v = blendWeight(w);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
            expect(v).toBeLessThanOrEqual(last);
            last = v;
        }
    });

    test('actually hands over, rather than cutting over on one week', () => {
        // A hard cutover moves every team's rank on one arbitrary week. The
        // point of the ramp is that no single week does all the moving.
        const partial = [];
        for (let w = 0; w <= 40; w++) {
            const v = blendWeight(w);
            if (v > 0 && v < 1) partial.push(w);
        }
        expect(partial.length).toBeGreaterThanOrEqual(3);
    });

    test('a junk week is treated as preseason', () => {
        // The safest end: the preseason number is the one we are sure of.
        for (const w of [undefined, null, NaN, 'x', -5]) expect(blendWeight(w)).toBe(1);
    });
});

describe('blending two rankings', () => {
    // Averaging two ranks gives a SCORE, not a ranking — ties and fractions,
    // where the quadrant bands are integer thresholds over a dense field.
    const pre = { 1: 1, 2: 2, 3: 3 };
    const live = { 1: 3, 2: 1, 3: 2 };

    test('weight 1 is the preseason ranking exactly', () => {
        expect(blendRanks(pre, live, 1)).toEqual({ 1: 1, 2: 2, 3: 3 });
    });

    test('weight 0 is the live ranking exactly', () => {
        expect(blendRanks(pre, live, 0)).toEqual({ 1: 3, 2: 1, 3: 2 });
    });

    test('in between, it re-ranks on the blended score', () => {
        // team2 blends to 1.5, team1 to 2.0, team3 to 2.5.
        expect(blendRanks(pre, live, 0.5)).toEqual({ 2: 1, 1: 2, 3: 3 });
    });

    test('the output is always a dense 1..N with no ties or gaps', () => {
        // Because the bands are thresholds: a gap shifts every team below it
        // into a worse quadrant.
        for (const w of [0, 0.25, 0.5, 0.75, 1]) {
            const out = blendRanks({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, { 1: 5, 2: 1, 3: 4, 4: 2, 5: 3 }, w);
            const ranks = Object.values(out).sort((a, b) => a - b);
            expect(ranks).toEqual([1, 2, 3, 4, 5]);
        }
    });

    test('a team only one source knows keeps its own rank as its score', () => {
        // A team CBBD has not rated yet should slide, not vanish into Q4 —
        // and not be PROMOTED either. Asserting only that the keys survive
        // missed the version that scored a one-sided team as w*rank, which
        // halves it and jumps the team up the field.
        const out = blendRanks({ 1: 1, 9: 2 }, { 1: 2, 7: 1 }, 0.5);
        // team1 blends to 1.5; team9 keeps 2; team7 keeps 1.
        expect(out).toEqual({ 7: 1, 1: 2, 9: 3 });
    });

    test('two teams on the same score rank by id, every time', () => {
        // A quadrant boundary can fall between them, so the order has to be
        // stable across runs rather than left to the sort.
        //
        // Note this cannot be falsified by removing the id tie-break: JS
        // iterates integer-like object keys in ascending numeric order, so
        // the array reaching sort() is already id-ordered and the stable
        // sort keeps it. The comparator is belt and braces for the day ids
        // are not integers; the PROPERTY is what is pinned here.
        const a = blendRanks({ 5: 1, 3: 1 }, { 5: 1, 3: 1 }, 0.5);
        const b = blendRanks({ 3: 1, 5: 1 }, { 3: 1, 5: 1 }, 0.5);
        expect(a).toEqual(b);
        expect(a).toEqual({ 3: 1, 5: 2 });
    });

    test('a team both sources list as junk is left out entirely', () => {
        // Not ranked last — left out. quadrantFor reads an absent rank as
        // Q4 anyway, and inventing a rank for a team nobody rated would put
        // a real team behind it.
        // Number(null) and Number('') are both 0, which is finite — so the
        // obvious check read a missing rank as rank ZERO, which sorts
        // FIRST. A team nobody had rated came out of the blend as the best
        // team in the country, and every win over it as a Q1.
        const out = blendRanks({ 1: 1, 2: null, 3: 'x', 4: '' }, { 1: 2, 2: undefined, 3: NaN, 4: 0 }, 0.5);
        expect(Object.keys(out)).toEqual(['1']);
    });

    test('empty inputs give an empty ranking rather than throwing', () => {
        expect(blendRanks({}, {}, 0.5)).toEqual({});
        expect(blendRanks(null, null, 0.5)).toEqual({});
    });

    test('one side missing entirely is the other side’s ranking', () => {
        // Not the same as the empty case: here the loop actually runs with a
        // null on one side, which is the shape a season with no Torvik paste
        // (or no refresh yet) produces.
        expect(blendRanks(null, { 1: 2, 2: 1 }, 0.5)).toEqual({ 2: 1, 1: 2 });
        expect(blendRanks({ 1: 2, 2: 1 }, null, 0.5)).toEqual({ 2: 1, 1: 2 });
        expect(blendRanks(undefined, { 7: 1 }, 1)).toEqual({ 7: 1 });
    });

    test('a weight outside 0..1 is clamped', () => {
        // Needs inputs where EXTRAPOLATION actually reorders. Above a weight
        // of 1 the live rank carries a negative coefficient, so a team the
        // live number hates gets pushed to the FRONT. With the first fixture
        // the flip happened to preserve the order and this test could not
        // fail either way.
        const a = { 1: 1, 2: 2 };
        const b = { 1: 1, 2: 100 };
        expect(blendRanks(a, b, 5)).toEqual({ 1: 1, 2: 2 });
        expect(blendRanks(a, b, 5)).toEqual(blendRanks(a, b, 1));
        expect(blendRanks(a, b, -5)).toEqual(blendRanks(a, b, 0));
    });
});

describe('reading the ranking for a week', () => {
    useMongo();

    const team = (id, rank) => ({
        id, season: SEASON, school: `T${id}`,
        preseason: { rank, source: 'torvik-test' }
    });
    const rating = (teamId, week, rank) => ({
        season: SEASON, week, teamId, rank, source: 'cbbd-adjusted'
    });

    test('with nothing stored, it is Torvik all the way', async () => {
        await HoopsTeam.create([team(1, 1), team(2, 2), team(3, 3)]);
        const out = await ranksFor(SEASON, 1);
        expect(out.source).toBe('torvik');
        expect(out.ranks).toEqual({ 1: 1, 2: 2, 3: 3 });
    });

    test('a team with no preseason rank is simply absent', async () => {
        // Absent, not rank 0 — quadrantFor reads an unusable rank as Q4,
        // which is the right answer for a team nobody has rated.
        await HoopsTeam.create([team(1, 1), { id: 2, season: SEASON, school: 'T2' }]);
        expect(await preseasonRanks(SEASON)).toEqual({ 1: 1 });
    });

    test('once the live rows are in and the ramp is done, it is CBBD', async () => {
        await HoopsTeam.create([team(1, 1), team(2, 2)]);
        await HoopsRating.create([rating(1, FULLY_LIVE, 2), rating(2, FULLY_LIVE, 1)]);
        const out = await ranksFor(SEASON, FULLY_LIVE);
        expect(out.source).toBe('cbbd-adjusted');
        expect(out.ranks).toEqual({ 1: 2, 2: 1 });
    });

    test('and in between it says so', async () => {
        await HoopsTeam.create([team(1, 1), team(2, 2), team(3, 3)]);
        const mid = Math.floor((FULLY_PRESEASON + FULLY_LIVE) / 2);
        await HoopsRating.create([rating(1, mid, 3), rating(2, mid, 1), rating(3, mid, 2)]);
        const out = await ranksFor(SEASON, mid);
        expect(out.source).toBe('blended');
        expect(out.blendWeight).toBeGreaterThan(0);
        expect(out.blendWeight).toBeLessThan(1);
        expect(Object.values(out.ranks).sort()).toEqual([1, 2, 3]);
    });

    test('live rows that arrive before the ramp starts are ignored', async () => {
        // CBBD rates teams from day one, but two games in it is noise. Until
        // the ramp opens, the preseason number is the answer even though a
        // live one exists.
        await HoopsTeam.create([team(1, 1), team(2, 2)]);
        await HoopsRating.create([rating(1, FULLY_PRESEASON, 2), rating(2, FULLY_PRESEASON, 1)]);
        const out = await ranksFor(SEASON, FULLY_PRESEASON);
        expect(out.source).toBe('torvik');
        expect(out.ranks).toEqual({ 1: 1, 2: 2 });
    });

    test('a MISSED refresh falls back to the last week that has one', async () => {
        // The refresh runs weekly. A missed run must not drop every team to
        // Q4 for a whole week of games — last week's ranking is wrong by a
        // little, no ranking is wrong by everything.
        await HoopsTeam.create([team(1, 1), team(2, 2)]);
        await HoopsRating.create([rating(1, FULLY_LIVE, 2), rating(2, FULLY_LIVE, 1)]);
        const out = await ranksFor(SEASON, FULLY_LIVE + 3);
        expect(out.ranks).toEqual({ 1: 2, 2: 1 });
        // And it reports the staleness rather than hiding it.
        expect(out.staleWeek).toBe(FULLY_LIVE);
    });

    test('the fallback takes the LATEST earlier week, not the first', async () => {
        await HoopsTeam.create([team(1, 1), team(2, 2)]);
        await HoopsRating.create([
            rating(1, FULLY_LIVE, 1), rating(2, FULLY_LIVE, 2),
            rating(1, FULLY_LIVE + 1, 2), rating(2, FULLY_LIVE + 1, 1)
        ]);
        const out = await ranksFor(SEASON, FULLY_LIVE + 5);
        expect(out.ranks).toEqual({ 1: 2, 2: 1 });
        expect(out.staleWeek).toBe(FULLY_LIVE + 1);
    });

    test('a fresh week is not reported as stale', async () => {
        await HoopsTeam.create([team(1, 1)]);
        await HoopsRating.create([rating(1, FULLY_LIVE, 1)]);
        expect((await ranksFor(SEASON, FULLY_LIVE)).staleWeek).toBeNull();
    });

    test('ratings from ANOTHER season are never read', async () => {
        await HoopsTeam.create([team(1, 1), team(2, 2)]);
        await HoopsRating.create([
            { season: SEASON - 1, week: FULLY_LIVE, teamId: 1, rank: 99, source: 'cbbd-adjusted' }
        ]);
        const out = await ranksFor(SEASON, FULLY_LIVE);
        expect(out.source).toBe('torvik');
        expect(out.ranks).toEqual({ 1: 1, 2: 2 });
    });

    test('live rows with no preseason at all still rank', async () => {
        // A season whose Torvik paste never happened.
        await HoopsRating.create([rating(1, 3, 1), rating(2, 3, 2)]);
        const out = await ranksFor(SEASON, 3);
        expect(out.source).toBe('cbbd-adjusted');
        expect(out.ranks).toEqual({ 1: 1, 2: 2 });
    });

    test('live-only AND stale still reports which week it used', async () => {
        // No Torvik paste that season, and a missed refresh on top.
        await HoopsRating.create([rating(1, 3, 1), rating(2, 3, 2)]);
        const out = await ranksFor(SEASON, 6);
        expect(out.source).toBe('cbbd-adjusted');
        expect(out.staleWeek).toBe(3);
    });

    test('blended AND stale reports it too', async () => {
        // The combination that actually happens: the ramp is still running
        // when a weekly refresh is missed.
        await HoopsTeam.create([team(1, 1), team(2, 2), team(3, 3)]);
        const mid = Math.floor((FULLY_PRESEASON + FULLY_LIVE) / 2);
        await HoopsRating.create([
            rating(1, mid - 1, 3), rating(2, mid - 1, 1), rating(3, mid - 1, 2)
        ]);
        const out = await ranksFor(SEASON, mid);
        expect(out.source).toBe('blended');
        expect(out.staleWeek).toBe(mid - 1);
    });

    test('and nothing anywhere is an empty ranking, not a crash', async () => {
        const out = await ranksFor(SEASON, 5);
        expect(out.ranks).toEqual({});
        expect(out.source).toBe('torvik');
    });

    test('liveRanks reports the week it actually used', async () => {
        await HoopsRating.create([rating(1, 4, 1)]);
        expect(await liveRanks(SEASON, 4)).toMatchObject({ week: 4, stale: false });
        expect(await liveRanks(SEASON, 6)).toMatchObject({ week: 4, stale: true });
        expect(await liveRanks(SEASON, 2)).toMatchObject({ week: null });
    });
});

describe('the ranking feeds quadrants end to end', () => {
    useMongo();
    const { quadrantFor } = require('../modules/hoops-quadrants');

    test('a preseason #20 is a home Q1, a preseason #200 is a home Q4', async () => {
        await HoopsTeam.create([
            { id: 1, season: SEASON, school: 'Good', preseason: { rank: 20 } },
            { id: 2, season: SEASON, school: 'Bad', preseason: { rank: 200 } }
        ]);
        const { ranks } = await ranksFor(SEASON, 1);
        expect(quadrantFor(ranks['1'], 'home')).toBe(1);
        expect(quadrantFor(ranks['2'], 'home')).toBe(4);
    });
});
