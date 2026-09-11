// The one answer to "what season is it?" — per sport, and per league.
//
// Replaces `process.env.YEAR`, a single global that 94 sites read. One global
// works only while exactly one season is live anywhere in the app. Football
// 2026 and basketball 2026-27 overlap from November (epic #310), so it stops
// being answerable.
//
// Two different questions, deliberately kept apart:
//
//   activeSeason('football')     - a fact about the SPORT. What the CFBD/CBBD
//                                  ingest jobs and every data route need. Both
//                                  football leagues share it.
//   seasonForLeague('graham-league')
//                                - a fact about one LEAGUE. What standings,
//                                  scoring config and betting need. Falls back
//                                  to its sport's season when the league has
//                                  no opinion, which is the normal case.
//
// ---- why the reads are synchronous ----
//
// The seasons live in Mongo, but these getters are sync, served from a cache
// primed at boot. That is not an optimization — it is what keeps the migration
// honest. The 94 reads being replaced sit inside string templates, loop
// conditions and Mongo query objects; making each one `await` would turn a
// mechanical find-and-replace into a rewrite of every call path, which is how a
// refactor this wide acquires real bugs. Seasons change once a year, so a cache
// primed at startup and invalidated on write is the right shape anyway.
//
// ---- the env fallback is transitional, not silent ----
//
// Unprimed, these fall back to process.env.YEAR and say so once. That keeps CLI
// jobs and the existing test suites working while the migration lands
// incrementally. The DB always wins once primed. Delete the fallback when #313
// removes the last of the env vocabulary.

const League = require('../models/league');
const SportSeason = require('../models/sportSeason');

const DEFAULT_SPORT = 'football';

// { sports: { football: 2026 }, leagues: { 'graham-league': 2026 } }
let cache = null;
let warned = false;

function envSeason(why) {
    if (!warned) {
        warned = true;
        // console.error, not log: every failure mode that strands a dyno on the
        // env var shows up here and nowhere else.
        console.error(`active-season: falling back to process.env.YEAR (${why})`);
    }
    const n = Number(process.env.YEAR);
    return Number.isFinite(n) ? n : null;
}

// Load both tables into memory. Call once at boot (server.js), and again after
// anything writes a season.
// Bumped on every prime() start. A prime that finishes after a NEWER one
// started is stale and must not install its result: the interval and
// setActiveSeason run unsynchronised, so a re-prime that began before a
// rollover could resolve after it and revert the dyno that just served the
// rollover — for up to a full refresh interval, while its own response said the
// change had taken.
let generation = 0;

async function prime() {
    const mine = ++generation;
    const [sports, leagues] = await Promise.all([
        SportSeason.find({}, { sport: 1, season: 1, status: 1, _id: 0 }).lean(),
        League.find({}, { code: 1, sport: 1, season: 1, _id: 0 }).lean()
    ]);

    const next = { sports: {}, leagues: {}, sportStatus: {}, leagueSport: {} };
    sports.forEach(s => {
        // Finiteness, not just presence. A row written by updateOne skips schema
        // validation, so one can exist with no `season` at all — Number(undefined)
        // is NaN, NaN passes the `!= null` test in activeSeason(), and it comes
        // back out typed as a number. It then reaches Mongo as a Number path and
        // throws CastError, so every route for that sport 500s instead of getting
        // the documented null.
        const season = Number(s.season);
        if (Number.isFinite(season)) {
            next.sports[s.sport] = season;
        } else {
            console.error(`active-season: ignoring ${s.sport} row with unusable season ${JSON.stringify(s.season)}`);
        }
        next.sportStatus[s.sport] = s.status;
    });
    leagues.forEach(l => {
        next.leagueSport[l.code] = l.sport || DEFAULT_SPORT;
        // A league with no season of its own follows its sport.
        const own = Number(l.season);
        if (l.season != null && Number.isFinite(own)) next.leagues[l.code] = own;
    });

    if (mine !== generation) {
        // A newer prime started while this one was reading. Its result is
        // fresher by definition, so drop ours rather than overwrite it.
        return cache;
    }
    cache = next;
    return cache;
}

function primed() {
    return !!cache;
}

// The season a sport is currently in.
function activeSeason(sport) {
    const key = sport || DEFAULT_SPORT;
    if (!cache) return envSeason('cache not primed');
    const found = cache.sports[key];
    // A sport with no row yet (basketball, before its first season is created)
    // is not an error — the caller gets null and decides. Only the default
    // sport falls back to env, since that is the one the env var described.
    if (found != null) return found;
    return key === DEFAULT_SPORT ? envSeason(`no ${DEFAULT_SPORT} row stored`) : null;
}

// Where a sport is in its year — 'preseason' | 'in-season' | 'complete' | null.
function sportStatus(sport) {
    if (!cache) return null;
    return cache.sportStatus[sport || DEFAULT_SPORT] || null;
}

// The season one league is playing: its own if set, else its sport's.
function seasonForLeague(code) {
    if (!cache) return envSeason('cache not primed');
    const own = cache.leagues[code];
    if (own != null) return own;
    return activeSeason(cache.leagueSport[code] || DEFAULT_SPORT);
}

// Which sport a league plays.
function sportForLeague(code) {
    if (!cache) return DEFAULT_SPORT;
    return cache.leagueSport[code] || DEFAULT_SPORT;
}

// Point a sport at a season, then refresh the cache. Upserts, so this is also
// how a sport gets its first row.
async function setActiveSeason(sport, season, status) {
    // Validated here too, not only in the route and the CLI. This is the single
    // exported write path, and the branch argues elsewhere that two write paths
    // must not carry two contracts — so the contract lives at the seam.
    const year = Number(season);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw new Error(`setActiveSeason: season must be a year between 2000 and 2100, got ${JSON.stringify(season)}`);
    }
    const update = { season: year };
    if (status) update.status = status;
    await SportSeason.updateOne({ sport }, { $set: update }, { upsert: true });
    return prime();
}

// Create the default sport's row from process.env.YEAR if it has none yet.
//
// Idempotent, and called at boot so a deploy needs no manual step to get the
// value the app has been running on all along. It only ever fills a GAP — an
// existing row is never overwritten, so once the season lives in Mongo the env
// var stops mattering even if it goes stale.
async function ensureDefaultSport() {
    const year = Number(process.env.YEAR);

    // $setOnInsert, not findOne-then-create: `sport` is uniquely indexed, and
    // two web dynos booting together on an empty collection would both pass a
    // findOne and then one would take an E11000. Which used to skip prime()
    // entirely on that dyno — see the separate try/catch in server.js.
    if (Number.isFinite(year)) {
        const res = await SportSeason.updateOne(
            { sport: DEFAULT_SPORT },
            { $setOnInsert: { sport: DEFAULT_SPORT, season: year, status: 'in-season' } },
            { upsert: true }
        );
        if (res.upsertedCount) {
            console.log(`active-season: seeded ${DEFAULT_SPORT} season ${year} from process.env.YEAR`);
            return year;
        }
    }

    // The row already existed. If YEAR still names a DIFFERENT season, say so
    // loudly every boot: it means someone tried to roll the season over the old
    // way (docs/season-flip-runbook.md used to be an env var + restart) and the
    // app is deliberately ignoring them. Silence here is how a flip that did
    // not take costs a week to diagnose.
    const stored = await SportSeason.findOne({ sport: DEFAULT_SPORT }).lean();
    if (stored && Number.isFinite(year) && Number(stored.season) !== year) {
        console.error(
            `active-season: process.env.YEAR=${year} but ${DEFAULT_SPORT} is stored as ` +
            `${stored.season}. The stored season wins. To roll the season over use ` +
            `PUT /seasons/${DEFAULT_SPORT} (or npm run season:set) — the env var no longer does it.`
        );
    }
    return null;
}

// Re-prime on a timer.
//
// The getters are sync, so a cache can only be refreshed out of band. Without
// this a dyno's answer is fixed from boot until restart — and the scoring
// pipeline writes over HTTP to the public hostname, so a job running on the
// dyno that knows about a rollover can land its writes on one that does not.
// A minute of staleness is acceptable for a value that changes once a year;
// never re-reading is not.
const REFRESH_MS = Number(process.env.SEASON_REFRESH_MS) || 60 * 1000;
let refreshTimer = null;

function startRefresh(intervalMs) {
    if (refreshTimer) return refreshTimer;
    refreshTimer = setInterval(() => {
        prime().catch(err => console.error('active-season: re-prime failed:', err.message));
    }, intervalMs || REFRESH_MS);
    // Don't hold the process open — a CLI script that happens to require this
    // module should still be able to exit.
    if (refreshTimer.unref) refreshTimer.unref();
    return refreshTimer;
}

function stopRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
}

// Test seam: drop the cache so the next read re-primes (or falls back).
function _reset() {
    cache = null;
    warned = false;
    generation = 0;
    stopRefresh();
}

module.exports = {
    DEFAULT_SPORT,
    prime, primed, ensureDefaultSport,
    startRefresh, stopRefresh,
    activeSeason, sportStatus,
    seasonForLeague, sportForLeague,
    setActiveSeason,
    _reset
};
