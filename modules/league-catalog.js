// Every league the app knows about, by code, with its editable display name.
//
// This used to be `LEAGUES.map(...)` in server.js — the hardcoded list from
// scoring-defaults, with names overridden from Mongo. A map, not a union, so
// **a league that exists only in the database was dropped entirely**: no name,
// no switcher entry, and no code an Admin could select. models/league.js says
// as much in a comment ("the league switcher is still built from the hardcoded
// scoring-defaults LEAGUES list", "stored but INERT"), which was fine while
// the only two leagues were the two in the array.
//
// It stops being fine the moment a basketball league exists, since that league
// is created in Mongo and will never be in scoring-defaults — the hardcoded
// list is tied to the SCORING MODELS (modelForLeague), which is a different
// question from "which leagues exist".
//
// Deliberately NOT carried here: the league's SPORT. active-season's primed
// cache answers that (sportForLeague), and it is what modules/draft-pool.js
// and modules/draft-socket.js already read — so a copy here would be a second
// source that can disagree with the draft. It would also be stale in the
// opposite direction: this reads per request, that cache refreshes on an
// interval, so a league inserted mid-run would be offered with one sport by
// the switcher and scored with another by the draft. One source.
//
// Two views, deliberately:
//
//   catalog() — the leagues on OFFER. Archived ones are gone.
//   named()   — every league that has ever had a name, archived included.
//
// The split exists because archiving must not degrade the people still in
// that league: they keep their franchise, so they keep seeing its name on
// their pages and in their switcher, while nobody else is offered it.

const League = require('../models/league');
const { LEAGUES } = require('./scoring-defaults');

// Frozen: the merged list is built from these, and several entries are
// returned by identity when Mongo has nothing to say about that code. A
// caller mutating one would corrupt the fallback for every later request.
const DEFAULTS = Object.freeze(
    LEAGUES.map(l => Object.freeze({ code: l.code, name: l.name }))
);

// A league with no code cannot be selected (maySelect rejects the empty
// string) and renders as a blank, unclickable <option>. Both documents in the
// real collection were created by direct insert, so the schema's `required`
// is not a guarantee here.
const valid = (doc) => typeof doc.code === 'string' && doc.code.trim() !== '';

// One read per request. server.js needs the names, league-selection needs the
// codes, and four routes need one or the other — all on the same render, on a
// free tier where latency tracks bytes.
async function docsFor(req) {
    if (req && req._ccLeagueDocs) return req._ccLeagueDocs;
    let docs = [];
    try {
        docs = (await League.find({}, { code: 1, name: 1, status: 1, _id: 0 }).lean())
            .filter(valid);
    } catch (e) {
        // The navbar renders on defaults rather than not at all.
        console.error(`league-catalog: ${e.message}`);
    }
    if (req) req._ccLeagueDocs = docs;
    return docs;
}

function merge(docs, { includeArchived = false } = {}) {
    const byCode = new Map(docs.map(d => [d.code, d]));
    const archived = new Set(
        includeArchived ? [] : docs.filter(d => d.status === 'archived').map(d => d.code)
    );

    // Hardcoded leagues keep their order — the two football leagues have
    // always rendered in it — and act as the fallback when the collection is
    // empty or unreachable. An archived one drops out, or it could never be
    // retired; one merely absent keeps its default, or an empty collection
    // would empty the navbar.
    const merged = DEFAULTS
        .filter(d => !archived.has(d.code))
        .map(d => {
            const doc = byCode.get(d.code);
            return doc ? { code: d.code, name: doc.name || d.name } : d;
        });

    const seen = new Set(merged.map(l => l.code));
    for (const doc of byCode.values()) {
        if (seen.has(doc.code) || archived.has(doc.code)) continue;
        merged.push({ code: doc.code, name: doc.name || doc.code });
    }
    return merged;
}

// The leagues on offer.
async function catalog(req) {
    return merge(await docsFor(req));
}

// Every league with a name, archived included — for RESOLVING a code someone
// already holds, never for offering one. A member whose league was archived
// must not suddenly see a raw slug where its name used to be, nor lose the
// league label from every page header.
async function named(req) {
    return merge(await docsFor(req), { includeArchived: true });
}

async function codes(req) {
    return (await catalog(req)).map(l => l.code);
}

module.exports = { catalog, named, codes, DEFAULTS };
