// Live basketball scores from ESPN's scoreboard, laid over CBBD's.
//
// ---- why ----
//
// CBBD's /scoreboard refreshes about once a minute. Measured 2 Nov 2026, 3
// live games polled every 5s for 8 minutes: CBBD changed every ~64s, ESPN
// every 12-21s; the same score reached CBBD a median 31-63s after ESPN
// (10-74s range), and 6 of the 19 scores ESPN showed in that window never
// appeared on CBBD at all. Laying ESPN's running score, half and clock over
// CBBD's moves every live surface (game page, Scores, My Team) and the
// tip-off and crunch-time alerts up by that much.
//
// ---- CBBD still owns the result ----
//
// ESPN only ever moves a game CBBD has as scheduled or in progress, and only
// to in progress. FINAL is CBBD's alone: it is what starts box scores and the
// scoring pass, and the final push alert waits for it. A game CBBD has final,
// postponed or cancelled is never touched. Nothing in scoring reads ESPN —
// once CBBD's own data is stored, theirs is what stands (the rule
// modules/espn-summary.js states for the box and shot chart).
//
// ESPN is never allowed to move a game BACKWARDS against CBBD's own row: if
// ESPN is behind CBBD (a stale ESPN edge cache), CBBD's row goes through as is.
// Going backwards against what is already STORED is updateFor's guard
// (modules/hoops-scoreboard.js), which also covers a tick where ESPN failed
// and CBBD's older numbers come in alone.
//
// ---- the API ----
//
// The same public, UNDOCUMENTED feed modules/hoops-espn-tip-times.js reads: no
// key, no quota against CBBD's pool, no promise it stays put. A game's
// `sourceId` IS its ESPN event id. Queried one Eastern day at a time — a
// `dates=A-B` range 400s with groups=50 — so a night is one call per tick, two
// around midnight Eastern. A failure costs nothing but speed: the poller
// carries on with CBBD alone.

const calendar = require('./hoops-calendar');
const { parseClockSeconds } = require('./hoops-score-events');

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
const TIMEOUT_MS = 5000;

// Regulation is two 20-minute halves; each overtime is 5 minutes.
const HALF_SECONDS = 20 * 60;
const OT_SECONDS = 5 * 60;

const dayKey = (when) => {
    const d = calendar.easternDay(when);
    return d ? d.toISOString().slice(0, 10) : null;
};

function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// Game seconds played at this period and clock, or null when either is unknown.
function elapsed(period, clock) {
    const p = num(period);
    const left = parseClockSeconds(clock);
    if (p === null || p < 1 || left === null) return null;
    if (p <= 2) return (p - 1) * HALF_SECONDS + (HALF_SECONDS - left);
    return 2 * HALF_SECONDS + (p - 3) * OT_SECONDS + (OT_SECONDS - left);
}

// ESPN's half scores update apart from its header score (seen live 2 Nov 2026:
// away 13 with a first-half line of 15, home 49 with 48), the same drift its
// player box shows. The header is the score; the CURRENT half is what is still
// moving, so it is recomputed as the total less the halves before it. A
// split that cannot add up, or that does not have one entry per half played
// yet, is dropped and CBBD's is kept.
// Is `next` behind `prev`? Both are { period, clock, home, away } with
// numeric points. Game time decides first: an earlier half, or less of the
// game played, is behind; MORE game played is never behind, even with fewer
// points — that is a score correction (a 3 reviewed down to a 2), and
// refusing it would freeze the clock for the rest of the game. Only when game
// time cannot settle it (equal, or a clock unknown, as at halftime) do fewer
// points on either side make it behind.
function behind(next, prev) {
    const np = num(next.period), pp = num(prev.period);
    if (np !== null && pp !== null && np < pp) return true;
    const nAt = elapsed(next.period, next.clock), pAt = elapsed(prev.period, prev.clock);
    if (nAt !== null && pAt !== null && nAt !== pAt) return nAt < pAt;
    const lower = (a, b) => num(a) !== null && num(b) !== null && num(a) < num(b);
    return lower(next.home, prev.home) || lower(next.away, prev.away);
}

function side(c, period) {
    const points = num(c.score);
    let lines = Array.isArray(c.linescores) && c.linescores.length
        ? c.linescores.slice().sort((a, b) => num(a.period) - num(b.period)).map(l => num(l.value))
        : null;
    // One entry per half played so far, or the "current half" is the wrong one.
    if (lines && (points === null || lines.some(v => v === null) || lines.length !== period)) lines = null;
    if (lines) {
        const before = lines.slice(0, -1).reduce((a, b) => a + b, 0);
        lines[lines.length - 1] = points - before;
        if (lines[lines.length - 1] < 0) lines = null;
    }
    return { points, lineScores: lines };
}

// One ESPN event as { started, period, clock, home, away }, or null for a game
// that has not tipped, was postponed or cancelled, or is malformed.
// `post` counts only when ESPN says completed: a postponement is also `post`.
function shapeEvent(e) {
    const comp = e && Array.isArray(e.competitions) ? e.competitions[0] : null;
    const st = e && e.status;
    const type = st && st.type;
    if (!comp || !type || !Array.isArray(comp.competitors)) return null;
    if (!(type.state === 'in' || (type.state === 'post' && type.completed === true))) return null;
    const home = comp.competitors.find(c => c && c.homeAway === 'home');
    const away = comp.competitors.find(c => c && c.homeAway === 'away');
    if (!home || !away) return null;
    const period = num(st.period);
    const out = { period, clock: st.displayClock != null ? String(st.displayClock) : null, home: side(home, period), away: side(away, period) };
    if (out.home.points === null || out.away.points === null) return null;
    return out;
}

// One Eastern day's live and finished games, as Map<espnEventId, shaped>.
// Throws on any failure; the poller decides what that costs.
async function fetchDay(day) {
    const url = `${SCOREBOARD}?dates=${day.replace(/-/g, '')}&groups=50&limit=500`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ESPN scoreboard ${day} ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.events)) throw new Error(`ESPN scoreboard ${day}: no events array — the response shape changed`);
    const out = new Map();
    for (const e of body.events) {
        const shaped = e && e.id != null ? shapeEvent(e) : null;
        if (shaped) out.set(String(e.id), shaped);
    }
    return out;
}

// Every Eastern day a game that may be live belongs to. `games` are the
// poller's candidates ({ startDate }); a game is listed on its own Eastern day.
function daysFor(games) {
    return [...new Set((games || []).map(g => dayKey(new Date(g.startDate))).filter(Boolean))].sort();
}

// All of those days in one Map. { events, error }: never throws, and one bad
// day does not cost the others.
async function fetchLive(days) {
    const events = new Map();
    const errors = [];
    // In parallel: two days in a row at a 5s timeout each could outlast the
    // 10s tick on a bad ESPN night.
    const results = await Promise.allSettled(days.map(day => module.exports.fetchDay(day)));
    for (const r of results) {
        if (r.status === 'fulfilled') for (const [id, ev] of r.value) events.set(id, ev);
        else errors.push(r.reason && r.reason.message);
    }
    return { events, error: errors.length ? errors.join('; ') : null };
}

// CBBD's scoreboard row with ESPN's running numbers laid over it, or the row
// untouched when ESPN has nothing newer to say (see the header).
function overlay(row, ev) {
    if (!row || !ev) return row;
    const status = String(row.status || '').toLowerCase();
    if (status !== 'scheduled' && status !== 'in_progress') return row;
    if (status === 'in_progress') {
        const cbbd = { period: row.period, clock: row.clock,
            home: row.homeTeam && row.homeTeam.points, away: row.awayTeam && row.awayTeam.points };
        const espn = { period: ev.period, clock: ev.clock, home: ev.home.points, away: ev.away.points };
        if (behind(espn, cbbd)) return row;
        // Nothing newer to say: CBBD's row as is, so only real changes count as ESPN's.
        if (num(cbbd.period) === espn.period && cbbd.clock === espn.clock
            && num(cbbd.home) === espn.home && num(cbbd.away) === espn.away) return row;
    }
    const sideOf = (cbbd, espn) => Object.assign({}, cbbd, { points: espn.points },
        espn.lineScores ? { lineScores: espn.lineScores } : {});
    return Object.assign({}, row, {
        status: 'in_progress',
        period: ev.period,
        clock: ev.clock,
        homeTeam: sideOf(row.homeTeam, ev.home),
        awayTeam: sideOf(row.awayTeam, ev.away)
    });
}

module.exports = { fetchDay, fetchLive, daysFor, overlay, shapeEvent, elapsed, behind, SCOREBOARD };
