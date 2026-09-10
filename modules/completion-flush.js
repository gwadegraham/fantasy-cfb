// Debounce for the post-completion work the live poller triggers.
//
// The expensive half of a live poll is not the /scoreboard call — that one is
// free (CFBD does not count /scoreboard or /info against the monthly quota).
// It is what happens on a tick where a game *finals*: two whole-week CFBD
// fetches (/games/teams, /games/players — the latter a ~2.5MB payload that
// cannot be narrowed to a gameId) plus H2H bonuses, cumulative totals, team
// scores, records and parlay resolution across the league.
//
// That work fires per *tick containing a final*, not per game, so its cost is
// set by the poll cadence rather than by the schedule: at a 2-minute cadence
// ~3.3 games final per triggering tick, at 30 seconds ~1.4. Dropping the
// cadence to make scores feel live would therefore multiply the heavy work
// roughly 4x for no added freshness — the same games, just discovered in
// smaller batches.
//
// So the two clocks are separated. Finals accumulate here; the heavy pass runs
// once the set goes quiet (no new final for QUIET_MS) or has been held for
// MAX_WAIT_MS, whichever comes first. Scores stay as live as the poll cadence,
// while completion work keeps batching the way it does today.
//
// This is deliberately NOT the end-of-slate flush that was turned down: that
// one deferred finals by hours. A rolling ~2-minute window keeps finals
// settling promptly while still collapsing a cluster into one pass.
//
// State is in-memory and per-process, so a dyno restart drops whatever is
// pending. That is survivable rather than silent: the Tuesday enrichment job
// backfills the previous week's team and player stats wholesale, and the
// scoring passes are all idempotent re-runs. The MAX_WAIT_MS cap also bounds
// how much can ever be in flight.

// Hold a cluster until it has been this quiet. Set QUIET_MS to 0 to restore the
// old flush-on-every-tick behavior (a kill switch that needs no code change).
const QUIET_MS = envMs('LIVE_COMPLETION_QUIET_MS', 120000);
// Never hold longer than this, even if finals keep trickling in. A busy
// Saturday evening can produce a new final every minute for a while; without
// the cap a continuous trickle would defer the pass indefinitely.
const MAX_WAIT_MS = envMs('LIVE_COMPLETION_MAX_WAIT_MS', 300000);

function envMs(name, fallback) {
    const raw = process.env[name];
    if (raw == null || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---- pure decision ---------------------------------------------------------

// Should the pending set be flushed now? Pure so the timing rules are unit
// testable without a clock or a DB.
//
// `force` is the slate-is-over drain: the poller's games-live gate stops firing
// once the last game finals, so a set left pending at that moment would never
// see another tick to release it. The caller detects that and forces.
function decideFlush({ pendingCount, firstAddedMs, lastAddedMs, nowMs, quietMs, maxWaitMs, force }) {
    if (!pendingCount) return { flush: false, reason: 'nothing pending' };
    if (force) return { flush: true, reason: `forced with ${pendingCount} game(s) pending` };

    const quietFor = nowMs - lastAddedMs;
    const heldFor = nowMs - firstAddedMs;

    if (quietFor >= quietMs) {
        return { flush: true, reason: `quiet ${Math.round(quietFor / 1000)}s with ${pendingCount} game(s) pending` };
    }
    if (heldFor >= maxWaitMs) {
        return { flush: true, reason: `max wait ${Math.round(heldFor / 1000)}s reached with ${pendingCount} game(s) pending` };
    }
    return {
        flush: false,
        reason: `holding ${pendingCount} game(s) — quiet ${Math.round(quietFor / 1000)}s of ${Math.round(quietMs / 1000)}s`
    };
}

// Group pending entries into the per-(week, seasonType) batches the CFBD
// fetches take. Both /games/teams and /games/players are fetched a week at a
// time, so one group is one pair of calls. Normally there is exactly one group;
// two only when a flush straddles the regular/postseason boundary, which is
// precisely the case that would corrupt the ingest if every game were assumed
// to share the latest tick's week.
function groupPending(entries) {
    const groups = new Map();
    for (const e of entries) {
        const key = `${e.seasonType}:${e.week}`;
        if (!groups.has(key)) groups.set(key, { week: e.week, seasonType: e.seasonType, gameIds: [] });
        groups.get(key).gameIds.push(e.id);
    }
    return [...groups.values()];
}

// ---- pending set (process-local state) -------------------------------------

// gameId -> { id, week, seasonType }. A Map so a game re-reported as newly
// completed (a restart, or routes/games.js racing the poller) collapses instead
// of being ingested twice.
let pending = new Map();
let firstAddedMs = null;
let lastAddedMs = null;

// Record newly completed games, tagged with the week they were seen in. The
// week is captured at add time rather than read at flush time because the
// flush can span a week boundary — see groupPending.
function addPending(gameIds, { week, seasonType }, nowMs = Date.now()) {
    let added = 0;
    for (const id of gameIds || []) {
        if (id == null || pending.has(id)) continue;
        pending.set(id, { id, week, seasonType });
        added++;
    }
    if (added) {
        if (firstAddedMs == null) firstAddedMs = nowMs;
        lastAddedMs = nowMs;
    }
    return added;
}

function pendingCount() {
    return pending.size;
}

// Apply the timing rules to the current pending set.
function shouldFlush({ nowMs = Date.now(), force = false } = {}) {
    return decideFlush({
        pendingCount: pending.size,
        firstAddedMs, lastAddedMs, nowMs,
        quietMs: QUIET_MS, maxWaitMs: MAX_WAIT_MS,
        force
    });
}

// Hand the caller the pending batches and clear the set. Taken (rather than
// read then cleared) so a poll that overlaps the flush cannot pick up the same
// games again; anything that finals during the flush starts a fresh window.
function takePending() {
    const groups = groupPending([...pending.values()]);
    pending = new Map();
    firstAddedMs = null;
    lastAddedMs = null;
    return groups;
}

module.exports = {
    addPending, pendingCount, shouldFlush, takePending,
    // exported for tests
    decideFlush, groupPending, envMs, QUIET_MS, MAX_WAIT_MS,
    _reset: () => { pending = new Map(); firstAddedMs = null; lastAddedMs = null; }
};
