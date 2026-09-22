#!/usr/bin/env node
//
// Prove the new reads return what the old ones return, before any of it ships.
//
//   node scripts/diff-franchise-reads.js
//
// For every read shape the app uses, this fetches the answer BOTH ways — from
// `users` as the app does today, and from accounts/franchises via
// modules/franchise-repo.js — and diffs them field by field.
//
// Why offline rather than shadow reads in production: the evidence is the same,
// and this needs no deploy, adds no code path to a live season, and does not
// double the read load on a shared free-tier cluster. Run it against a database
// that has been migrated (dev, or prod read-only) and it answers the only
// question that matters before the swap — does the app see the same thing?
//
// READ ONLY. It opens no write path and calls nothing that mutates.

if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const mongoose = require('mongoose');
const User = require('../models/user');
const repo = require('../modules/franchise-repo');
const { activeSeason, prime } = require('../modules/active-season');

// Subdocument ids are re-minted on copy and referenced nowhere, so compare on
// content. Same rule modules/account-migration.js verify() uses.
function normalise(value) {
    if (Array.isArray(value)) return value.map(normalise);
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object' && typeof value.toHexString === 'function') {
        return value.toHexString();
    }
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => {
            if (k === '_id' || k === '__v' || k === 'createdAt' || k === 'updatedAt') return;
            out[k] = normalise(value[k]);
        });
        return out;
    }
    return value;
}

// Compare two lists of manager documents, matched on _id.
function diffList(label, oldDocs, newDocs, problems, defaults) {
    const oldById = new Map(oldDocs.map(d => [String(d._id), d]));
    const newById = new Map(newDocs.map(d => [String(d._id), d]));

    if (oldDocs.length !== newDocs.length) {
        problems.push(`${label}: returned ${oldDocs.length} manager(s) the old way, ${newDocs.length} the new way`);
    }
    for (const [id, oldDoc] of oldById) {
        const newDoc = newById.get(id);
        if (!newDoc) { problems.push(`${label}: ${id} missing from the new read`); continue; }
        compareDoc(`${label}:${oldDoc.firstName} ${oldDoc.lastName}`, oldDoc, newDoc, problems, defaults);
    }
    for (const id of newById.keys()) {
        if (!oldById.has(id)) problems.push(`${label}: ${id} appears ONLY in the new read`);
    }
}

// Is the difference only that the new read supplies a schema DEFAULT the stored
// user predates?
//
// The migration writes through the model, so Mongoose fills in defaults; the old
// read is `.lean()` on raw stored data, which does not. A user whose pushPrefs
// predate `recapReady` has no such key, while their Account has `recapReady: true`.
//
// That is benign ONLY where every consumer is default-tolerant. For the two
// fields this actually hits, both are read as `prefs[type] !== false`
// (modules/push-notify.js wantsType, public/push-alerts.js checkbox rendering),
// so undefined and true mean the same thing. A field read as a bare truthy
// check would be a real behaviour change and must NOT be filtered out here.
function isAddedDefaultOnly(before, after) {
    if (before === null || after === null) return false;
    const b = typeof before === 'object' ? before : null;
    const a = typeof after === 'object' ? after : null;
    if (!b || !a) return false;
    // Every key the old side had must be unchanged, and the new side may only
    // have ADDED keys.
    const addedOnly = Object.keys(b).every(k => JSON.stringify(b[k]) === JSON.stringify(a[k]));
    const added = Object.keys(a).filter(k => !(k in b));
    return addedOnly && added.length > 0;
}

function compareDoc(label, oldDoc, newDoc, problems, defaults) {
    // Every field the old read exposes must survive. Extra fields on the new
    // side are reported too — a client that iterates keys would see them.
    const keys = new Set([...Object.keys(oldDoc), ...Object.keys(newDoc)]);
    keys.forEach(k => {
        if (k === '_id' || k === '__v' || k === 'createdAt' || k === 'updatedAt') return;
        const before = JSON.stringify(normalise(oldDoc[k] === undefined ? null : oldDoc[k]));
        const after = JSON.stringify(normalise(newDoc[k] === undefined ? null : newDoc[k]));
        if (before !== after) {
            const brief = (s) => (s && s.length > 120 ? s.slice(0, 120) + '…' : s);
            const oldVal = normalise(oldDoc[k] === undefined ? null : oldDoc[k]);
            const newVal = normalise(newDoc[k] === undefined ? null : newDoc[k]);
            if (defaults && isAddedDefaultOnly(oldVal, newVal)) {
                const added = Object.keys(newVal).filter(key => !(key in oldVal));
                defaults.push(`${label}.${k} gains ${added.join(', ')} (schema default the stored user predates)`);
                return;
            }
            problems.push(`${label}.${k}\n      old: ${brief(before)}\n      new: ${brief(after)}`);
        }
    });
}

async function main() {
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
    await mongoose.connect(process.env.DATABASE_URL, { autoIndex: false, autoCreate: false });
    await prime();

    const season = activeSeason('football');
    const problems = [];
    const defaults = [];
    const checks = [];

    // --- GET /users/season/:year — what the scoring pass and ingest read.
    {
        const oldWay = await User.find(
            { 'seasons.season': { $eq: season } },
            { firstName: 1, lastName: 1, league: 1, lastUpdated: 1, color: 1,
              seasons: { $elemMatch: { season: { $eq: season } } } }
        ).lean();
        const newWay = await repo.bySeason(season);
        // The old projection omits fields the repo returns in full; compare only
        // what the old read actually exposed.
        const trimmed = newWay.map(d => pick(d, Object.keys(oldWay[0] || d)));
        diffList(`/users/season/${season}`, oldWay, trimmed, problems, defaults);
        checks.push([`/users/season/${season}`, oldWay.length]);
    }

    // --- GET /users/league/:code — what standings, My Team and admin read.
    for (const league of ['graham-league', 'claunts-league']) {
        const oldWay = await User.find(
            { 'seasons.season': { $eq: season }, league },
            { firstName: 1, lastName: 1, email: 1, league: 1, lastUpdated: 1, color: 1,
              avatarUrl: 1, profilePrompted: 1,
              seasons: { $elemMatch: { season: { $eq: season } } } }
        ).lean();
        const newWay = await repo.byLeagueAndSeason(league, season);
        const trimmed = newWay.map(d => pick(d, Object.keys(oldWay[0] || d)));
        diffList(`/users/league/${league}`, oldWay, trimmed, problems, defaults);
        checks.push([`/users/league/${league}`, oldWay.length]);
    }

    // --- findById — the profile, captain and PATCH paths.
    {
        const all = await User.find({}, { _id: 1 }).lean();
        for (const { _id } of all) {
            const oldWay = await User.findById(_id).lean();
            const newWay = await repo.byAccountId(_id);
            if (!newWay) { problems.push(`findById ${_id}: nothing came back the new way`); continue; }
            compareDoc(`findById:${oldWay.firstName} ${oldWay.lastName}`, oldWay, newWay, problems, defaults);
        }
        checks.push(['findById (every manager, full document)', all.length]);
    }

    // --- the query the split exists for.
    {
        const all = await User.find({}, { _id: 1, league: 1, firstName: 1 }).lean();
        for (const u of all) {
            const leagues = await repo.leaguesFor(u._id);
            if (u.league && !leagues.includes(u.league)) {
                problems.push(`leaguesFor ${u.firstName}: ${JSON.stringify(leagues)} does not include ${u.league}`);
            }
        }
        checks.push(['leaguesFor (replaces the Auth0 gg/cl flag)', all.length]);
    }

    console.log(`\nactive season: ${season}\n`);
    checks.forEach(([label, n]) => console.log(`  checked  ${String(n).padStart(3)}  ${label}`));

    if (defaults.length) {
        console.log(`\nℹ️  ${defaults.length} field(s) gain a schema default the stored user predates.`);
        console.log('   Benign only where the consumer is default-tolerant — check each:');
        defaults.forEach(d => console.log('   ', d));
    }

    if (problems.length) {
        console.error(`\n❌ ${problems.length} difference(s):\n`);
        problems.slice(0, 40).forEach(p => console.error('   ', p));
        if (problems.length > 40) console.error(`\n    … and ${problems.length - 40} more`);
        process.exitCode = 1;
    } else {
        console.log('\n✅ identical: every read returns the same thing from both sources.');
    }

    await mongoose.disconnect();
}

function pick(doc, keys) {
    const out = {};
    keys.forEach(k => { if (doc[k] !== undefined) out[k] = doc[k]; });
    return out;
}

main().catch(err => { console.error(err); process.exit(1); });
