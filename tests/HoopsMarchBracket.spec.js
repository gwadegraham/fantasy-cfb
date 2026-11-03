// The bracket layout (modules/hoops-march-bracket.js), pure: slots by seed,
// placeholders from feeder games, the Opening Round split, the Final Four
// pairing and the key dates. The points are proved against the real scoring
// pass in HoopsBracket.spec.js.

const { buildBracket, keyDates, regionOf, openingKind, payTable } = require('../modules/hoops-march-bracket');
const { resolveConfig } = require('../modules/scoring-defaults');

const cfg = resolveConfig(null, { model: 'hoops' });
let gid = 0;
function g(round, region, home, away, { status = 'final', hp = 70, ap = 60, season = 2027, start = '2027-03-19T18:00:00Z' } = {}) {
    gid += 1;
    return {
        id: gid, season, seasonType: 'postseason', tournament: 'NCAA', startDate: start, status,
        gameNotes: `NCAA Men's Basketball Championship - ${region ? region + ' Region - ' : ''}${round}`,
        homeTeamId: home[0], homeSeed: home[1], homeTeam: `T${home[0]}`,
        awayTeamId: away[0], awaySeed: away[1], awayTeam: `T${away[0]}`,
        ...(status === 'final' ? { homePoints: hp, awayPoints: ap } : {})
    };
}
const build = (games, extra = {}) => buildBracket(Object.assign({ season: 2027, games, cfg, nowMs: Date.parse('2027-03-20T00:00:00Z') }, extra));

beforeEach(() => { gid = 0; });

test('no NCAA rows is the before-Selection-Sunday state, with the pay table', () => {
    const b = build([{ ...g('1st Round', 'South', [1, 1], [2, 16]), tournament: 'NIT' }]);
    expect(b.state).toBe('pre');
    expect(b.pay.rungs.map(r => r.points)).toEqual([0, 7, 9, 12, 16, 21, 26, 35]);
    expect(b.pay.upsetPerSeed).toBe(1);
});

test('a rule the league switched off pays 0 in the table', () => {
    const off = resolveConfig(null, { model: 'hoops', disabled: ['ncaaChampion'] });
    expect(payTable(off, 2027).rungs.find(r => r.key === 'champ').points).toBe(0);
});

test('the key dates follow the first-Saturday-of-April rule', () => {
    expect(keyDates(2026)).toMatchObject({ selection: '2026-03-15', finalFour: '2026-04-04', title: '2026-04-06' });
    expect(keyDates(2027)).toMatchObject({ selection: '2027-03-14', finalFour: '2027-04-03', title: '2027-04-05' });
    expect(keyDates(2025).selection).toBe('2025-03-16');
    expect(keyDates(2024).selection).toBe('2024-03-17');
});

test('region and play-in kind', () => {
    expect(regionOf({ gameNotes: "NCAA Men's Basketball Championship - Midwest Region - First Four" })).toBe('Midwest');
    expect(regionOf({ gameNotes: "NCAA Men's Basketball Championship - Final Four" })).toBeNull();
    expect([16, 15, 13, 12, 11].map(openingKind)).toEqual(['aq', 'aq', 'aq', 'al', 'al']);
});

test('Opening Round games split into auto-bids and at-large, and feed their Round-of-64 slot', () => {
    const games = [
        g('Opening Round', 'South', [101, 16], [102, 16], { status: 'scheduled' }),
        g('Opening Round', 'South', [111, 11], [112, 11], { hp: 60, ap: 70 }),
        g('1st Round', 'South', [1, 1], [3, 16], { status: 'scheduled' })
    ];
    const b = build(games);
    expect(b.openingLabel).toBe('Opening Round');
    expect(b.opening.map(o => [o.kind, o.seedLine])).toEqual([['aq', 16], ['al', 11]]);
    const south = b.regions.South;
    // The 1 v 16 slot has a row with the 1 seed in it.
    expect(south.r64[0].b.id).toBe(1);
    // 6 v 11: no row yet. The 11 side is the play-in winner (away, 112).
    expect(south.r64[4].id).toBeNull();
    expect(south.r64[4].b).toEqual({ id: 112, seed: 11, score: null });
    // An unplayed play-in feeds both names.
    const sixteen = build([games[0]]).regions.South.r64[0];
    expect(sixteen.b).toEqual({ tbd: [102, 101], seed: 16 });
    expect(sixteen.a).toBeNull();
});

test('before 2027 the play-in is the First Four', () => {
    expect(build([g('First Four', 'East', [1, 16], [2, 16], { season: 2026 })], { season: 2026 }).openingLabel).toBe('First Four');
});

test('a live game is live, with its clock, and a pre game has no score', () => {
    const live = { ...g('1st Round', 'West', [1, 1], [2, 16], { status: 'scheduled' }), status: 'in_progress', period: 2, clock: '8:12', homePoints: 50, awayPoints: 40 };
    const pre = g('1st Round', 'West', [3, 8], [4, 9], { status: 'scheduled' });
    const b = build([live, pre]);
    expect(b.regions.West.r64[0]).toMatchObject({ state: 'live', clock: '2nd 8:12', winner: null });
    expect(b.regions.West.r64[0].b.score).toBe(50);
    expect(b.regions.West.r64[1].a.score).toBeNull();
});

test('the Final Four keeps the pairing the rows give, and the champion comes from the title game', () => {
    const regions = ['East', 'South', 'West', 'Midwest'];
    const games = regions.map((r, i) => g('Elite 8', r, [10 + i, 1], [20 + i, 2]));
    games.push(g('Final Four', null, [10, 1], [11, 1]));   // East v South
    games.push(g('Final Four', null, [12, 1], [13, 1], { hp: 50, ap: 60 }));   // West v Midwest
    games.push(g('National Championship', null, [10, 1], [13, 1], { hp: 80, ap: 70 }));
    const b = build(games);
    expect(b.regionOrder).toEqual(['South', 'East', 'Midwest', 'West']);
    expect(b.finalFour.map(f => f.label)).toEqual(['South v East', 'Midwest v West']);
    expect(b.champion).toBe(10);
    expect(b.teams[13].alive).toBe(false);
});

test('before the Final Four rows exist, its slots fill from the regional winners', () => {
    const games = ['South', 'West', 'Midwest', 'East'].map((r, i) => g('Elite 8', r, [10 + i, 1], [20 + i, 2], { status: i < 2 ? 'final' : 'scheduled' }));
    const b = build(games);
    expect(b.finalFour[0].label).toBe('South v West');
    expect(b.finalFour[0].a).toEqual({ id: 10, seed: 1, score: null });
    // A pending 1-v-2: no single seed beside both names.
    expect(b.finalFour[1].a).toEqual({ tbd: [22, 12], seed: null });
    // Both semifinalists known, neither game played: the title slot names them.
    expect(b.title.a).toEqual({ tbd: [10, 11], seed: 1 });
    expect(b.title.b).toBeNull();
    expect(b.champion).toBeNull();
});

test('owners are marked, and only the viewer is "me"', () => {
    const games = [g('1st Round', 'East', [1, 1], [2, 16])];
    const owners = { 1: { userId: 'acc-a', initials: 'AA' }, 2: { userId: 'acc-b', initials: 'BB' } };
    const b = build(games, { owners, viewerId: 'acc-a' });
    expect(b.teams[1].owner.isMe).toBe(true);
    expect(b.teams[2].owner.isMe).toBe(false);
    // Nothing banked yet: the owned team shows 0 and the game says so.
    expect(b.teams[1].points).toBe(0);
    expect(b.teams[1].games[0].banked).toBeNull();
    expect(b.teams[1].games[0].rulesTotal).toBe(7);
});

test('a row with one side unknown is TBD on that side, not a phantom team 0', () => {
    const later = { ...g('2nd Round', 'East', [1, 1], [null, null], { status: 'scheduled' }), awayTeamId: null, awayTeam: null, awaySeed: null };
    const b = build([g('1st Round', 'East', [1, 1], [16, 16]), later]);
    expect(b.teams).not.toHaveProperty('0');
    expect(Object.keys(b.teams).sort()).toEqual(['1', '16']);
    expect(b.regions.East.r32[0].a).toBeNull();
    expect(b.regions.East.r32[0].b.id).toBe(1);
});

test('a game with no seeds on either side is left out of the region, without throwing', () => {
    const noSeeds = { ...g('1st Round', 'East', [1, null], [2, null]), homeSeed: null, awaySeed: null };
    const b = build([noSeeds, g('1st Round', 'East', [3, 1], [4, 16])]);
    expect(b.regions.East.r64.filter(x => x.id != null).map(x => x.id)).toEqual([2]);
});

test("a rescheduled game's stale listing does not take its slot", () => {
    const stale = g('1st Round', 'East', [1, 1], [16, 16], { status: 'scheduled', start: '2027-03-18T18:00:00Z' });
    const real = g('1st Round', 'East', [1, 1], [16, 16], { start: '2027-03-19T18:00:00Z' });
    // Inside the grace week the stale copy is still listed, but the final wins the slot…
    expect(buildBracket({ season: 2027, games: [stale, real], cfg, nowMs: Date.parse('2027-03-20T00:00:00Z') }).regions.East.r64[0].id).toBe(real.id);
    // …and past it, dropStale removes the copy altogether.
    const later = buildBracket({ season: 2027, games: [stale, real], cfg, nowMs: Date.parse('2027-04-10T00:00:00Z') });
    expect(later.regions.East.r64[0].id).toBe(real.id);
    expect(Object.keys(later.teams)).toHaveLength(2);
});
