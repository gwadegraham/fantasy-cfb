// CFBD /live/plays — drive charts and advanced box scores, fetched on demand.
//
// This is the one live endpoint that COSTS money. /scoreboard and /info are
// quota-exempt, so the poller's cadence is free; /live/plays is not (verified:
// it decrements x-calllimit-remaining on every success). And `gameId` is
// required — no gameId is a 400 — so its cost scales with the number of games
// being looked at, not with the size of the slate.
//
// That rules out polling it. 48 concurrent FBS games at a 2-minute cadence
// would be ~30k calls in October alone, the entire monthly budget, for data
// nothing in scoring reads. Instead it is fetched only when someone actually
// opens a game detail page, behind the three guards that keep the cost bounded:
//
//   1. A shared per-game cache (TTL_MS). Cost scales with distinct games being
//      viewed, not with viewers — six managers watching one game cost one call
//      per window, the same as one manager.
//   2. Persistence on final. A completed game's payload is terminal: it comes
//      back with the full drive list and every advanced metric, and will never
//      change again. So the first view after a game ends stores the drive-level
//      summary on the Game doc, and every view after that is served from Mongo
//      for zero calls, forever. A finished game therefore costs at most ONE
//      call for its entire life.
//   3. A negative cache. A game that hasn't kicked off answers 400 "No plays
//      found for game." — that is a normal state, not an error, and it must not
//      turn into a request on every page refresh.
//
// The client side matters as much as this module: views/gameDetail.ejs only
// polls while the game is live and pauses on a hidden tab. Without those, one
// forgotten browser tab would be a budget event — 15 games left open for six
// hours is ~3,600 calls in a day.
//
// Note that errors are free: neither the 400 nor a 500 moved the counter when
// measured. Only successful fetches are billed.

const { envNum } = require('./env-num');

const CFBD_BASE = 'https://api.collegefootballdata.com';

// How long one game's live payload is reused. Play-by-play does not feel stale
// at 90s the way a score does, and the score itself comes from the (free)
// scoreboard on a 30s cadence, so this only paces the drive detail. Set to 0 to
// disable caching entirely.
const TTL_MS = envNum('LIVE_PLAYS_TTL_MS', 90000);

// How long "this game has no plays yet" is remembered. Longer than TTL_MS
// because the answer only changes at kickoff, and a pre-game page left open
// would otherwise re-ask every TTL.
const MISS_TTL_MS = envNum('LIVE_PLAYS_MISS_TTL_MS', 300000);

// Cap on distinct games held in memory. A full Saturday slate is ~60 games and
// each live entry is ~80KB, so the ceiling exists to stop a season's worth of
// game ids accumulating in a long-lived dyno rather than to ration a slate.
const MAX_ENTRIES = envNum('LIVE_PLAYS_MAX_ENTRIES', 200);

// ---- pure normalizers ------------------------------------------------------

function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// The advanced metrics CFBD computes per team. These are the interesting half
// of the payload — none of them are available from any other endpoint we call,
// and on a completed game they are final.
const TEAM_FIELDS = [
    'points', 'drives', 'plays',
    'scoringOpportunities', 'pointsPerOpportunity', 'averageStartYardLine',
    'lineYards', 'lineYardsPerRush', 'secondLevelYards', 'secondLevelYardsPerRush',
    'openFieldYards', 'openFieldYardsPerRush',
    'totalEpa', 'epaPerPlay', 'passingEpa', 'epaPerPass', 'rushingEpa', 'epaPerRush',
    'successRate', 'standardDownSuccessRate', 'passingDownSuccessRate',
    'explosiveness', 'deserveToWin'
];

function normalizeTeam(t) {
    if (!t) return null;
    const out = {
        teamId: num(t.teamId),
        team: t.team || null,
        homeAway: (t.homeAway || '').toLowerCase() || null,
        lineScores: Array.isArray(t.lineScores) ? t.lineScores.map(num) : []
    };
    for (const f of TEAM_FIELDS) out[f] = num(t[f]);
    return out;
}

// One drive, without its plays.
//
// The plays array is ~90% of the payload (64KB of 79KB on a measured game) and
// a drive chart doesn't read it — it wants where a drive started, where it
// ended, and how it ended. Persisting drive-level only is 8KB per game, ~7MB
// for a season, against 65MB for the raw payload. Live viewers still get the
// plays, because the cache holds the untrimmed response; only what goes to
// Mongo is trimmed. If a play-by-play log is ever wanted for finished games it
// costs one call per game to backfill.
function normalizeDrive(d) {
    if (!d) return null;
    return {
        id: d.id != null ? String(d.id) : null,
        offense: d.offense || null,
        offenseId: num(d.offenseId),
        defense: d.defense || null,
        defenseId: num(d.defenseId),
        playCount: num(d.playCount),
        yards: num(d.yards),
        startPeriod: num(d.startPeriod),
        startClock: d.startClock || null,
        startYardsToGoal: num(d.startYardsToGoal),
        endPeriod: num(d.endPeriod),
        endClock: d.endClock || null,
        endYardsToGoal: num(d.endYardsToGoal),
        duration: d.duration || null,
        scoringOpportunity: d.scoringOpportunity === true,
        result: d.result || null,
        pointsGained: num(d.pointsGained)
    };
}

// The drive-level summary persisted on a completed game. Deliberately just the
// two halves that are terminal and unavailable elsewhere: the advanced team
// metrics and the drive list. Live-only fields (clock, possession, down) are
// dropped — they are empty on a final anyway, and the Game doc already carries
// its own copies from the scoreboard.
function summarizeForStorage(payload) {
    if (!payload) return null;
    return {
        teams: (payload.teams || []).map(normalizeTeam).filter(Boolean),
        drives: (payload.drives || []).map(normalizeDrive).filter(Boolean),
        fetchedAt: new Date()
    };
}

// Is this payload final, i.e. safe to persist and serve forever? CFBD reports
// status as a display string ("Final", "In Progress"), so this checks for the
// terminal one rather than trying to enumerate the live ones.
function isFinalPayload(payload) {
    const status = payload && typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
    return status === 'final';
}

// ---- CFBD fetch ------------------------------------------------------------

// Raised for the 400 that means "this game hasn't produced any plays yet",
// which is the normal state of every game before kickoff. Separated from real
// failures so the caller can cache it as an answer instead of retrying it as an
// error.
class NoPlaysError extends Error {
    constructor(gameId) {
        super(`No plays found for game ${gameId}`);
        this.name = 'NoPlaysError';
        this.noPlays = true;
    }
}

async function fetchLivePlays(gameId) {
    const res = await fetch(`${CFBD_BASE}/live/plays?gameId=${encodeURIComponent(gameId)}`, {
        headers: {
            'Accept': 'application/json',
            'Authorization': process.env.CFBD_API_KEY
        }
    });

    // A game with no plays yet answers 400 with {"message":"No plays found for
    // game."}. Treated as an answer, not a failure — see NoPlaysError.
    if (res.status === 400) throw new NoPlaysError(gameId);

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`CFBD /live/plays ${res.status}: ${body.slice(0, 200)}`);
    }

    const remHeader = res.headers.get('x-calllimit-remaining');
    const data = await res.json();
    return {
        data: data && typeof data === 'object' ? data : null,
        remainingCalls: remHeader != null ? Number(remHeader) : null
    };
}

// ---- per-game cache --------------------------------------------------------

// gameId -> { at, payload } for a hit, or { at, noPlays: true } for the
// negative entry. Process-local, like the calendar cache: a restart just means
// the next viewer pays for one fetch.
let cache = new Map();

function cacheTtl(entry) {
    return entry && entry.noPlays ? MISS_TTL_MS : TTL_MS;
}

function isFresh(entry, nowMs) {
    if (!entry) return false;
    const ttl = cacheTtl(entry);
    if (ttl <= 0) return false;
    return (nowMs - entry.at) < ttl;
}

// Drop expired entries, then the oldest ones if still over the cap. Called on
// write rather than on a timer so an idle process holds nothing open.
function prune(nowMs) {
    for (const [id, entry] of cache) {
        if (!isFresh(entry, nowMs)) cache.delete(id);
    }
    if (cache.size <= MAX_ENTRIES) return;
    const byAge = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [id] of byAge.slice(0, cache.size - MAX_ENTRIES)) cache.delete(id);
}

function cacheGet(gameId, nowMs) {
    const entry = cache.get(gameId);
    return isFresh(entry, nowMs) ? entry : null;
}

function cacheSet(gameId, entry, nowMs) {
    cache.set(gameId, { ...entry, at: nowMs });
    prune(nowMs);
}

// Fetch one game's plays, through the cache.
//
// Returns { payload, status, remainingCalls, cached }, where status is:
//   'ok'      — a payload, live or final
//   'none'    — the game has no plays yet (pre-kickoff)
//   'stale'   — the fetch failed but a previous payload was still held
// A failure with nothing cached throws, so the route can answer honestly
// rather than pretending a game has no plays.
async function getLivePlays(gameId, { nowMs = Date.now() } = {}) {
    const hit = cacheGet(gameId, nowMs);
    if (hit) {
        return hit.noPlays
            ? { payload: null, status: 'none', cached: true, remainingCalls: null }
            : { payload: hit.payload, status: 'ok', cached: true, remainingCalls: null };
    }

    try {
        const { data, remainingCalls } = await fetchLivePlays(gameId);
        cacheSet(gameId, { payload: data }, nowMs);
        return { payload: data, status: 'ok', cached: false, remainingCalls };
    } catch (err) {
        if (err.noPlays) {
            cacheSet(gameId, { noPlays: true }, nowMs);
            return { payload: null, status: 'none', cached: false, remainingCalls: null };
        }

        // Serve a stale payload rather than an error when we have one — the
        // same trade modules/cfbd-calendar.js makes. A stale drive chart during
        // a CFBD blip beats an empty panel.
        const stale = cache.get(gameId);
        if (stale && stale.payload) {
            console.log(`live-plays: serving stale payload for ${gameId}: ${err.message}`);
            return { payload: stale.payload, status: 'stale', cached: true, remainingCalls: null };
        }
        throw err;
    }
}

module.exports = {
    getLivePlays, fetchLivePlays, NoPlaysError,
    summarizeForStorage, isFinalPayload,
    // exported for tests
    normalizeTeam, normalizeDrive, isFresh, prune,
    TTL_MS, MISS_TTL_MS, MAX_ENTRIES, TEAM_FIELDS,
    _cacheSize: () => cache.size,
    _reset: () => { cache = new Map(); }
};
