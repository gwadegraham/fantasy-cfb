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

function stubCbbd(bySeason) {
    return jest.spyOn(cbbd, 'cbbdGet').mockImplementation(async (path, params) => {
        const data = bySeason[params.season];
        if (data instanceof Error) throw data;
        return { data: data || [], remainingCalls: 29700 };
    });
}

beforeEach(async () => {
    await SportSeason.create([{ sport: 'football', season: 2026, status: 'in-season' }, { sport: 'basketball', season: ACTIVE, status: 'in-season' }]);
    await seasons.prime();
});

afterEach(() => jest.restoreAllMocks());

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
        expect(await HoopsGame.countDocuments({ season: 2026 })).toBe(67);
    });

    it('re-fetches a season stored only in part', async () => {
        await HoopsGame.create(tournament(2026, 10).map(g => Object.assign({}, g, { startDate: new Date(g.startDate) })));
        const spy = stubCbbd({ 2026: tournament(2026) });
        const out = await backfill.backfill([2026]);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(out[0]).toMatchObject({ status: 'written', stored: 10 });
        expect(await HoopsGame.countDocuments({ season: 2026 })).toBe(67);
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
});
