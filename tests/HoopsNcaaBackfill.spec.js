// Past NCAA tournaments into hoopsgames: modules/hoops-ncaa-backfill.js.
//
// What it must get right: past seasons only, one call per season and none for
// a season already stored, nothing written when the response is not a
// finished NCAA tournament, and rows written through the season ingest's own
// upsert (points kept, seeds kept, keyed on CBBD's id).
//
// cbbd.cbbdGet is always spied — jest loads the real .env, so an unstubbed
// call would hit CBBD and bill the shared pool.

const { useMongo } = require('./helpers/mongo');
const backfill = require('../modules/hoops-ncaa-backfill');
const cbbd = require('../modules/cbbd-client');
const HoopsGame = require('../models/hoopsGame');
const HoopsTeam = require('../models/hoopsTeam');
const SportSeason = require('../models/sportSeason');
const seasons = require('../modules/active-season');

useMongo();

const ACTIVE = 2027;
const game = (id, season, o = {}) => Object.assign({
    id, season, seasonLabel: `${season - 1}${season}`, seasonType: 'postseason', tournament: 'NCAA',
    startDate: `${season}-03-${String(17 + (id % 10)).padStart(2, '0')}T23:00:00.000Z`, startTimeTbd: false,
    status: 'final', neutralSite: true, homeTeamId: 1000 + id, homeTeam: `H${id}`, homeSeed: 1,
    awayTeamId: 2000 + id, awayTeam: `A${id}`, awaySeed: 16, homePoints: 80, awayPoints: 60,
    homeWinner: true, awayWinner: false, gameNotes: "Men's Basketball Championship - South Region - 1st Round"
}, o);
const tournament = (season, n = backfill.FULL_TOURNAMENT, base = season * 1000) =>
    Array.from({ length: n }, (_, i) => game(base + i, season));

// A season's D-I teams in CBBD's /teams shape.
const teamList = (n = backfill.FULL_TEAMS) => Array.from({ length: n }, (_, i) => ({
    id: i + 1, school: `School ${i + 1}`, abbreviation: `S${i + 1}`, primaryColor: '9d2235', secondaryColor: 'ffffff',
    conference: 'SEC', logos: [`https://cdn.example/${i + 1}.png`, `https://cdn.example/dark/${i + 1}.png`]
}));

// A season's regular-season schedule, in /games shape: n final games from
// mid-November, two a day.
const REGULAR = 6;
const schedule = (season, n = REGULAR, o = {}) => Array.from({ length: n }, (_, i) => game(season * 10000 + i, season, Object.assign({
    seasonType: 'regular', tournament: null, gameNotes: null, neutralSite: false,
    startDate: new Date(Date.UTC(season - 1, 10, 10 + Math.floor(i / 2))).toISOString()
}, o)));

// Games through cbbdGet (the tournament) and fetchGamesInRange (the full
// schedule), teams through fetchTeams; the logo probe is a CDN request,
// stubbed to "every logo loads".
function stubCbbd(bySeason, teamsBySeason = {}, schedules = {}) {
    jest.spyOn(cbbd, 'fetchGamesInRange').mockImplementation(async (season, seasonType) => {
        const s = schedules[season];
        if (s instanceof Error) throw s;
        const games = seasonType === 'regular' ? (s && s.regular) || schedule(season) : (s && s.postseason) || [];
        return { games, windows: seasonType === 'regular' ? 8 : 3, remainingCalls: 29680, capHits: (s && s.capHits && s.capHits[seasonType]) || [] };
    });
    jest.spyOn(cbbd, 'fetchTeams').mockImplementation(async (season) => {
        const data = teamsBySeason[season];
        if (data instanceof Error) throw data;
        return { data: data || teamList(), remainingCalls: 29690 };
    });
    jest.spyOn(cbbd, 'logoUrlsThatExist').mockImplementation(async (urls) => new Set(urls));
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path, params) => {
        const data = bySeason[params.season];
        if (data instanceof Error) throw data;
        return { data: data || [], remainingCalls: 29700 };
    });
}

const fullRegular = backfill.LIMITS.regular;
beforeEach(async () => {
    backfill.LIMITS.regular = REGULAR;
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: ACTIVE, status: 'in-season' }]);
    await seasons.prime();
});

afterEach(() => { backfill.LIMITS.regular = fullRegular; jest.restoreAllMocks(); });

describe('lastSeasons', () => {
    it('is the n seasons before the active one, oldest first', () => {
        expect(backfill.lastSeasons(3)).toEqual([2024, 2025, 2026]);
    });
});

describe('backfill', () => {
    it('stores each season with one call apiece, asking CBBD for the NCAA postseason only', async () => {
        const spy = stubCbbd({ 2025: tournament(2025), 2026: tournament(2026) });
        const out = await backfill.backfill([2026, 2025]);

        expect(out.map(r => [r.season, r.status, r.written])).toEqual([[2025, 'written', 67], [2026, 'written', 67]]);
        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy).toHaveBeenCalledWith('/games', { season: 2025, seasonType: 'postseason', tournament: 'NCAA' });
        expect(await HoopsGame.distinct('season', { tournament: 'NCAA' })).toEqual([2025, 2026]);
    });

    it('writes through the season upsert: points, seeds and a week, keyed on the CBBD id', async () => {
        stubCbbd({ 2026: tournament(2026) });
        await backfill.backfill([2026]);
        const row = await HoopsGame.findOne({ id: 2026000 }).lean();
        expect(row).toMatchObject({ season: 2026, tournament: 'NCAA', status: 'final', homePoints: 80, awayPoints: 60, homeSeed: 1, awaySeed: 16 });
        expect(row.week).toBeGreaterThanOrEqual(1);
    });

    it('spends nothing on a season already stored in full, and re-fetches it on force', async () => {
        const spy = stubCbbd({ 2026: tournament(2026) });
        await backfill.backfill([2026]);
        const again = await backfill.backfill([2026]);
        expect(again[0]).toMatchObject({ status: 'stored', calls: 0, stored: 67 });
        expect(spy).toHaveBeenCalledTimes(1);

        const forced = await backfill.backfill([2026], { force: true });
        expect(forced[0].status).toBe('written');
        expect(spy).toHaveBeenCalledTimes(2);
        expect(await HoopsGame.countDocuments({ season: 2026, tournament: 'NCAA' })).toBe(67);
    });

    it('re-fetches a season stored only in part', async () => {
        await HoopsGame.create(tournament(2026, 10).map(g => Object.assign({}, g, { startDate: new Date(g.startDate) })));
        const spy = stubCbbd({ 2026: tournament(2026) });
        const out = await backfill.backfill([2026]);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(out[0]).toMatchObject({ status: 'written', stored: 10 });
        expect(await HoopsGame.countDocuments({ season: 2026, tournament: 'NCAA' })).toBe(67);
    });

    it('fetches but writes nothing on a dry run', async () => {
        stubCbbd({ 2026: tournament(2026) });
        const out = await backfill.backfill([2026], { dryRun: true });
        expect(out[0]).toMatchObject({ status: 'dry-run', fetched: 67, written: 0, calls: 1 });
        expect(await HoopsGame.countDocuments({})).toBe(0);
    });

    it('refuses the active season and later ones before spending a call', async () => {
        const spy = stubCbbd({});
        await expect(backfill.backfill([2026, ACTIVE])).rejects.toThrow(/Past seasons only/);
        await expect(backfill.backfill([2028])).rejects.toThrow(/2028/);
        await expect(backfill.backfill([NaN])).rejects.toThrow(/Past seasons only/);
        expect(spy).not.toHaveBeenCalled();
    });

    it('refuses to run without an active basketball season', async () => {
        await SportSeason.deleteMany({ sport: 'basketball' });
        await seasons.prime();
        jest.spyOn(seasons, 'activeSeason').mockReturnValue(null);
        await expect(backfill.backfill([2026])).rejects.toThrow(/No active basketball season/);
        expect(() => backfill.lastSeasons(3)).toThrow(/No active basketball season/);
    });

    it('backfillSeason runs on its own with default options', async () => {
        stubCbbd({ 2026: tournament(2026) });
        expect((await backfill.backfillSeason(2026)).status).toBe('written');
    });

    it.each([
        ['an empty response', [], /no NCAA tournament games/],
        ['rows from another tournament', [game(1, 2026), game(2, 2026, { tournament: 'NIT' })], /non-NCAA rows/],
        ['rows from another season', [game(1, 2026), game(2, 2025)], /another season/],
        ['a tournament still being played', [game(1, 2026), game(2, 2026, { status: 'scheduled' })], /not final/],
        ['a response at the page cap', null, /page cap/]
    ])('writes nothing for %s', async (_label, data, message) => {
        stubCbbd({ 2026: data || tournament(2026, cbbd.PAGE_CAP) });
        await expect(backfill.backfill([2026])).rejects.toThrow(message);
        expect(await HoopsGame.countDocuments({})).toBe(0);
    });

    it('stops at the first failing season, keeping the ones before it', async () => {
        stubCbbd({ 2024: tournament(2024), 2025: new Error('CBBD /games 500'), 2026: tournament(2026) });
        await expect(backfill.backfill([2024, 2025, 2026])).rejects.toThrow(/500/);
        expect(await HoopsGame.distinct('season')).toEqual([2024]);
    });

    it('stores each season\'s teams beside its tournament, logos and colours included, without touching the active season', async () => {
        await HoopsTeam.create({ id: 1, season: ACTIVE, school: 'School 1 today', logos: ['https://cdn.example/now.png'] });
        stubCbbd({ 2026: tournament(2026) });
        const [out] = await backfill.backfill([2026]);
        expect(out.teams).toMatchObject({ status: 'written', fetched: backfill.FULL_TEAMS, calls: 1 });
        expect(cbbd.fetchTeams).toHaveBeenCalledWith(2026);
        const past = await HoopsTeam.findOne({ id: 1, season: 2026 }).lean();
        expect(past).toMatchObject({ school: 'School 1', color: '#9d2235', logos: ['https://cdn.example/1.png', 'https://cdn.example/dark/1.png'] });
        expect(await HoopsTeam.findOne({ id: 1, season: ACTIVE }).lean()).toMatchObject({ school: 'School 1 today', logos: ['https://cdn.example/now.png'] });
    });

    it('spends nothing on a season whose teams are stored, and re-fetches them on force', async () => {
        stubCbbd({ 2026: tournament(2026) });
        await backfill.backfill([2026]);
        const [again] = await backfill.backfill([2026]);
        expect(again.teams).toMatchObject({ status: 'stored', calls: 0, stored: backfill.FULL_TEAMS });
        expect(cbbd.fetchTeams).toHaveBeenCalledTimes(1);
        await backfill.backfill([2026], { force: true });
        expect(cbbd.fetchTeams).toHaveBeenCalledTimes(2);
    });

    it('fetches teams but writes none on a dry run', async () => {
        stubCbbd({ 2026: tournament(2026) });
        const [out] = await backfill.backfill([2026], { dryRun: true });
        expect(out.teams).toMatchObject({ status: 'dry-run', written: 0, calls: 1 });
        expect(await HoopsTeam.countDocuments({})).toBe(0);
    });

    it('writes no teams from a short list', async () => {
        stubCbbd({ 2026: tournament(2026) }, { 2026: teamList(40) });
        await expect(backfill.backfill([2026])).rejects.toThrow(/40 teams/);
        expect(await HoopsTeam.countDocuments({})).toBe(0);
    });

    it('a failed logo probe stores the teams without logos rather than broken ones', async () => {
        stubCbbd({ 2026: tournament(2026) });
        cbbd.logoUrlsThatExist.mockRejectedValue(new Error('CDN down'));
        await backfill.backfill([2026]);
        expect((await HoopsTeam.findOne({ id: 1, season: 2026 }).lean()).logos).toEqual([]);
    });

    it('a failed team write says so and points at --force', async () => {
        stubCbbd({ 2026: tournament(2026) });
        jest.spyOn(HoopsTeam, 'bulkWrite').mockRejectedValueOnce(new Error('E11000 duplicate key'));
        await expect(backfill.backfill([2026])).rejects.toThrow(/team write failed partway.*--force/);
    });

    it('backfillTeams runs on its own with default options', async () => {
        stubCbbd({});
        expect((await backfill.backfillTeams(2026)).status).toBe('written');
    });

    describe('the full schedule', () => {
        it('stores the regular season and postseason through the season upsert, the postseason from March only', async () => {
            const post = [game(9001, 2026, { tournament: 'NIT', homeSeed: 2, awaySeed: 7 })];
            stubCbbd({ 2026: tournament(2026) }, {}, { 2026: { postseason: post } });
            const [out] = await backfill.backfill([2026]);
            expect(out.schedule).toMatchObject({ status: 'written', fetched: REGULAR + 1, written: REGULAR + 1, calls: 11 });
            expect(cbbd.fetchGamesInRange).toHaveBeenCalledWith(2026, 'regular', cbbd.seasonRange(2026).start, cbbd.seasonRange(2026).end);
            expect(cbbd.fetchGamesInRange).toHaveBeenCalledWith(2026, 'postseason', new Date('2026-03-01T00:00:00Z'), cbbd.seasonRange(2026).end);
            expect(await HoopsGame.countDocuments({ season: 2026, seasonType: 'regular' })).toBe(REGULAR);
            expect(await HoopsGame.findOne({ id: 9001 }).lean()).toMatchObject({ tournament: 'NIT', homePoints: 80 });
        });

        it('renumbers the tournament already stored once November arrives as week 1', async () => {
            stubCbbd({ 2026: tournament(2026) });
            await backfill.backfill([2026]);
            const first = await HoopsGame.findOne({ season: 2026, seasonType: 'regular' }).sort({ startDate: 1 }).lean();
            const ncaa = await HoopsGame.findOne({ season: 2026, tournament: 'NCAA' }).lean();
            expect(first.week).toBe(1);
            expect(ncaa.week).toBeGreaterThan(15);
        });

        it('spends nothing on a season whose schedule is stored, and re-fetches it on force', async () => {
            stubCbbd({ 2026: tournament(2026) });
            await backfill.backfill([2026]);
            const [again] = await backfill.backfill([2026]);
            expect(again.schedule).toMatchObject({ status: 'stored', calls: 0, stored: REGULAR });
            expect(cbbd.fetchGamesInRange).toHaveBeenCalledTimes(2);
            await backfill.backfill([2026], { force: true });
            expect(cbbd.fetchGamesInRange).toHaveBeenCalledTimes(4);
        });

        it('fetches but writes no schedule on a dry run', async () => {
            stubCbbd({ 2026: tournament(2026) });
            const [out] = await backfill.backfill([2026], { dryRun: true });
            expect(out.schedule).toMatchObject({ status: 'dry-run', written: 0, calls: 11 });
            expect(await HoopsGame.countDocuments({})).toBe(0);
        });

        it.each([
            ['a window at the page cap', { capHits: { regular: ['2025-11-01..2025-11-30'] } }, /row cap in 2025-11-01/],
            ['rows from another season', { regular: schedule(2026).concat(schedule(2025, 1)) }, /another season/],
            ['a season still being played', { regular: schedule(2026, REGULAR, { status: 'scheduled' }) }, /not a finished season/]
        ])('writes no schedule for %s', async (_label, sched, message) => {
            stubCbbd({ 2026: tournament(2026) }, {}, { 2026: sched });
            await expect(backfill.backfill([2026])).rejects.toThrow(message);
            expect(await HoopsGame.countDocuments({ seasonType: 'regular' })).toBe(0);
        });

        it('a failed schedule write says so and points at --force', async () => {
            stubCbbd({ 2026: tournament(2026) });
            await backfill.backfillSeason(2026);
            jest.spyOn(HoopsGame, 'bulkWrite').mockRejectedValueOnce(new Error('E11000 duplicate key'));
            await expect(backfill.backfillSchedule(2026)).rejects.toThrow(/schedule write failed partway.*--force/);
        });

        it('falls back to the regular season\'s remaining calls when the postseason sends none', async () => {
            stubCbbd({});
            cbbd.fetchGamesInRange.mockImplementation(async (season, type) => ({
                games: type === 'regular' ? schedule(season) : [], windows: 1, capHits: [],
                remainingCalls: type === 'regular' ? 29000 : null
            }));
            expect((await backfill.backfillSchedule(2026)).remainingCalls).toBe(29000);
        });
    });
});
