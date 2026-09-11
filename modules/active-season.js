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

function envSeason() {
    if (!warned) {
        warned = true;
        console.log('active-season: cache not primed, falling back to process.env.YEAR');
    }
    const n = Number(process.env.YEAR);
    return Number.isFinite(n) ? n : null;
}

// Load both tables into memory. Call once at boot (server.js), and again after
// anything writes a season.
async function prime() {
    const [sports, leagues] = await Promise.all([
        SportSeason.find({}, { sport: 1, season: 1, status: 1, _id: 0 }).lean(),
        League.find({}, { code: 1, sport: 1, season: 1, status: 1, _id: 0 }).lean()
    ]);

    const next = { sports: {}, leagues: {}, sportStatus: {}, leagueSport: {} };
    sports.forEach(s => {
        next.sports[s.sport] = Number(s.season);
        next.sportStatus[s.sport] = s.status;
    });
    leagues.forEach(l => {
        next.leagueSport[l.code] = l.sport || DEFAULT_SPORT;
        // A league with no season of its own follows its sport.
        if (l.season != null) next.leagues[l.code] = Number(l.season);
    });

    cache = next;
    return cache;
}

function primed() {
    return !!cache;
}

// The season a sport is currently in.
function activeSeason(sport) {
    const key = sport || DEFAULT_SPORT;
    if (!cache) return envSeason();
    const found = cache.sports[key];
    // A sport with no row yet (basketball, before its first season is created)
    // is not an error — the caller gets null and decides. Only the default
    // sport falls back to env, since that is the one the env var described.
    if (found != null) return found;
    return key === DEFAULT_SPORT ? envSeason() : null;
}

// Where a sport is in its year — 'preseason' | 'in-season' | 'complete' | null.
function sportStatus(sport) {
    if (!cache) return null;
    return cache.sportStatus[sport || DEFAULT_SPORT] || null;
}

// The season one league is playing: its own if set, else its sport's.
function seasonForLeague(code) {
    if (!cache) return envSeason();
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
    const update = { season: Number(season) };
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
    const existing = await SportSeason.findOne({ sport: DEFAULT_SPORT }).lean();
    if (existing) return null;
    const year = Number(process.env.YEAR);
    if (!Number.isFinite(year)) return null;
    await SportSeason.create({ sport: DEFAULT_SPORT, season: year, status: 'in-season' });
    console.log(`active-season: seeded ${DEFAULT_SPORT} season ${year} from process.env.YEAR`);
    return year;
}

// Test seam: drop the cache so the next read re-primes (or falls back).
function _reset() {
    cache = null;
    warned = false;
}

module.exports = {
    DEFAULT_SPORT,
    prime, primed, ensureDefaultSport,
    activeSeason, sportStatus,
    seasonForLeague, sportForLeague,
    setActiveSeason,
    _reset
};
