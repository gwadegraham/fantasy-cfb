// Every league the app knows about, by code, with its editable display name.
//
// This used to be `LEAGUES.map(...)` in server.js — the hardcoded list from
// scoring-defaults, with names overridden from Mongo. A map, not a union, so
// **a league that exists only in the database was dropped entirely**: no name,
// no switcher entry, and no way for an Admin to select it. models/league.js
// says as much in a comment ("the league switcher is still built from the
// hardcoded scoring-defaults LEAGUES list", "stored but INERT"), which was
// fine while the only two leagues were the two in the array.
//
// It stops being fine the moment a basketball league exists, since that league
// is created in Mongo and will never be in scoring-defaults — the hardcoded
// list is tied to the SCORING MODELS (modelForLeague), which is a different
// question from "which leagues exist".
//
// So: a union. The hardcoded entries keep their order and act as the fallback
// when the database is unreachable; anything else in the collection follows.

const League = require('../models/league');
const { LEAGUES } = require('./scoring-defaults');

const DEFAULTS = LEAGUES.map(l => ({ code: l.code, name: l.name, sport: 'football' }));

// Archived leagues are kept for history and must not be offered for play —
// the field has existed on the schema since #312 and nothing has ever read it.
// Honouring it here is what makes "retire a league" a thing you can do without
// deleting anyone's history.
function usable(doc) {
    return doc.status !== 'archived';
}

// Merged list, in display order: the hardcoded leagues first (so the two
// football leagues keep the order they have always rendered in), then anything
// the database adds.
//
// Cached on the request. server.js needs the names and league-selection needs
// the codes, both on the same render, and this is a database round trip on a
// free tier where latency tracks bytes.
async function catalog(req) {
    if (req && req._ccCatalog) return req._ccCatalog;

    let merged = DEFAULTS;
    try {
        const docs = await League.find({}, { code: 1, name: 1, sport: 1, status: 1, _id: 0 }).lean();
        const byCode = new Map(docs.filter(usable).map(d => [d.code, d]));

        // A hardcoded league that has been ARCHIVED in the database drops out;
        // one that is simply absent from the collection keeps its default,
        // because an empty collection must not empty the navbar.
        const archived = new Set(docs.filter(d => !usable(d)).map(d => d.code));

        merged = DEFAULTS
            .filter(d => !archived.has(d.code))
            .map(d => {
                const doc = byCode.get(d.code);
                return doc ? { code: d.code, name: doc.name || d.name, sport: doc.sport || d.sport } : d;
            });

        const seen = new Set(merged.map(l => l.code));
        for (const doc of byCode.values()) {
            if (seen.has(doc.code)) continue;
            merged.push({ code: doc.code, name: doc.name || doc.code, sport: doc.sport || 'football' });
        }
    } catch (e) {
        // The navbar renders on defaults rather than not at all.
        console.error(`league-catalog: ${e.message}`);
    }

    if (req) req._ccCatalog = merged;
    return merged;
}

async function codes(req) {
    return (await catalog(req)).map(l => l.code);
}

module.exports = { catalog, codes, DEFAULTS };
