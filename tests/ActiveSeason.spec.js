// Coverage for modules/active-season.js — the replacement for process.env.YEAR.
//
// The distinction under test throughout: a SPORT's season is what the CFBD
// ingest needs, a LEAGUE's season is what standings and scoring config need,
// and they are only usually the same number. Everything here uses the real
// in-memory Mongo, because the cache-priming behaviour is the point.

const { useMongo } = require('./helpers/mongo');
const League = require('../models/league');
const SportSeason = require('../models/sportSeason');
const activeSeason = require('../modules/active-season');

useMongo();

const ORIGINAL_YEAR = process.env.YEAR;

beforeEach(() => {
    activeSeason._reset();
    process.env.YEAR = ORIGINAL_YEAR;
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    process.env.YEAR = ORIGINAL_YEAR;
});

describe('the env fallback, before the cache is primed', () => {
    test('answers from process.env.YEAR so a cold start is never null', async () => {
        process.env.YEAR = '2026';
        expect(activeSeason.primed()).toBe(false);
        expect(activeSeason.activeSeason('football')).toBe(2026);
        expect(activeSeason.seasonForLeague('graham-league')).toBe(2026);
    });

    test('says so out loud, once, rather than falling back silently', async () => {
        process.env.YEAR = '2026';
        activeSeason.activeSeason();
        activeSeason.activeSeason();
        activeSeason.seasonForLeague('graham-league');
        const lines = console.log.mock.calls.map(c => String(c[0]));
        expect(lines.filter(l => l.includes('not primed'))).toHaveLength(1);
    });

    test('is null rather than NaN when YEAR is unset or junk', () => {
        delete process.env.YEAR;
        expect(activeSeason.activeSeason()).toBeNull();
        process.env.YEAR = 'not-a-year';
        activeSeason._reset();
        expect(activeSeason.activeSeason()).toBeNull();
    });
});

describe('once primed, Mongo wins over the env var', () => {
    test('a stale YEAR cannot override the stored season', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        process.env.YEAR = '2019';   // as if a config var went stale
        await activeSeason.prime();
        expect(activeSeason.activeSeason('football')).toBe(2026);
    });

    test('carries the sport status alongside the season', async () => {
        await SportSeason.create({ sport: 'basketball', season: 2027, status: 'preseason' });
        await activeSeason.prime();
        expect(activeSeason.activeSeason('basketball')).toBe(2027);
        expect(activeSeason.sportStatus('basketball')).toBe('preseason');
    });

    test('holds two sports in different seasons at once — the reason this exists', async () => {
        await SportSeason.create([
            { sport: 'football', season: 2026, status: 'in-season' },
            { sport: 'basketball', season: 2027, status: 'preseason' }
        ]);
        await activeSeason.prime();
        expect(activeSeason.activeSeason('football')).toBe(2026);
        expect(activeSeason.activeSeason('basketball')).toBe(2027);
    });

    test('an unknown sport is null, not the football season', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        await activeSeason.prime();
        // A sport with no row yet must not silently inherit football's year —
        // that would ingest a basketball season of 2026 instead of 2027.
        expect(activeSeason.activeSeason('basketball')).toBeNull();
    });

    test('defaults to football when no sport is named', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        await activeSeason.prime();
        expect(activeSeason.activeSeason()).toBe(2026);
    });
});

describe('seasonForLeague', () => {
    test('follows the sport when the league has no season of its own', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        await League.create({ code: 'graham-league', name: 'The Polar Depressed' });
        await activeSeason.prime();
        // This is the normal case: both existing leagues just play whatever
        // season football is in.
        expect(activeSeason.seasonForLeague('graham-league')).toBe(2026);
    });

    test('a league can lag its sport without the app overruling it', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        await League.create({ code: 'claunts-league', name: 'Goofballers', season: 2025 });
        await activeSeason.prime();
        expect(activeSeason.activeSeason('football')).toBe(2026);
        expect(activeSeason.seasonForLeague('claunts-league')).toBe(2025);
    });

    test('resolves through the league\'s own sport, not the default', async () => {
        await SportSeason.create([
            { sport: 'football', season: 2026 },
            { sport: 'basketball', season: 2027 }
        ]);
        await League.create({ code: 'hardwood-league', name: 'Hoops', sport: 'basketball' });
        await activeSeason.prime();
        expect(activeSeason.seasonForLeague('hardwood-league')).toBe(2027);
        expect(activeSeason.sportForLeague('hardwood-league')).toBe('basketball');
    });

    test('an unknown league code falls back to football rather than throwing', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        await activeSeason.prime();
        expect(activeSeason.seasonForLeague('no-such-league')).toBe(2026);
        expect(activeSeason.sportForLeague('no-such-league')).toBe('football');
    });

    test('treats a league doc with no sport field as football', async () => {
        // The two live league docs predate the sport field, so they have none —
        // no backfill should be required to keep them working.
        await SportSeason.create({ sport: 'football', season: 2026 });
        await League.collection.insertOne({ code: 'legacy-league', name: 'Legacy' });
        await activeSeason.prime();
        expect(activeSeason.sportForLeague('legacy-league')).toBe('football');
        expect(activeSeason.seasonForLeague('legacy-league')).toBe(2026);
    });
});

describe('ensureDefaultSport', () => {
    test('seeds football from YEAR when nothing is stored', async () => {
        process.env.YEAR = '2026';
        expect(await activeSeason.ensureDefaultSport()).toBe(2026);
        const row = await SportSeason.findOne({ sport: 'football' }).lean();
        expect(row).toMatchObject({ sport: 'football', season: 2026, status: 'in-season' });
    });

    test('never overwrites a stored season, so a stale YEAR cannot undo a rollover', async () => {
        await SportSeason.create({ sport: 'football', season: 2027, status: 'preseason' });
        process.env.YEAR = '2026';
        expect(await activeSeason.ensureDefaultSport()).toBeNull();
        const row = await SportSeason.findOne({ sport: 'football' }).lean();
        expect(row.season).toBe(2027);
        expect(row.status).toBe('preseason');
    });

    test('is idempotent across repeated boots', async () => {
        process.env.YEAR = '2026';
        await activeSeason.ensureDefaultSport();
        await activeSeason.ensureDefaultSport();
        expect(await SportSeason.countDocuments({ sport: 'football' })).toBe(1);
    });

    test('does nothing when YEAR is unset, rather than storing NaN', async () => {
        delete process.env.YEAR;
        expect(await activeSeason.ensureDefaultSport()).toBeNull();
        expect(await SportSeason.countDocuments({})).toBe(0);
    });
});

describe('setActiveSeason', () => {
    test('rolls a sport forward and the cache reflects it immediately', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        await activeSeason.prime();
        await activeSeason.setActiveSeason('football', 2027, 'preseason');
        // No second prime() call — setActiveSeason re-primes, or a season
        // rollover would not take effect until the next deploy.
        expect(activeSeason.activeSeason('football')).toBe(2027);
        expect(activeSeason.sportStatus('football')).toBe('preseason');
    });

    test('creates a sport that has no row yet', async () => {
        await activeSeason.prime();
        await activeSeason.setActiveSeason('basketball', 2027, 'preseason');
        expect(activeSeason.activeSeason('basketball')).toBe(2027);
        expect(await SportSeason.countDocuments({ sport: 'basketball' })).toBe(1);
    });

    test('leaves the stored status alone when none is given', async () => {
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        await activeSeason.setActiveSeason('football', 2027);
        expect(activeSeason.sportStatus('football')).toBe('in-season');
    });
});
