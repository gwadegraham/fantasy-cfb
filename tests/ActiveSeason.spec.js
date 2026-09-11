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
    jest.spyOn(console, 'error').mockImplementation(() => {});
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

    test('says so out loud, once, on console.error rather than log', async () => {
        process.env.YEAR = '2026';
        activeSeason.activeSeason();
        activeSeason.activeSeason();
        activeSeason.seasonForLeague('graham-league');
        // console.error, not log: this is the only signal that a dyno is
        // stranded on the env var, and it has to survive a log-level filter.
        const lines = console.error.mock.calls.map(c => String(c[0]));
        expect(lines.filter(l => l.includes('falling back to process.env.YEAR'))).toHaveLength(1);
        expect(lines.filter(l => l.includes('cache not primed'))).toHaveLength(1);
    });

    test('names the real reason when the cache IS primed but the sport has no row', async () => {
        // The old message always said "cache not primed", which was a lie in
        // this case and would have sent a diagnosis down the wrong path.
        process.env.YEAR = '2026';
        await activeSeason.prime();
        expect(activeSeason.activeSeason('football')).toBe(2026);
        const lines = console.error.mock.calls.map(c => String(c[0]));
        expect(lines.some(l => l.includes('no football row stored'))).toBe(true);
    });

    test('sportStatus and sportForLeague answer safely with no cache', () => {
        process.env.YEAR = '2026';
        // No status is knowable without the DB, so null — never a guess.
        expect(activeSeason.sportStatus('football')).toBeNull();
        // But a league's sport defaults to football, so callers that only need
        // the sport keep working through a cold start.
        expect(activeSeason.sportForLeague('graham-league')).toBe('football');
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

describe('a stored row with an unusable season', () => {
    test('is ignored rather than cached as NaN', async () => {
        // updateOne skips schema validation, so a row CAN exist with no season
        // field. Number(undefined) is NaN, NaN passes a `!= null` test, and it
        // used to come back out of activeSeason() typed as a number — then
        // reach Mongo as a Number path and throw CastError, 500ing every route
        // for that sport instead of returning the documented null.
        await SportSeason.collection.insertOne({ sport: 'basketball', status: 'preseason' });
        await SportSeason.create({ sport: 'football', season: 2026 });
        await activeSeason.prime();

        expect(activeSeason.activeSeason('basketball')).toBeNull();
        expect(Number.isNaN(activeSeason.activeSeason('basketball'))).toBe(false);
        // The status is still readable — only the unusable season is dropped.
        expect(activeSeason.sportStatus('basketball')).toBe('preseason');
        const lines = console.error.mock.calls.map(c => c.map(String).join(' '));
        expect(lines.some(l => l.includes('ignoring basketball row with unusable season'))).toBe(true);
    });

    test('does not poison the sports that are fine', async () => {
        await SportSeason.collection.insertOne({ sport: 'basketball' });
        await SportSeason.create({ sport: 'football', season: 2026 });
        await activeSeason.prime();
        expect(activeSeason.activeSeason('football')).toBe(2026);
    });

    test('the same guard applies to a league season', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        await League.collection.insertOne({ code: 'odd-league', name: 'Odd', season: 'soon' });
        await activeSeason.prime();
        // Falls through to the sport rather than answering NaN.
        expect(activeSeason.seasonForLeague('odd-league')).toBe(2026);
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

describe('ensureDefaultSport under concurrency', () => {
    test('two dynos booting together produce one row, and neither throws', async () => {
        // sport is uniquely indexed, and this used to be findOne-then-create:
        // both callers passed the findOne, then one took an E11000 — which in
        // server.js skipped prime() and stranded that dyno on the env var for
        // its whole life.
        process.env.YEAR = '2026';
        await SportSeason.init();   // ensure the unique index exists first
        const results = await Promise.all([
            activeSeason.ensureDefaultSport(),
            activeSeason.ensureDefaultSport(),
            activeSeason.ensureDefaultSport()
        ]);
        expect(await SportSeason.countDocuments({ sport: 'football' })).toBe(1);
        // Exactly one caller reports having done the insert.
        expect(results.filter(r => r === 2026)).toHaveLength(1);
    });

    test('shouts every boot while YEAR disagrees with the stored season', async () => {
        // This is the diagnosis for "the season flip didn't take": someone set
        // the config var the old way and the app is ignoring them.
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        process.env.YEAR = '2027';
        await activeSeason.ensureDefaultSport();
        const lines = console.error.mock.calls.map(c => String(c[0]));
        expect(lines.some(l => /YEAR=2027 but football is stored as 2026/.test(l))).toBe(true);
        expect(lines.some(l => l.includes('season:set'))).toBe(true);
    });

    test('stays quiet when they agree', async () => {
        await SportSeason.create({ sport: 'football', season: 2026 });
        process.env.YEAR = '2026';
        await activeSeason.ensureDefaultSport();
        const lines = console.error.mock.calls.map(c => String(c[0]));
        expect(lines.some(l => l.includes('but football is stored as'))).toBe(false);
    });
});

describe('startRefresh', () => {
    test('picks up a rollover written elsewhere, without a restart', async () => {
        // A dyno's cache was otherwise fixed from boot until restart, so a
        // rollover applied on one dyno never reached the others — and the
        // scoring pipeline writes over HTTP, so its writes land anywhere.
        await SportSeason.create({ sport: 'football', season: 2026, status: 'in-season' });
        await activeSeason.prime();
        expect(activeSeason.activeSeason('football')).toBe(2026);

        // Another process rolls the season over, straight in the database.
        await SportSeason.updateOne({ sport: 'football' }, { $set: { season: 2027 } });
        expect(activeSeason.activeSeason('football')).toBe(2026);   // still stale

        activeSeason.startRefresh(20);
        await new Promise(r => setTimeout(r, 120));
        expect(activeSeason.activeSeason('football')).toBe(2027);
        activeSeason.stopRefresh();
    });

    test('a failed re-prime logs and leaves the good cache in place', async () => {
        // prime() assigns the cache only after both queries resolve, so a blip
        // must not degrade a working dyno to the env fallback.
        await SportSeason.create({ sport: 'football', season: 2026 });
        await activeSeason.prime();
        process.env.YEAR = '1999';

        jest.spyOn(SportSeason, 'find').mockImplementation(() => { throw new Error('mongo blip'); });
        activeSeason.startRefresh(20);
        await new Promise(r => setTimeout(r, 120));
        activeSeason.stopRefresh();

        expect(activeSeason.activeSeason('football')).toBe(2026);
        const lines = console.error.mock.calls.map(c => c.map(String).join(' '));
        expect(lines.some(l => l.includes('re-prime failed') && l.includes('mongo blip'))).toBe(true);
    });

    test('is idempotent — repeated calls do not stack intervals', async () => {
        const first = activeSeason.startRefresh(1000);
        expect(activeSeason.startRefresh(1000)).toBe(first);
        activeSeason.stopRefresh();
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
