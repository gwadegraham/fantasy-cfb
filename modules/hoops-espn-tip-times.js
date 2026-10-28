// Tip times CBBD has not picked up yet, filled from ESPN's scoreboard.
//
// CBBD copies its schedule from ESPN (a game's `sourceId` IS the ESPN event
// id) but does not re-sync a stored game's tip time. Measured 26 Oct 2026 for
// 2-8 Nov: CBBD had 173 of 469 games TBD, and ESPN had a real time for 159 of
// them. Nov 2 still had the same 60 TBD games it had on 21 Oct.
//
// ---- CBBD always wins ----
//
// ESPN is only ever asked about a game CBBD has as TBD, or one ESPN already
// filled. The moment CBBD sends a real time, the ingest writes it and clears
// `startTimeSource`, and this module stops touching the game: every write
// here is filtered on "still TBD, or still ours", so even a CBBD write that
// lands mid-run wins. Where CBBD and ESPN BOTH have a time and disagree
// (14 of 294 that week), CBBD's stands — that is a deliberate choice, not an
// oversight.
//
// ---- the Eastern day is CBBD's, never ESPN's ----
//
// The TBD placeholder is midnight Eastern on the game's date (05:00Z in EST,
// 04:00Z in EDT). An ESPN time is only taken when it falls on that SAME
// Eastern calendar day. That keeps `week` exactly as the ingest derived it
// (hoops-calendar buckets by Eastern day), so filling a time can never move a
// game across a Sunday/Monday week boundary. A different day means ESPN has
// moved the game (Boyce @ Liberty, 6 Nov → 7 Nov, in the measured week) or
// the id is wrong; either way it is CBBD's call, so the game is left TBD.
// A real time after midnight Eastern (a late Hawaii tip) is skipped by the
// same rule and stays TBD — the safe way to be wrong.
//
// ESPN is queried by Eastern day too: its `dates=YYYYMMDD` is the Eastern
// date (0 mismatches across 472 events that week), and a 9 PM ET tip is
// already the next day in UTC.
//
// ---- the API ----
//
// site.api.espn.com is ESPN's public, UNDOCUMENTED scoreboard feed: no key,
// no quota against CBBD's pool, no promise it stays put. One call per Eastern
// day that has a candidate game. Any failure leaves those games exactly as
// they were (TBD), counted in the result; nothing here throws for ESPN.

const HoopsGame = require('../models/hoopsGame');
const calendar = require('./hoops-calendar');

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
const TIMEOUT_MS = 10000;
const SOURCE = 'espn';

const dayKey = (when) => {
    const d = calendar.easternDay(when);
    return d ? d.toISOString().slice(0, 10) : null;
};

// One Eastern day's games, as Map<espnEventId, { date, timeValid }>.
// groups=50 is all of Division I; limit well above a full night (~180 games).
async function fetchDay(day) {
    const url = `${SCOREBOARD}?dates=${day.replace(/-/g, '')}&groups=50&limit=500`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ESPN scoreboard ${day} ${res.status}`);
    const body = await res.json();
    if (!body || !Array.isArray(body.events)) throw new Error(`ESPN scoreboard ${day}: no events array — the response shape changed`);
    const out = new Map();
    for (const e of body.events) {
        const comp = e && Array.isArray(e.competitions) ? e.competitions[0] : null;
        if (!e || e.id == null || !comp) continue;
        out.set(String(e.id), { date: e.date, timeValid: comp.timeValid === true });
    }
    return out;
}

// What to write for one game, or null to leave it alone.
function decide(game, event, day) {
    const ours = game.startTimeSource === SOURCE;
    // Back to CBBD's placeholder: midnight Eastern on the game's own day.
    const revert = () => ({
        $set: { startDate: calendar.easternMidnight(new Date(`${day}T00:00:00Z`)), startTimeTbd: true },
        $unset: { startTimeSource: '' }
    });

    // Missing from a day that answered: ESPN has moved it (it lists a game
    // only on its own day), so a time we filled is no longer backed.
    if (!event) return ours ? { kind: 'reverted', update: revert() } : { kind: 'notOnEspn', update: null };
    const when = new Date(event.date);
    if (!event.timeValid || Number.isNaN(when.getTime())) {
        // ESPN pulled the time it gave us: our fill is no longer backed by anything.
        return ours ? { kind: 'reverted', update: revert() } : { kind: 'espnTbd', update: null };
    }
    if (dayKey(when) !== day) {
        return ours ? { kind: 'reverted', update: revert() } : { kind: 'dayMismatch', update: null };
    }
    if (ours && new Date(game.startDate).getTime() === when.getTime()) return { kind: 'unchanged', update: null };
    return {
        kind: ours ? 'updated' : 'filled',
        update: { $set: { startDate: when, startTimeTbd: false, startTimeSource: SOURCE } }
    };
}

// Fill the TBD games in [start, end] for a season. Never throws for ESPN;
// a database error propagates like any other.
async function fillTipTimes({ season, start, end }) {
    const counts = { candidates: 0, filled: 0, updated: 0, unchanged: 0, reverted: 0,
        espnTbd: 0, dayMismatch: 0, notOnEspn: 0, lost: 0, failedDays: 0, calls: 0 };

    const games = await HoopsGame.find({
        season,
        status: 'scheduled',
        startDate: { $gte: start, $lte: end },
        sourceId: { $nin: [null, ''] },
        $or: [{ startTimeTbd: true }, { startTimeSource: SOURCE }]
    }, { id: 1, sourceId: 1, startDate: 1, startTimeTbd: 1, startTimeSource: 1, _id: 0 }).lean();
    counts.candidates = games.length;
    if (!games.length) return counts;

    const byDay = new Map();
    for (const g of games) {
        const day = dayKey(g.startDate);
        if (!day) continue;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(g);
    }

    const ops = [];
    for (const [day, dayGames] of byDay) {
        let events;
        counts.calls++;
        try {
            events = await fetchDay(day);
        } catch (err) {
            counts.failedDays++;
            console.log(`ESPN tip times · ${day}: ${err.message}`);
            continue;
        }
        for (const g of dayGames) {
            const { kind, update } = decide(g, events.get(String(g.sourceId)), day);
            counts[kind]++;
            if (!update) continue;
            // Unchanged since the read: a CBBD time, or a CBBD move to another
            // day, written in between wins.
            ops.push({ updateOne: {
                filter: { id: g.id, startDate: g.startDate, $or: [{ startTimeTbd: true }, { startTimeSource: SOURCE }] },
                update
            } });
        }
    }

    if (ops.length) {
        const res = await HoopsGame.bulkWrite(ops, { ordered: false });
        counts.lost = ops.length - (res.matchedCount || 0);
    }
    return counts;
}

// For the CBBD ingest: keep an ESPN-filled time when CBBD still says TBD for
// the same Eastern day. Without this every CBBD pull would put the
// placeholder back until the next fill. A CBBD time, or a CBBD move to another
// day, or a game no longer scheduled (postponed, cancelled), goes through
// untouched — and its $unset clears our marker.
async function keepFilledTipTimes(ops) {
    const tbdIds = ops
        .filter(op => op.updateOne && op.updateOne.update.$set && op.updateOne.update.$set.startTimeTbd === true)
        .map(op => op.updateOne.filter.id);
    if (!tbdIds.length) return ops;
    const filled = await HoopsGame.find({ id: { $in: tbdIds }, startTimeSource: SOURCE }, { id: 1, startDate: 1, _id: 0 }).lean();
    if (!filled.length) return ops;
    const dayById = new Map(filled.map(g => [g.id, dayKey(g.startDate)]));

    return ops.map(op => {
        const u = op.updateOne;
        const set = u.update.$set;
        if (!set || set.startTimeTbd !== true || set.status !== 'scheduled' || !dayById.has(u.filter.id)) return op;
        if (dayKey(set.startDate) !== dayById.get(u.filter.id)) return op;
        const keptSet = Object.assign({}, set);
        delete keptSet.startDate;
        delete keptSet.startTimeTbd;
        const unset = Object.assign({}, u.update.$unset || {});
        delete unset.startTimeSource;
        const update = { $set: keptSet };
        if (Object.keys(unset).length) update.$unset = unset;
        return { updateOne: Object.assign({}, u, { update }) };
    });
}

module.exports = { fillTipTimes, keepFilledTipTimes, fetchDay, decide, SOURCE };
