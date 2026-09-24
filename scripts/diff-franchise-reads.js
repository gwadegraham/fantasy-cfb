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
const { asProjection } = require('../modules/franchise-repo');

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
function normalise(value, depth = 0) {
    if (Array.isArray(value)) return value.map(v => normalise(v, depth + 1));
    if (value instanceof Date) return value.toISOString();
    if (value && typeof value === 'object' && typeof value.toHexString === 'function') {
        return value.toHexString();
    }
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(k => {
            if (k === '__v' || k === 'createdAt' || k === 'updatedAt') return;
            // `_id` is NOT stripped at the top level: "the _id is the ACCOUNT's,
            // not the franchise's" is the contract that breaks every login if it
            // is wrong, and dropping it here made that unfalsifiable. Nested
            // subdocument ids are re-minted on copy and still ignored.
            if (k === '_id' && depth > 0) return;
            out[k] = normalise(value[k], depth + 1);
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
    // Matched on _id rather than position: nothing guarantees `users` and
    // `franchises` come back in the same natural order, and this branch has
    // already lost a round to an assertion that depended on it.
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
    // ARRAYS ARE NOT OBJECTS FOR THIS PURPOSE, even though typeof says they are.
    //
    // Without this, an array that grew at the tail matched "added keys only" and
    // got downgraded to a benign note — so dropping the $elemMatch on a past
    // season read (`seasons: [2025]` becoming `[2025, 2026]`) was reported as a
    // schema default and the script printed its green tick. That is the exact
    // regression this gate exists to catch, and the gate was laundering it.
    if (Array.isArray(before) || Array.isArray(after)) return false;
    const b = typeof before === 'object' ? before : null;
    const a = typeof after === 'object' ? after : null;
    if (!b || !a) return false;
    // Only scalar additions count. An added key whose value is itself an object
    // or array is a shape change, not a default.
    const addedOnly = Object.keys(b).every(k => JSON.stringify(b[k]) === JSON.stringify(a[k]));
    const added = Object.keys(a).filter(k => !(k in b));
    if (!added.length || !addedOnly) return false;
    return added.every(k => a[k] === null || typeof a[k] !== 'object');
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
    // Which repo methods this run actually compared; audited at the end.
    const exercised = new Set();

    // --- GET /users/season/:year — what the scoring pass and ingest read.
    {
        // The query as it stood before the swap, written out rather than called.
        const original = await User.find(
            { 'seasons.season': { $eq: season } },
            { firstName: 1, lastName: 1, league: 1, lastUpdated: 1, color: 1,
              seasons: { $elemMatch: { season: { $eq: season } } } }
        ).lean();
        const fields = ['firstName', 'lastName', 'league', 'lastUpdated', 'color', 'seasons'];
        const oldWay = await withFlag(false, () => (exercised.add('bySeason'), repo.bySeason)(season, { fields }));
        const newWay = await withFlag(true, () => (exercised.add('bySeason'), repo.bySeason)(season, { fields }));
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
        const oldWay = await withFlag(false, () => (exercised.add('byLeagueAndSeason'), repo.byLeagueAndSeason)(league, season, { fields }));
        const newWay = await withFlag(true, () => (exercised.add('byLeagueAndSeason'), repo.byLeagueAndSeason)(league, season, { fields }));
        await compareThree(`/users/league/${league}`, original, oldWay, newWay, problems, defaults);
        diffList(`/users/league/${league}`, oldWay, newWay, problems, defaults);
        checks.push([`/users/league/${league}`, oldWay.length]);
    }

    // --- findById — the profile, captain and PATCH paths.
    {
        const all = await User.find({}, { _id: 1 }).lean();
        for (const { _id } of all) {
            const original = await User.findById(_id).lean();
            const oldWay = await withFlag(false, () => (exercised.add('byAccountId'), repo.byAccountId)(_id));
            const newWay = await withFlag(true, () => (exercised.add('byAccountId'), repo.byAccountId)(_id));
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
            const oldLeagues = await withFlag(false, () => (exercised.add('leaguesFor'), repo.leaguesFor)(u._id));
            const leagues = await withFlag(true, () => (exercised.add('leaguesFor'), repo.leaguesFor)(u._id));
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
            const off = await withFlag(false, () => (exercised.add('byLeague'), repo.byLeague)(league, { fields }));
            const on = await withFlag(true, () => (exercised.add('byLeague'), repo.byLeague)(league, { fields }));
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
        const off = await withFlag(false, () => (exercised.add('findManagers'), repo.findManagers)(args));
        const on = await withFlag(true, () => (exercised.add('findManagers'), repo.findManagers)(args));
        await compareThree('findManagers [push recipients]', original, off, on, problems, defaults);
        checks.push(['findManagers — push recipients', original.length]);
    }

    {
        const ids = (await User.find({}, { _id: 1 }).lean()).map(u => u._id);
        const fields = ['firstName', 'league', 'avatarUrl', 'seasons.season', 'seasons.franchiseName'];
        const original = await User.find({ _id: { $in: ids } }, {
            firstName: 1, league: 1, avatarUrl: 1, 'seasons.season': 1, 'seasons.franchiseName': 1
        }).lean();
        const off = await withFlag(false, () => (exercised.add('byIds'), repo.byIds)(ids, { fields }));
        const on = await withFlag(true, () => (exercised.add('byIds'), repo.byIds)(ids, { fields }));
        await compareThree('byIds [betting groups]', original, off, on, problems, defaults);
        checks.push(['byIds — betting groups', original.length]);
    }

    {
        for (const league of ['graham-league', 'claunts-league']) {
            const original = (await User.find({ league }, { color: 1 }).lean())
                .map(u => u.color).filter(Boolean).sort();
            const off = (await withFlag(false, () => (exercised.add('usedColors'), repo.usedColors)(league))).sort();
            const on = (await withFlag(true, () => (exercised.add('usedColors'), repo.usedColors)(league))).sort();
            if (JSON.stringify(original) !== JSON.stringify(off)) problems.push(`usedColors(${league}) [original vs flag-off]`);
            if (JSON.stringify(original) !== JSON.stringify(on)) problems.push(`usedColors(${league}) [original vs flag-on]`);
            checks.push([`usedColors(${league})`, original.length]);
        }
    }

    // byAccountId WITH a field list — 10 call sites (navUser, both invite paths,
    // /me/push, the push test send, and the two login-path reads). Only the
    // no-fields form was diffed, which is how a silent widening lived here
    // through two reviews.
    //
    // The two login shapes are the ones that decide whether anyone gets in at
    // all. 'identity-guard' asks for one field and compares it against the
    // login's email; a read that stops returning it does not error, it makes
    // every session look unverifiable and waves the wrong ones through.
    // 'invite-bind' straddles both documents — email and authSub off the
    // account, league off the franchise — and each of those fields is a refusal
    // decideInvite would otherwise stop making.
    {
        const shapes = [
            ['navUser', ['avatarUrl', 'color', 'firstName', 'lastName', 'authSub']],
            ['invite-link', ['league', 'firstName', 'lastName', 'authSub']],
            ['/me/push', ['pushSubscriptions', 'pushPrefs', 'seasons.season']],
            ['push test send', ['pushSubscriptions', 'firstName']],
            ['identity-guard', ['email']],
            ['invite-bind', ['email', 'league', 'authSub', 'firstName']]
        ];
        const all = await User.find({}, { _id: 1 }).lean();
        for (const [label, fields] of shapes) {
            for (const { _id } of all) {
                const original = await User.findById(_id, asProjection(fields)).lean();
                const off = await withFlag(false, () => (exercised.add('byAccountId'), repo.byAccountId)(_id, { fields }));
                const on = await withFlag(true, () => (exercised.add('byAccountId'), repo.byAccountId)(_id, { fields }));
                compareDoc(`byAccountId ${label} [original vs flag-off]`, original, off, problems, defaults);
                compareDoc(`byAccountId ${label} [original vs flag-on]`, original, on, problems, defaults);
            }
            checks.push([`byAccountId — ${label}`, all.length]);
        }
    }

    // anyFranchise — modules/season-status.js, the gate on destructive
    // mid-season edits. Untested on either path until now.
    {
        for (const league of ['graham-league', 'claunts-league']) {
            const filter = { league, seasons: { $elemMatch: { season, 'weeklyScore.scoreByTeam.0': { $exists: true } } } };
            const original = !!(await User.exists(filter));
            const off = await withFlag(false, () => (exercised.add('anyFranchise'), repo.anyFranchise)(filter));
            const on = await withFlag(true, () => (exercised.add('anyFranchise'), repo.anyFranchise)(filter));
            if (original !== off) problems.push(`anyFranchise(${league}) [original vs flag-off]: ${original} -> ${off}`);
            if (original !== on) problems.push(`anyFranchise(${league}) [original vs flag-on]: ${original} -> ${on}`);
            checks.push([`anyFranchise(${league}) — mid-season edit gate`, 1]);
        }
    }

    // byLeagueAndSeasonForAccount — GET /users/:id/season.
    {
        const fields = ['firstName', 'lastName', 'league', 'lastUpdated', 'color', 'seasons'];
        for (const { _id } of await User.find({}, { _id: 1 }).lean()) {
            const original = await User.find(
                { _id, 'seasons.season': season },
                { firstName: 1, lastName: 1, league: 1, lastUpdated: 1, color: 1,
                  seasons: { $elemMatch: { season } } }
            ).lean();
            const off = await withFlag(false, () => (exercised.add('byLeagueAndSeasonForAccount'), repo.byLeagueAndSeasonForAccount)(_id, season, { fields }));
            const on = await withFlag(true, () => repo.byLeagueAndSeasonForAccount(_id, season, { fields }));
            await compareThree('byLeagueAndSeasonForAccount [/users/:id/season]', original, off, on, problems, defaults);
        }
        checks.push(['byLeagueAndSeasonForAccount — /users/:id/season', 13]);
    }

    // all() — the bare GET /users listing, unprojected on both sides.
    {
        const original = await User.find({}).lean();
        const off = await withFlag(false, () => (exercised.add('all'), repo.all)());
        const on = await withFlag(true, () => repo.all());
        await compareThree('all [GET /users]', original, off, on, problems, defaults);
        checks.push(['all — GET /users', original.length]);
    }

    // The two push-ledger findManagers shapes. These carry captainReminders and
    // recapNotices — the per-franchise send ledgers, and the highest-consequence
    // fields the moment the flag ever flips, because getting them wrong re-sends
    // a notification on every tick.
    {
        const shapes = [
            ['captain locks', {
                firstName: 1, league: 1, pushSubscriptions: 1, pushPrefs: 1, captainReminders: 1,
                'seasons.season': 1, 'seasons.teams.id': 1, 'seasons.teams.school': 1,
                'seasons.captains': 1, 'seasons.weeklyScore': 1
            }, ['firstName', 'league', 'pushSubscriptions', 'pushPrefs', 'captainReminders',
                'seasons.season', 'seasons.teams.id', 'seasons.teams.school',
                'seasons.captains', 'seasons.weeklyScore']],
            ['recap ready', {
                firstName: 1, league: 1, pushSubscriptions: 1, pushPrefs: 1, recapNotices: 1
            }, ['firstName', 'league', 'pushSubscriptions', 'pushPrefs', 'recapNotices']]
        ];
        for (const [label, projection, fields] of shapes) {
            const original = await User.find({
                pushSubscriptions: { $exists: true, $ne: [] },
                seasons: { $elemMatch: { season } }
            }, projection).lean();
            const args = {
                accountFilter: { pushSubscriptions: { $exists: true, $ne: [] } },
                franchiseFilter: { seasons: { $elemMatch: { season } } },
                fields
            };
            const off = await withFlag(false, () => repo.findManagers(args));
            const on = await withFlag(true, () => repo.findManagers(args));
            await compareThree(`findManagers [${label}]`, original, off, on, problems, defaults);
            checks.push([`findManagers — ${label}`, original.length]);
        }
    }

    // --- the two aggregation pipelines (routes/standings.js, routes/scores.js).
    //
    // Written out here against `users` as they stood before the swap, because
    // these are the only reads where the repo does not assemble a document from
    // two finds — it runs a $lookup, and a $lookup can differ from an assembly
    // in ways the other comparisons would never reach: a franchise with no
    // account survives it, and $mergeObjects can let a stray account key win.
    {
        for (const league of ['graham-league', 'claunts-league']) {
            const original = await User.aggregate([
                { $match: { league, 'seasons.season': season } },
                { $project: {
                    firstName: 1, lastName: 1, avatarUrl: 1, color: 1,
                    seasons: { $map: {
                        input: { $filter: { input: { $ifNull: ['$seasons', []] }, as: 's',
                                            cond: { $in: ['$$s.season', [season, String(season)]] } } },
                        as: 's',
                        in: {
                            season: '$$s.season',
                            franchiseName: '$$s.franchiseName',
                            cumulativeScore: '$$s.cumulativeScore',
                            teams: { $map: { input: { $ifNull: ['$$s.teams', []] }, as: 't',
                                             in: { id: '$$t.id', school: '$$t.school' } } }
                        }
                    } }
                } }
            ]);
            const off = await withFlag(false, () => (exercised.add('projectionManagers'), repo.projectionManagers)(league, season));
            const on = await withFlag(true, () => (exercised.add('projectionManagers'), repo.projectionManagers)(league, season));
            await compareThree(`projectionManagers(${league})`, original, off, on, problems, defaults);
            // A league with nobody in the active season compares three empty
            // lists and prints a green `checked 0`. leaguesWithSeason got this
            // gate and these two did not, which is the same "green tick that
            // means nothing was checked" this script exists to prevent.
            if (!original.length) {
                problems.push(`projectionManagers(${league}): no managers in ${season} — nothing was compared`);
            }
            checks.push([`projectionManagers(${league}) — standings projections`, original.length]);
        }
    }

    {
        for (const league of ['graham-league', 'claunts-league']) {
            const original = await User.aggregate([
                { $match: { league, 'seasons.season': season } },
                { $project: {
                    seasons: { $map: {
                        input: { $filter: { input: { $ifNull: ['$seasons', []] }, as: 's',
                                            cond: { $eq: ['$$s.season', season] } } },
                        as: 's',
                        in: {
                            season: '$$s.season',
                            teams: { $map: { input: { $ifNull: ['$$s.teams', []] }, as: 't',
                                             in: { id: '$$t.id' } } },
                            weeklyScore: { $ifNull: ['$$s.weeklyScore', []] }
                        }
                    } }
                } }
            ]);
            const off = await withFlag(false, () => (exercised.add('h2hManagers'), repo.h2hManagers)(league, season));
            const on = await withFlag(true, () => (exercised.add('h2hManagers'), repo.h2hManagers)(league, season));
            await compareThree(`h2hManagers(${league})`, original, off, on, problems, defaults);
            if (!original.length) {
                problems.push(`h2hManagers(${league}): no managers in ${season} — nothing was compared`);
            }
            checks.push([`h2hManagers(${league}) — H2H bonus pass`, original.length]);

            // The H2H pass writes back with User.updateOne({ _id: user._id }).
            // An _id that is not the ACCOUNT's silently matches nothing and the
            // bonus is never stored — the route logs that, but only per manager.
            // compareThree matches ON _id, so it would report this as "missing
            // from the new read" rather than naming the cause.
            const accountIds = new Set((await User.find({ league }, { _id: 1 }).lean()).map(u => String(u._id)));
            for (const doc of on) {
                if (!accountIds.has(String(doc._id))) {
                    problems.push(`h2hManagers(${league}): _id ${doc._id} is not an account id — ` +
                                  `the weeklyScore write would match nothing`);
                }
            }
        }
    }

    // --- leaguesWithSeason — drives the H2H pass's per-league loop.
    {
        const original = (await User.distinct('league', { 'seasons.season': season })).filter(Boolean).sort();
        const off = await withFlag(false, () => (exercised.add('leaguesWithSeason'), repo.leaguesWithSeason)(season));
        const on = await withFlag(true, () => (exercised.add('leaguesWithSeason'), repo.leaguesWithSeason)(season));
        if (JSON.stringify(original) !== JSON.stringify(off)) {
            problems.push(`leaguesWithSeason [original vs flag-off]: ${original} vs ${off}`);
        }
        if (JSON.stringify(original) !== JSON.stringify(on)) {
            problems.push(`leaguesWithSeason [original vs flag-on]: ${original} vs ${on}`);
        }
        // An empty list is not a pass. The H2H pass loops over this; zero
        // leagues is a silent no-op that reports success, which is the exact
        // failure routes/scores.js already logs a warning for.
        if (!original.length) problems.push('leaguesWithSeason: no leagues for the active season — nothing was compared');
        checks.push(['leaguesWithSeason — H2H per-league loop', original.length]);
    }

    // Every exported read must be exercised above.
    //
    // The gap three reviews kept finding was never a wrong comparison — it was a
    // shape nobody had listed. Enumerating by hand means an unlisted read is
    // invisible AND unmentioned, so the green tick reads as "the swap is safe"
    // when it means "the reads I remembered match". Checking the module's own
    // exports turns a forgotten shape into a failure instead of a silence.
    const READ_METHODS = ['bySeason', 'byLeagueAndSeason', 'byLeagueAndSeasonForAccount',
        'byAccountId', 'byLeague', 'byIds', 'all', 'leaguesFor', 'findManagers',
        'usedColors', 'anyFranchise', 'projectionManagers', 'h2hManagers', 'leaguesWithSeason'];
    const unexercised = READ_METHODS.filter(m => !exercised.has(m));
    if (unexercised.length) {
        problems.push(`read shapes never compared: ${unexercised.join(', ')} — ` +
                      `add them here, or this script's pass means less than it looks`);
    }
    const unknown = READ_METHODS.filter(m => typeof repo[m] !== 'function');
    if (unknown.length) {
        problems.push(`listed but not exported by the repo: ${unknown.join(', ')}`);
    }
    const exportedReads = Object.keys(repo).filter(k =>
        typeof repo[k] === 'function' && !READ_METHODS.includes(k) &&
        !['toUserShape', 'hydrate', 'keepOnly', 'asProjection', 'seasonScopedProjection',
          'franchiseSideOf', 'userProjection', 'readsFromFranchises'].includes(k));
    if (exportedReads.length) {
        problems.push(`repo exports a read this script does not know about: ${exportedReads.join(', ')}`);
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


main().catch(err => { console.error(err); process.exit(1); });
