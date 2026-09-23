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

// The comparison is now literally "flag off vs flag on", which is exactly the
// change a deploy makes. Each read below is taken twice with the switch in each
// position, so what gets diffed is the decision you will actually flip.
function withFlag(on, fn) {
    const before = process.env.FRANCHISE_READS;
    process.env.FRANCHISE_READS = on ? 'true' : 'false';
    return Promise.resolve(fn()).finally(() => {
        if (before === undefined) delete process.env.FRANCHISE_READS;
        else process.env.FRANCHISE_READS = before;
    });
}
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
// Compare three results pairwise: original vs flag-off, and original vs flag-on.
// Both matter — a widening on the flag-off path ships the moment this merges.
async function compareThree(label, original, repoOff, repoOn, problems, defaults) {
    diffList(`${label} [original vs flag-off]`, original, repoOff, problems, defaults);
    diffList(`${label} [original vs flag-on]`, original, repoOn, problems, defaults);
}

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
        // The query as it stood before the swap, written out rather than called.
        const original = await User.find(
            { 'seasons.season': { $eq: season } },
            { firstName: 1, lastName: 1, league: 1, lastUpdated: 1, color: 1,
              seasons: { $elemMatch: { season: { $eq: season } } } }
        ).lean();
        const fields = ['firstName', 'lastName', 'league', 'lastUpdated', 'color', 'seasons'];
        const oldWay = await withFlag(false, () => repo.bySeason(season, { fields }));
        const newWay = await withFlag(true, () => repo.bySeason(season, { fields }));
        await compareThree(`/users/season/${season}`, original, oldWay, newWay, problems, defaults);
        diffList(`/users/season/${season}`, oldWay, newWay, problems, defaults);
        checks.push([`/users/season/${season}`, oldWay.length]);
    }

    // --- GET /users/league/:code — what standings, My Team and admin read.
    for (const league of ['graham-league', 'claunts-league']) {
        const original = await User.find(
            { 'seasons.season': { $eq: season }, league },
            { firstName: 1, lastName: 1, email: 1, league: 1, lastUpdated: 1, color: 1,
              avatarUrl: 1, profilePrompted: 1,
              seasons: { $elemMatch: { season: { $eq: season } } } }
        ).lean();
        const fields = ['firstName', 'lastName', 'email', 'league', 'lastUpdated', 'color',
                        'avatarUrl', 'profilePrompted', 'seasons'];
        const oldWay = await withFlag(false, () => repo.byLeagueAndSeason(league, season, { fields }));
        const newWay = await withFlag(true, () => repo.byLeagueAndSeason(league, season, { fields }));
        await compareThree(`/users/league/${league}`, original, oldWay, newWay, problems, defaults);
        diffList(`/users/league/${league}`, oldWay, newWay, problems, defaults);
        checks.push([`/users/league/${league}`, oldWay.length]);
    }

    // --- findById — the profile, captain and PATCH paths.
    {
        const all = await User.find({}, { _id: 1 }).lean();
        for (const { _id } of all) {
            const original = await User.findById(_id).lean();
            const oldWay = await withFlag(false, () => repo.byAccountId(_id));
            const newWay = await withFlag(true, () => repo.byAccountId(_id));
            compareDoc(`findById:${original.firstName} [original vs flag-off]`, original, oldWay, problems, defaults);
            if (!newWay) { problems.push(`findById ${_id}: nothing came back the new way`); continue; }
            compareDoc(`findById:${oldWay.firstName} ${oldWay.lastName}`, oldWay, newWay, problems, defaults);
        }
        checks.push(['findById (every manager, full document)', all.length]);
    }

    // --- the query the split exists for.
    {
        const all = await User.find({}, { _id: 1, league: 1, firstName: 1 }).lean();
        for (const u of all) {
            const oldLeagues = await withFlag(false, () => repo.leaguesFor(u._id));
            const leagues = await withFlag(true, () => repo.leaguesFor(u._id));
            if (JSON.stringify(oldLeagues) !== JSON.stringify(leagues)) {
                problems.push(`leaguesFor ${u.firstName}: ${JSON.stringify(oldLeagues)} -> ${JSON.stringify(leagues)}`);
            }
            if (u.league && !leagues.includes(u.league)) {
                problems.push(`leaguesFor ${u.firstName}: ${JSON.stringify(leagues)} does not include ${u.league}`);
            }
        }
        checks.push(['leaguesFor (replaces the Auth0 gg/cl flag)', all.length]);
    }

    // ---- the shapes the response-diffing above cannot reach --------------
    //
    // Four call shapes feed a route that transforms the result before
    // responding, so comparing responses structurally cannot see them. They get
    // compared directly against the query each replaced. findManagers matters
    // most: it is the push path, the only one of these that runs unattended
    // against a live Saturday.
    {
        const fields = ['firstName', 'lastName', 'color', 'email', 'authSub',
                        'seasons.season', 'seasons.teams.id', 'seasons.weeklyScore.scoreByTeam'];
        for (const league of ['graham-league', 'claunts-league']) {
            const original = await User.find({ league }, {
                firstName: 1, lastName: 1, color: 1, email: 1, authSub: 1,
                'seasons.season': 1, 'seasons.teams.id': 1, 'seasons.weeklyScore.scoreByTeam': 1
            }).lean();
            const off = await withFlag(false, () => repo.byLeague(league, { fields }));
            const on = await withFlag(true, () => repo.byLeague(league, { fields }));
            await compareThree(`byLeague(${league}) [admin roster]`, original, off, on, problems, defaults);
            checks.push([`byLeague(${league}) — admin roster`, original.length]);
        }
    }

    {
        const teamIds = [];
        (await User.find({ 'seasons.season': season }, { 'seasons.teams.id': 1 }).lean())
            .forEach(u => (u.seasons || []).forEach(sn => (sn.teams || []).forEach(t => teamIds.push(t.id))));

        const fields = ['firstName', 'league', 'pushSubscriptions', 'pushPrefs',
                        'seasons.season', 'seasons.teams.id'];
        const original = await User.find({
            pushSubscriptions: { $exists: true, $ne: [] },
            seasons: { $elemMatch: { season, 'teams.id': { $in: teamIds } } }
        }, {
            firstName: 1, league: 1, pushSubscriptions: 1, pushPrefs: 1,
            'seasons.season': 1, 'seasons.teams.id': 1
        }).lean();

        const args = {
            accountFilter: { pushSubscriptions: { $exists: true, $ne: [] } },
            franchiseFilter: { seasons: { $elemMatch: { season, 'teams.id': { $in: teamIds } } } },
            fields
        };
        const off = await withFlag(false, () => repo.findManagers(args));
        const on = await withFlag(true, () => repo.findManagers(args));
        await compareThree('findManagers [push recipients]', original, off, on, problems, defaults);
        checks.push(['findManagers — push recipients', original.length]);
    }

    {
        const ids = (await User.find({}, { _id: 1 }).lean()).map(u => u._id);
        const fields = ['firstName', 'league', 'avatarUrl', 'seasons.season', 'seasons.franchiseName'];
        const original = await User.find({ _id: { $in: ids } }, {
            firstName: 1, league: 1, avatarUrl: 1, 'seasons.season': 1, 'seasons.franchiseName': 1
        }).lean();
        const off = await withFlag(false, () => repo.byIds(ids, { fields }));
        const on = await withFlag(true, () => repo.byIds(ids, { fields }));
        await compareThree('byIds [betting groups]', original, off, on, problems, defaults);
        checks.push(['byIds — betting groups', original.length]);
    }

    {
        for (const league of ['graham-league', 'claunts-league']) {
            const original = (await User.find({ league }, { color: 1 }).lean())
                .map(u => u.color).filter(Boolean).sort();
            const off = (await withFlag(false, () => repo.usedColors(league))).sort();
            const on = (await withFlag(true, () => repo.usedColors(league))).sort();
            if (JSON.stringify(original) !== JSON.stringify(off)) problems.push(`usedColors(${league}) [original vs flag-off]`);
            if (JSON.stringify(original) !== JSON.stringify(on)) problems.push(`usedColors(${league}) [original vs flag-on]`);
            checks.push([`usedColors(${league})`, original.length]);
        }
    }

    console.log(`\nactive season: ${season}   (original vs flag-off vs flag-on)\n`);
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
