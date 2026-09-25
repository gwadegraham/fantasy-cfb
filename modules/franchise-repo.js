// Reading managers out of Account + Franchise, in the shape the app already
// expects (#313 phase 2).
//
// Phase 1 copied every User into an Account (the person) and a Franchise (their
// entry in one league). Nothing read those copies. This module is what starts
// reading them — and it deliberately returns a document shaped EXACTLY like the
// User it replaces, because the alternative is rewriting every caller and every
// client at the same time as changing where the data lives.
//
// ---- why the shape is preserved rather than improved ----
//
// The client only calls a handful of /users/* endpoints. If those endpoints
// return byte-identical JSON, every page keeps working with no change at all,
// and the swap can be verified by diffing responses rather than by clicking
// through the app hoping to notice. Improving the shape is a separate job that
// can happen later, one caller at a time, with the storage question already
// settled. Doing both at once means a bug could be in either and you cannot
// tell which.
//
// ---- reads only ----
//
// Nothing here writes. Writes stay on `users` until the whole app reads from
// here, because the issue forbids dual-writing: two competing sources of truth
// for live scoring is worse than the problem being solved. The write swap is a
// single later step, and it is the irreversible one.

const Account = require('../models/account');
const Franchise = require('../models/franchise');
const User = require('../models/user');

// ---- the switch -------------------------------------------------------------
//
// Which collection managers are read from AND written to. UNSET MEANS USERS —
// the old path — so deploying this changes nothing.
//
// This comment used to say, in capitals, never to set it in production. That was
// correct then and is not now, and the difference is the whole of #313 phase 3.
// It said so because the flag governed READS while writes always went to
// `users`: flag-on meant reading a migration-era snapshot and writing somewhere
// else, which for routes/scores.js destroys data rather than merely misreporting
// it (applyAwards returns weeklyScore as a COMPLETE replacement, so a manager
// with five scored weeks whose snapshot holds three is left with three).
//
// Writes now follow the flag. There is one source of truth at any moment and the
// two halves cannot disagree about which. Nothing dual-writes.
//
// ---- what it still is NOT --------------------------------------------------
//
// Not reversible in general. Flip on, let an hour of scoring run, and flipping
// back silently reverts that hour — `users` will not have seen any of it, and
// nothing errors to say so. The window in which flipping back is cheap is
// measured in seconds, not hours.
//
// Not safe to flip against a stale copy. `accounts` and `franchises` hold
// whatever scripts/migrate-accounts.js last wrote. It upserts by
// (accountId, league) and UPDATES existing rows, so re-running it re-syncs —
// and it must be re-run immediately before the flip or the app starts serving
// however far behind they are.
//
// ---- the cutover -----------------------------------------------------------
//
//   1. Deploy this code with the var unset. Nothing changes; verify that.
//   2. heroku run -a fantasy-cfb "node scripts/migrate-accounts.js"
//      Dry run. Read the drift: every manager should show accountAction
//      'update', and the field-routing guards must pass. QUOTE THE WHOLE
//      COMMAND — unquoted, the heroku CLI eats the flags as its own.
//   3. heroku run -a fantasy-cfb "node scripts/migrate-accounts.js --apply --yes"
//      --apply verifies and fingerprints on its own, so a separate --verify pass
//      is optional. --yes matters: without a TTY the database-name prompt exits
//      1 having written NOTHING, which reads like a no-op and is not one.
//   4. heroku config:set FRANCHISE_READS=true -a fantasy-cfb
//   5. node scripts/diff-franchise-reads.js against a dev copy synced from prod
//      — positive confirmation, rather than only watching for symptoms.
//   6. Then watch. A block from modules/identity-guard.js, a second Captain
//      reminder inside one week, or a standings table that stops moving all mean
//      flip back: heroku config:unset FRANCHISE_READS -a fantasy-cfb.
//      ⚠️ Flipping back REVERTS everything written since the flip — `users` has
//      not seen any of it and nothing errors to say so. Minutes are cheap;
//      hours are not.
//
// ---- WHEN ------------------------------------------------------------------
//
// Step 4 restarts the dyno. In-flight requests are SIGTERMed and any job mid-run
// dies where it stands, so the hour matters as much as the day. From
// modules/scheduler.js:
//
//   daily-scores      23:00 CT nightly      the heaviest write in the app
//   captain-reminder  :00 and :30, always   writes the franchise ledger
//   recap-notice      Mon 07:05 and 19:05
//
// So: midweek, never a game day, and flip at around :10 past an hour that is not
// 23:00 — that is the widest clear gap between reminder ticks. A flip at 23:05
// on a Wednesday kills the nightly pass mid-loop with some managers written and
// the rest not.
//
// One web dyno today, so there is no window where two dynos disagree about the
// flag. That stops being true the moment the app scales out, and a rolling
// restart that splits reads and writes across collections is the exact
// divergence this module spends forty lines warning about.
//
// ONE definition, read PER CALL. Both deliberate: this repo has been bitten by
// LIVE_POLL_ENABLED, where modules/scheduler.js treated unset as OFF and
// modules/live-poll.js treated it as ON, so the poller believed it was enabled
// while never being scheduled and nothing logged a word.
function readsFromFranchises() {
    return process.env.FRANCHISE_READS === 'true';
}

// The SAME switch, under a name that reads correctly at a write call site.
//
// An alias, and it must stay one. It is tempting to give the write side its own
// `process.env.FRANCHISE_WRITES` so the two could be staged independently — that
// is exactly the bug this module already warns about a few lines up, where
// modules/scheduler.js and modules/live-poll.js disagreed about LIVE_POLL_ENABLED
// and the poller believed it was enabled while never being scheduled.
//
// Here the consequence is worse than a silent no-op. Reads and writes pointing
// at different collections is precisely the divergence the whole cutover exists
// to avoid: with reads on the new source and writes on the old, the H2H pass
// overwrites a live weeklyScore with a stale one. One variable, one answer, both
// halves.
function writesToFranchises() {
    return readsFromFranchises();
}

// Fields that live on the Account, mirroring modules/account-migration.js.
// Kept in sync deliberately: if the migration routes a field somewhere, this
// has to read it back from the same place.
const ACCOUNT_FIELDS = ['firstName', 'lastName', 'email', 'authSub', 'avatarUrl',
    'profilePrompted', 'color', 'pushSubscriptions', 'pushPrefs'];
const FRANCHISE_FIELDS = ['isUpdated', 'lastUpdated', 'captainReminders', 'recapNotices'];

// What a LIST read exposes — deliberately narrower than the full document.
//
// The /users list endpoints have always projected these and only these, which
// keeps three things off responses that reach the browser: `authSub` (the Auth0
// subject), `pushSubscriptions` (push endpoints and their encryption keys), and
// the per-league send ledgers. Assembling from the account without narrowing
// would have started shipping all of them to every manager's Standings page.
//
// The single-document read (byAccountId) is NOT narrowed, because
// User.findById() was not either — the routes that use it do their own
// projecting, and the admin roster needs authSub to report `linked`.
const LIST_ACCOUNT_FIELDS = ['firstName', 'lastName', 'email', 'avatarUrl', 'profilePrompted', 'color'];
const LIST_FRANCHISE_FIELDS = ['isUpdated', 'lastUpdated'];

// One manager, in User shape.
//
// `_id` comes from the ACCOUNT, not the franchise — it is the id Auth0 points
// at and the id every existing client, link and localStorage key already holds.
// Using the franchise's own id here would break logins and every /userHome?user=
// URL in the wild.
function toUserShape(account, franchise, { list = false, explicit = false } = {}) {
    if (!account) return null;
    // `explicit` means the caller named its fields, so the list defaults must
    // not trim what was asked for — see the note in hydrate.
    const accountFields = (list && !explicit) ? LIST_ACCOUNT_FIELDS : ACCOUNT_FIELDS;
    const franchiseFields = (list && !explicit) ? LIST_FRANCHISE_FIELDS : FRANCHISE_FIELDS;

    const doc = { _id: account._id };
    accountFields.forEach(f => { if (account[f] !== undefined) doc[f] = account[f]; });
    if (franchise) {
        doc.league = franchise.league;
        doc.seasons = franchise.seasons || [];
        franchiseFields.forEach(f => { if (franchise[f] !== undefined) doc[f] = franchise[f]; });
    }
    return doc;
}

// Everyone in a league who has an entry for `season`, in User shape.
//
// Replaces: User.find({ 'seasons.season': season, league }, { …, seasons: { $elemMatch } })
// The $elemMatch projection is reproduced here rather than dropped — callers
// index straight into seasons[0] via public/season-of.js, and a full seasons
// array would silently hand them the wrong year.
async function byLeagueAndSeason(league, season, { projectSeason = true, fields } = {}) {
    if (!readsFromFranchises()) {
        return User.find(
            { league, 'seasons.season': season },
            fields
                ? (projectSeason ? seasonScopedProjection(fields, season) : asProjection(fields))
                : (projectSeason ? userProjection(season) : null)
        ).lean();
    }
    // This was the one method whose flag-on branch ignored `fields` and
    // hardcoded its projection, so a caller asking for captainReminders got
    // them with the flag off and not with it on — and `projectSeason: false`
    // plus fields returned EVERY season, which is the "callers index seasons[0],
    // wrong year served silently" failure this module warns about in four
    // places. Both halves now read the same arguments.
    const query = { league, 'seasons.season': season };
    const projection = fields
        ? (projectSeason
            ? Object.assign(seasonScopedProjection(franchiseSideOf(fields), season), { accountId: 1 })
            : asProjection(franchiseSideOf(fields).concat('accountId')))
        : (projectSeason
            ? { accountId: 1, league: 1, isUpdated: 1, lastUpdated: 1, seasons: { $elemMatch: { season } } }
            : null);
    const franchises = await Franchise.find(query, projection).lean();
    return hydrate(franchises, { list: !!(fields || projectSeason), fields });
}

// A caller's field list plus the season projection they were already getting.
// Callers that named their fields did so to keep a ~100KB document off the
// wire; honouring that is the difference between moving the storage and
// quietly making every standings read heavier.
function seasonScopedProjection(fields, season) {
    const projection = asProjection(fields.filter(f => f !== 'seasons'));
    if (fields.includes('seasons')) projection.seasons = { $elemMatch: { season } };
    return projection;
}

// Everyone with an entry for `season`, any league. Replaces
// GET /users/season/:year, which the scoring pass and the ingest read.
async function bySeason(season, { projectSeason = true, fields } = {}) {
    if (!readsFromFranchises()) {
        return User.find(
            { 'seasons.season': season },
            fields
                ? (projectSeason ? seasonScopedProjection(fields, season) : asProjection(fields))
                : (projectSeason ? userProjection(season) : null)
        ).lean();
    }
    // Asking for `seasons` by name must NOT lose the season narrowing — callers
    // index seasons[0] through public/season-of.js, so returning every season
    // silently serves the wrong year. byLeagueAndSeason already did this; this
    // did not, and a test caught it reading 2025's entry as the current one.
    const projection = fields
        ? (projectSeason
            ? Object.assign(seasonScopedProjection(franchiseSideOf(fields), season), { accountId: 1 })
            : asProjection(franchiseSideOf(fields).concat('accountId')))
        : (projectSeason
            ? { accountId: 1, league: 1, isUpdated: 1, lastUpdated: 1, seasons: { $elemMatch: { season } } }
            : null);
    // `projectSeason: false` replaces an UNPROJECTED User.find, so it has to
    // return whole documents — narrowing here would be the same parity break as
    // on the two listing endpoints, just quieter.
    const franchises = await Franchise.find({ 'seasons.season': season }, projection).lean();
    return hydrate(franchises, { list: !!(fields || projectSeason), fields });
}

// One manager by their account id — the id Auth0 hands us.
//
// `league` is optional: with one franchise per person it is unambiguous, and
// omitting it is what keeps every existing caller working. Once a person can
// hold two, the callers that care will have to say which, and the ones that
// don't will need to stop guessing. That is the real work phase 2 defers, and
// naming it here beats discovering it later.
async function byAccountId(accountId, { league, fields } = {}) {
    // `fields` is not a nicety. A manager document carries their full roster —
    // every team object with its venue subdocument — so an unprojected read is
    // ~100KB, and several callers project down to a handful of keys precisely
    // because of that (see the note on GET /users/me/push). Dropping the
    // projection while moving the storage would undo deliberate work on a
    // free-tier cluster that also serves a 30-second poller.
    if (!readsFromFranchises()) {
        return User.findById(accountId, fields ? asProjection(fields) : null).lean();
    }

    // Matched on the ROOT of a dotted path, via the same helper the other reads
    // use. Comparing whole strings meant 'seasons.season' was not recognised as
    // franchise-side, so the franchise query was skipped entirely and the caller
    // got NO seasons — which on GET /users/me/push silently turns "you have a
    // roster this season" into false.
    const roots = fields && new Set(fields.map(f => f.split('.')[0]));
    const accountFields = fields && ACCOUNT_FIELDS.filter(f => roots.has(f));
    const franchiseFields = fields && franchiseSideOf(fields);

    const account = await Account.findById(
        accountId,
        accountFields ? asProjection(accountFields) : null
    ).lean();
    if (!account) return null;

    // No franchise-side field asked for means don't go and get one. An empty
    // projection object means "every field" to Mongo, so passing one through
    // would have fetched the whole franchise — rosters and all — for a caller
    // that only wanted a push subscription. Skipping the query entirely is both
    // the correct answer and one round trip cheaper.
    if (fields && !franchiseFields.length) return keepOnly(toUserShape(account, null), fields);

    const filter = league ? { accountId, league } : { accountId };
    const franchise = await Franchise.findOne(
        filter,
        franchiseFields && franchiseFields.length ? asProjection(franchiseFields) : null
    ).lean();
    // Trimmed like every other fields-taking read. Without this, flag-on added a
    // `seasons: []` key that flag-off did not have — a silent widening, which is
    // the thing this branch keeps being caught by.
    const shaped = toUserShape(account, franchise);
    return fields ? keepOnly(shaped, fields) : shaped;
}

// Everyone's colour in a league, and nothing else.
//
// Its own method rather than byLeague({ fields }) because the caller wants one
// scalar per manager and byLeague returns whole documents — which here would be
// megabytes of roster to choose a hex code.
async function usedColors(league) {
    if (!readsFromFranchises()) {
        const users = await User.find({ league }, { color: 1 }).lean();
        return users.map(u => u.color).filter(Boolean);
    }
    const franchises = await Franchise.find({ league }, { accountId: 1, _id: 0 }).lean();
    if (!franchises.length) return [];
    const accounts = await Account.find(
        { _id: { $in: franchises.map(f => f.accountId) } },
        { color: 1, _id: 0 }
    ).lean();
    return accounts.map(a => a.color).filter(Boolean);
}

// A field list as a Mongo projection. Dotted paths are passed through, so a
// caller can ask for 'seasons.season' and still get the slim read they wanted.
function asProjection(fields) {
    // `{}` means EVERY field to Mongo, so an empty list must never become an
    // empty projection — that turns "I want nothing from here" into "give me
    // all of it", which is how a narrowed read quietly becomes a full one.
    // `_id` alone is the honest encoding of an empty request.
    if (!fields.length) return { _id: 1 };
    return fields.reduce((acc, f) => Object.assign(acc, { [f]: 1 }), {});
}

// Everyone in a league, whatever season — the roster views and colour picker,
// which care about membership rather than about a particular year.
//
// `list: false` widens it to the full account, for the admin roster: it reports
// whether a manager is `linked` and needs authSub to know. That is the one list
// read that legitimately wants a credential, and it never sends it raw.
// `list` defaults to FALSE here, unlike the season-scoped reads.
//
// The endpoints this replaces — GET /users and GET /users/league/:code/all —
// ran `User.find()` with NO projection, so they returned whole documents,
// authSub and all. Narrowing them would be an improvement, and it is not what a
// storage swap should be doing: parity is the contract that makes flipping the
// flag a non-event. The pre-existing over-exposure on those two is worth fixing
// on its own, where the change is visible as a change.
// No `list` option, deliberately. It used to take one, no caller passed it, and
// the two paths disagreed about what it meant — flag-off returned
// userProjection(), which has no `seasons` key at all, while flag-on returned
// every season. A parameter nobody uses and nobody agrees on is a trap for
// whoever tries it first.
async function byLeague(league, { fields } = {}) {
    if (!readsFromFranchises()) {
        return User.find({ league }, fields ? asProjection(fields) : null).lean();
    }
    // Projected at the query. Narrowing only in keepOnly afterwards still pulled
    // whole franchises — rosters, weekly scores and all — so the admin roster
    // read was fixed on the flag-off path and left heavy on this one.
    const franchises = await Franchise.find(
        { league },
        fields ? asProjection(franchiseSideOf(fields).concat('accountId')) : null
    ).lean();
    return hydrate(franchises, { list: false, fields });
}

// Managers matching conditions on BOTH halves at once.
//
// The other methods here are conveniences over one collection. This is the
// primitive for the case they cannot express: a query whose conditions are
// split across the two documents. modules/push-notify.js is the live example —
// it wants managers who have a push subscription (an ACCOUNT field) AND a
// rostered team playing this week (a FRANCHISE field), which was one `find`
// while both lived on the same document.
//
// Franchise-side filtering happens FIRST on purpose. The roster condition is
// far more selective than "has any subscription", so narrowing there means the
// account query is a small `$in` rather than a scan — which matters, because
// push-notify runs this once per game per tick against a cluster capped around
// 85 KB/s, and says so in its own comments.
async function findManagers({ accountFilter = {}, franchiseFilter = {}, fields } = {}) {
    if (!readsFromFranchises()) {
        // One document, so the two halves recombine into a single query.
        const merged = Object.assign({}, accountFilter, franchiseFilter);
        return User.find(merged, fields ? asProjection(fields) : null).lean();
    }

    const franchises = await Franchise.find(
        franchiseFilter,
        fields ? asProjection(franchiseSideOf(fields).concat('accountId')) : null
    ).lean();
    if (!franchises.length) return [];

    const ids = franchises.map(f => f.accountId);
    const accountRoots = fields && new Set(fields.map(f => f.split('.')[0]));
    const wanted = accountRoots ? ACCOUNT_FIELDS.filter(f => accountRoots.has(f)) : ACCOUNT_FIELDS;
    // $and rather than a merge, so an accountFilter carrying its own `_id` — the
    // PUSH_RECIPIENT_IDS narrowing does exactly that — does not replace the
    // franchise-derived `$in`.
    //
    // This is a SELECTIVITY guard, not a correctness one, and the distinction
    // matters because it cannot be tested through the return value: the
    // franchise-side intersection below makes both forms produce the same
    // managers. A merge would simply scan every account instead of the handful
    // the franchises named. Believing a test could catch it is how it would get
    // reverted by someone tidying.
    const accounts = await Account.find(
        { $and: [{ _id: { $in: ids } }, accountFilter] },
        fields ? asProjection(wanted) : null
    ).lean();

    // An account that failed accountFilter drops its franchise with it — the
    // original query required both conditions of one document, so requiring
    // both here is the same answer.
    const byId = new Map(accounts.map(a => [String(a._id), a]));
    return franchises
        .map(f => (byId.has(String(f.accountId)) ? toUserShape(byId.get(String(f.accountId)), f) : null))
        .filter(Boolean)
        .map(doc => (fields ? keepOnly(doc, fields) : doc));
}

// One manager, one season, as an ARRAY — the shape GET /users/:id/season
// returns, where the client indexes [0].
//
// Season-scoped at the query. Fetching every season and filtering in JS gives
// the same answer and reads ~4x the bytes, which is the sort of thing that only
// shows up as a slow Saturday.
async function byLeagueAndSeasonForAccount(accountId, season, { fields } = {}) {
    if (!readsFromFranchises()) {
        return User.find(
            { _id: accountId, 'seasons.season': season },
            fields ? seasonScopedProjection(fields, season) : userProjection(season)
        ).lean();
    }
    const franchise = await Franchise.findOne(
        { accountId, 'seasons.season': season },
        fields
            ? Object.assign(seasonScopedProjection(franchiseSideOf(fields), season), { accountId: 1 })
            : { accountId: 1, league: 1, seasons: { $elemMatch: { season } } }
    ).lean();
    if (!franchise) return [];
    return hydrate([franchise], { list: true, fields });
}

// Specific managers by account id — the betting-group membership read, which
// is keyed on ids rather than on a league.
async function byIds(ids, { fields } = {}) {
    if (!readsFromFranchises()) {
        return User.find({ _id: { $in: ids } }, fields ? asProjection(fields) : null).lean();
    }
    // Franchise-side fields projected at the query, dotted paths included, so a
    // caller asking for seasons.franchiseName does not get every roster.
    const franchises = await Franchise.find(
        { accountId: { $in: ids } },
        fields ? asProjection(franchiseSideOf(fields).concat('accountId')) : null
    ).lean();
    return hydrate(franchises, { list: true, fields });
}

// The requested fields that live on the franchise rather than the account,
// keeping dotted paths intact.
function franchiseSideOf(fields) {
    return fields.filter(f => {
        const root = f.split('.')[0];
        return root === 'league' || root === 'seasons' || FRANCHISE_FIELDS.includes(root);
    });
}

// Every manager, any league. The bare GET /users listing.
// Same: no `list` option. See byLeague.
async function all({ fields } = {}) {
    if (!readsFromFranchises()) {
        return User.find({}, fields ? asProjection(fields) : null).lean();
    }
    const franchises = await Franchise.find(
        {},
        fields ? asProjection(franchiseSideOf(fields).concat('accountId')) : null
    ).lean();
    return hydrate(franchises, { list: false, fields });
}

// Does any manager match? An existence check, not a fetch.
//
// The filter here is entirely franchise-side (a league and a season entry), so
// it needs no account at all — and `exists` stops at the first match instead of
// pulling documents that are ~100KB each.
async function anyFranchise(franchiseFilter) {
    if (!readsFromFranchises()) return !!(await User.exists(franchiseFilter));
    return !!(await Franchise.exists(franchiseFilter));
}

// Every league a person plays in. The query this whole split exists to make
// possible, and the replacement for the Auth0 'gg'/'cl' flag.
async function leaguesFor(accountId) {
    if (!readsFromFranchises()) {
        // One league per person on the old path, by construction — that is the
        // limitation the split removes.
        const user = await User.findById(accountId, { league: 1 }).lean();
        return user && user.league ? [user.league] : [];
    }
    const franchises = await Franchise.find({ accountId }, { league: 1, _id: 0 }).lean();
    return franchises.map(f => f.league);
}

// The projection the /users routes have always used. Callers index seasons[0]
// through public/season-of.js, so both paths must narrow to one season or the
// wrong year is served.
function userProjection(season) {
    const projection = {
        firstName: 1, lastName: 1, email: 1, league: 1, lastUpdated: 1, color: 1,
        avatarUrl: 1, profilePrompted: 1, isUpdated: 1
    };
    // Omit the season filter entirely when none is asked for — a membership
    // read wants every season, and `$elemMatch: { season: undefined }` would
    // quietly match nothing.
    if (season !== undefined) projection.seasons = { $elemMatch: { season } };
    return projection;
}

// Attach each franchise's account in one round trip rather than per document.
async function hydrate(franchises, { list = true, fields } = {}) {
    if (!franchises.length) return [];
    const ids = franchises.map(f => f.accountId);
    // Projected at the query, not just filtered after: credentials should not
    // cross the wire from Mongo either. A caller's own field list narrows it
    // further still.
    // An explicit `fields` list is a REQUEST and wins over the list default.
    //
    // This used to intersect with LIST_ACCOUNT_FIELDS whenever `fields` was
    // given, which silently dropped authSub — so the admin Manager Logins panel
    // computed `linked: !!u.authSub` against a field that was never fetched and
    // reported EVERY manager as never having logged in. That is the panel an
    // admin reads before minting an invite link.
    //
    // LIST_ACCOUNT_FIELDS remains the default for a caller that names nothing,
    // which is what keeps credentials off the broad listings. A caller that
    // names authSub has said so deliberately, and one of them needs it.
    const roots = fields && new Set(fields.map(f => f.split('.')[0]));
    const wanted = roots
        ? ACCOUNT_FIELDS.filter(f => roots.has(f))
        : (list ? LIST_ACCOUNT_FIELDS : ACCOUNT_FIELDS);
    const accounts = await Account.find({ _id: { $in: ids } }, asProjection(wanted)).lean();
    const byId = new Map(accounts.map(a => [String(a._id), a]));
    return franchises
        .map(f => toUserShape(byId.get(String(f.accountId)), f, { list, explicit: !!fields }))
        .filter(Boolean)
        .map(doc => (fields ? keepOnly(doc, fields) : doc));
}

// ---- the two aggregation shapes ---------------------------------------------
//
// These are the only reads that cannot be expressed as "fetch, then assemble".
// Both exist because a projection cannot drop array ELEMENTS: routes/scores.js
// measured 1059KB -> 40KB and routes/standings.js 106KB -> 3KB by using $filter
// to pick the one season and $map to slim what survives. On an M0 tier, where
// latency tracks bytes, that is seconds per request. Reproducing them as a
// find() plus JS trimming would move the storage and undo the optimisation in
// the same change, which is exactly the kind of thing that only shows up as a
// slow Saturday.
//
// SEASON MUST BE A NUMBER in both, deliberately. models/user.js declares
// seasonSchema.season as Number, and the find/distinct/update calls around them
// pass the string — which works only because Mongoose casts it against the
// schema. A pipeline gets NO casting: $match with '2026' matches nothing, so
// the caller sees an empty result that reads exactly like "this league has no
// managers", and the H2H pass then applies no bonuses at all while logging a
// clean "0 manager(s) updated". routes/scores.js guards this with isRealSeason.
// The guard lives at the caller; this note is here so the next person to add a
// pipeline knows why it has to.

// The season-slimming stage, shared by both branches of both reads.
//
// Factored out rather than written twice per method because the whole point of
// the flag is that the two branches answer identically, and a $map that drifts
// between them is a difference the diff script would report as a data problem
// rather than as the code problem it is.
function slimSeasons(season, inner) {
    return { $map: {
        input: { $filter: { input: { $ifNull: ['$seasons', []] }, as: 's', cond: inner.cond(season) } },
        as: 's',
        in: inner.in
    } };
}

// Managers for the standings projections page: identity plus a roster slimmed
// to team ids. Replaces the User.aggregate in routes/standings.js.
//
// seasons.teams stores the FULL team object per pick — that is how the draft
// persists them — so six managers came to 106KB, 90KB of it logos, venues, alt
// names and colours the projection never reads. It needs the team id; the rest
// it looks up in teamsById. On an M0 tier that one query cost 1.67 SECONDS for
// six documents; slimmed here it is ~3KB and ~100ms.
async function projectionManagers(league, season) {
    // Both branches project the same four account-side fields and the same
    // slimmed seasons. Fields absent on the stored document stay absent — Mongo
    // omits a projected field that does not exist — which is the same presence
    // semantics toUserShape gives the non-aggregate reads.
    const seasons = slimSeasons(season, {
        cond: s => ({ $in: ['$$s.season', [s, String(s)]] }),
        in: {
            season: '$$s.season',
            franchiseName: '$$s.franchiseName',
            cumulativeScore: '$$s.cumulativeScore',
            // school is kept only for the teamsById miss path in
            // buildProjections, which falls back to this object.
            teams: { $map: { input: { $ifNull: ['$$s.teams', []] }, as: 't',
                             in: { id: '$$t.id', school: '$$t.school' } } }
        }
    });

    if (!readsFromFranchises()) {
        return User.aggregate([
            { $match: { league, 'seasons.season': season } },
            { $project: { firstName: 1, lastName: 1, avatarUrl: 1, color: 1, seasons } }
        ]);
    }
    return Franchise.aggregate([
        { $match: { league, 'seasons.season': season } },
        { $project: { accountId: 1, seasons } },
        ...accountJoin(['firstName', 'lastName', 'avatarUrl', 'color'])
    ]);
}

// Managers for the H2H bonus pass: team ids and the WHOLE weeklyScore array.
// Replaces h2hUsers in routes/scores.js.
//
// This was User.find({ league, 'seasons.season' }) with no projection, which
// answered every field of every season a manager has ever played. Measured
// against a dev copy of prod, for the two leagues:
//
//   unprojected                         1059KB, 11325ms
//   projected to teams.id + weeklyScore  435KB,  4192ms
//   this aggregate                         40KB,   608ms
//
// A plain projection cannot get there, though NOT for the reason it looks like.
// A nested projection DOES slim subdocuments — {'seasons.teams.id': 1} really
// does return teams as [{id}], and routes/scores.js relies on that elsewhere.
// That is what takes 1059KB to 435KB.
//
// What a projection cannot do is drop array ELEMENTS. It slims fields across
// ALL FOUR of a manager's seasons, and the 435KB that remains is the three
// seasons this pass is not scoring — mostly their weeklyScore. $elemMatch and
// the positional projection can pick the one element, but they return it WHOLE
// and cannot be combined with a nested field projection, so the full team
// objects come back. $filter picks the element and $map slims it, which is why
// this is an aggregate.
//
// weeklyScore stays whole deliberately. Trimming it to the six fields the
// computation reads gets this to 4KB/117ms, but the caller writes the array
// back, so a trimmed read would silently drop scoreByTeam and the Captain
// fields off every entry. 0.5s is not worth that.
async function h2hManagers(league, season) {
    const seasons = slimSeasons(season, {
        cond: s => ({ $eq: ['$$s.season', s] }),
        in: {
            season: '$$s.season',
            // Only the id is read, to build the drafted-team set.
            teams: { $map: { input: { $ifNull: ['$$s.teams', []] }, as: 't', in: { id: '$$t.id' } } },
            weeklyScore: { $ifNull: ['$$s.weeklyScore', []] }
        }
    });

    if (!readsFromFranchises()) {
        return User.aggregate([
            { $match: { league, 'seasons.season': season } },
            { $project: { seasons } }
        ]);
    }
    // The join costs a keyed _id lookup per manager and returns nothing but the
    // id — this read wants no account field at all. It is here for MEMBERSHIP,
    // not for data: every other read drops a franchise whose account is missing
    // (toUserShape returns null), and this one must agree, because the H2H pass
    // pairs managers against each other. An extra manager in the list does not
    // just add a row — it re-partners everyone else for that week.
    return Franchise.aggregate([
        { $match: { league, 'seasons.season': season } },
        { $project: { accountId: 1, seasons } },
        ...accountJoin([])
    ]);
}

// Join each franchise to its account and return documents in User shape:
// `_id` is the ACCOUNT's id, because that is what Auth0 points at, what every
// client holds, and — until the write cutover — what routes/scores.js keys its
// User.updateOne on.
//
// Franchises with no account are dropped, matching toUserShape.
function accountJoin(fields) {
    // AN EMPTY FIELD LIST MUST NOT BECOME AN EXCLUSION PROJECTION.
    //
    // `{ _id: 0 }` reads like "nothing", and it is the opposite: an
    // exclusion-only projection returns EVERY OTHER FIELD. The first run of
    // scripts/diff-franchise-reads.js against this caught h2hManagers merging
    // whole accounts — authSub, email, avatarUrl — into a result that is
    // supposed to carry an id and a roster, and which routes/scores.js hands
    // straight to computeH2HAwards. `{ _id: 1 }` is the inclusion form that
    // actually means "the id and nothing else", and the merge below overwrites
    // that id anyway.
    //
    // This is the same trap asProjection documents a few lines up. It is
    // written out twice because the two are not shared code and the second one
    // still cost a debugging round.
    const projection = fields.length ? { _id: 0 } : { _id: 1 };
    fields.forEach(f => { projection[f] = 1; });
    return [
        { $lookup: {
            from: Account.collection.name,
            localField: 'accountId',
            foreignField: '_id',
            as: 'acct',
            // Projected inside the join, so an unwanted roster-sized field never
            // leaves the server.
            pipeline: [{ $project: projection }]
        } },
        { $match: { 'acct.0': { $exists: true } } },
        // _id and seasons go LAST so they win the merge outright, whatever the
        // account happens to carry.
        { $replaceWith: { $mergeObjects: [
            { $arrayElemAt: ['$acct', 0] },
            { _id: '$accountId', seasons: '$seasons' }
        ] } }
    ];
}

// Every league with at least one manager in `season`. Replaces the
// User.distinct('league', …) that drives the H2H pass's per-league loop.
//
// Sorted, which distinct() is not. The caller iterates and the order carries no
// meaning, so this is a deliberate narrowing rather than a silent one: an
// unordered result is a flake waiting to happen in the comparison script.
async function leaguesWithSeason(season) {
    const Model = readsFromFranchises() ? Franchise : User;
    const leagues = await Model.distinct('league', { 'seasons.season': season });
    // filter(Boolean) is a CONTRACT, not tidying: routes/scores.js used to carry
    // its own `if (!league) continue;` and that guard was removed on the
    // strength of this line. A manager with no league is a data fault that must
    // not become a per-league scoring pass over `undefined`.
    return leagues.filter(Boolean).sort();
}

// ---- writes -----------------------------------------------------------------
//
// THE FLAG NOW GATES WRITES TOO, AND THAT IS THE WHOLE POINT.
//
// Until this block existed, FRANCHISE_READS chose where reads came from while
// writes always went to `users`. That is why the comment above says never to set
// it in production: flag-on meant reading a snapshot and writing somewhere else,
// and the two diverge immediately — in one case destructively (see the
// applyH2HBonuses note).
//
// Everything below moves the write to the SAME place the read came from. There
// is still exactly one source of truth at any moment; which one it is depends on
// the flag, and reads and writes can never disagree about it. That is not
// dual-writing, which remains forbidden — nothing here writes both.
//
// What it buys: the cutover stops being a deploy. This code ships inert, gets
// verified in production changing nothing, and then someone sets one config var
// at a chosen moment. A flip that goes wrong is flipped back in seconds, losing
// only the writes made in between, instead of needing a revert and a redeploy.
//
// It does NOT make the cutover reversible in general. Flip on, let an hour of
// scoring run, and flipping back silently reverts that hour — `users` will not
// have seen it. The window is small, not absent. Re-run
// scripts/migrate-accounts.js before flipping, or the new collections answer
// from whenever they were last synced.

// One manager, as MUTABLE documents, for a handler that will change and save.
//
// Always returns the same two-key shape, and this is the trick that keeps the
// callers free of flag checks: with the flag OFF, `account` and `franchise` are
// THE SAME User document. Setting account.avatarUrl and franchise.seasons both
// mutate the one doc, saveBoth notices they are the same object and saves it
// once, and the result is byte-for-byte the single-document write the route did
// before. With the flag ON they are two documents and both are saved.
//
// So a handler is written once, reads naturally (`account.email`,
// `franchise.seasons`), and documents at its mutation site which document each
// field belongs to — which is the thing that was previously invisible and is the
// reason a field ever gets routed to the wrong place.
//
// `franchise` is null for an account with no entry in `league`. Callers that
// need one must say so; they are the same callers that 404 today.
// `fields` and `season` exist for the two PATCH middlewares in routes/users.js,
// which have always projected rather than loading a ~100KB document to write one
// number — and where the projection is not only an optimisation. The comment on
// PATCH /:id records that mongoose REFUSES to save a document that both edits a
// scalar and replaces an array wholesale under an $elemMatch projection, so a
// body carrying cumulativeScore AND weeklyScore throws instead of writing half.
// tests/RosterCorrection.spec.js pins all four combinations. Reproducing the
// projection on both flag positions is what keeps that true.
//
// `season` also narrows the FILTER, not just the projection: those middlewares
// 404 when the manager has no entry for the season being written, and that 404
// is the filter failing to match.
async function loadForWrite(accountId, { league, fields, season } = {}) {
    const scoped = (list) => (season !== undefined ? seasonScopedProjection(list, season) : asProjection(list));

    if (!writesToFranchises()) {
        if (!fields) {
            const user = await User.findById(accountId);
            if (!user) return null;
            return { account: user, franchise: user, same: true };
        }
        const filter = { _id: accountId };
        if (season !== undefined) filter['seasons.season'] = season;
        const user = await User.findOne(filter, scoped(fields));
        if (!user) return null;
        return { account: user, franchise: user, same: true };
    }

    const roots = fields && new Set(fields.map(f => f.split('.')[0]));
    const account = await Account.findById(
        accountId,
        fields ? asProjection(ACCOUNT_FIELDS.filter(f => roots.has(f))) : null
    );
    if (!account) return null;

    const filter = league ? { accountId, league } : { accountId };
    if (season !== undefined) filter['seasons.season'] = season;
    // `null` here would mean EVERY field, which for a franchise is the whole
    // roster — the same trap asProjection guards and byAccountId documents. A
    // caller that named fields and none of them franchise-side gets the id and
    // nothing else, rather than ~100KB it did not ask for.
    const franchiseFields = fields && franchiseSideOf(fields);
    const franchise = await Franchise.findOne(
        filter,
        fields ? (franchiseFields.length ? scoped(franchiseFields) : { _id: 1 }) : null
    );
    // A season-scoped load is a load OF THAT SEASON. No entry means the caller's
    // 404, not a document with an empty roster — which is what the flag-off
    // filter above does, and the two have to agree.
    if (season !== undefined && !franchise) return null;
    return { account, franchise, same: false };
}

// Persist whatever loadForWrite handed back.
//
// Deliberately smaller than it first was. The original guarded each save with
// isModified() and short-circuited the same-document case, and a sabotage pass
// found that NEITHER guard could be made to fail a test — because mongoose
// already issues no write for an unmodified document. Measured against the test
// harness: an unmodified save() makes 0 collection.updateOne calls, including
// immediately after a save that did write. Guards no test can distinguish are
// worse than none: they read as load-bearing and get preserved through refactors
// that no longer need them.
//
// Account first. A handler that changes both is changing a person's details and
// their entry; if the second write fails the half that landed is the less
// surprising one to see. Neither order can leave an account with NO franchise —
// this path only ever updates an existing pair — which matters because that
// particular half-state changes decideInvite's answer (see modules/invite-bind.js).
async function saveBoth(ctx) {
    if (!ctx) return;
    await ctx.account.save();
    // `same` rather than === between two mongoose documents: loadForWrite knows
    // which shape it built, so it says, instead of this inferring it.
    if (!ctx.same && ctx.franchise) await ctx.franchise.save();
}

// A surgical update of ACCOUNT-side fields — the $set/$pull/$unset writes that
// deliberately avoid hydrating a ~100KB document to change one key.
//
// `filter` narrows the match, and for one caller it is the entire safety
// mechanism rather than an optimisation: modules/auth-sub-backfill.js fills
// authSub only when it is still blank, expressed as a condition in the filter so
// that two concurrent requests cannot fight over it and an existing binding is
// never overwritten. Moved into an update body it would stop being atomic.
async function updateAccount(accountId, update, { filter } = {}) {
    const Model = writesToFranchises() ? Account : User;
    return Model.updateOne(Object.assign({ _id: accountId }, filter || {}), update);
}

// The same for FRANCHISE-side fields.
//
// `filter` exists for one caller and is load-bearing for it: routes/scores.js
// writes 'seasons.$.weeklyScore', and the positional $ resolves against the
// array element matched IN THE FILTER. Dropping that condition does not error —
// it makes the positional operator match nothing, so the H2H bonus is silently
// not stored. The route already logs a matchedCount of 0 for exactly this.
//
// Note the key change that comes free with the collection change: a Franchise is
// found by `accountId`, not by `_id`. A write that kept using { _id } would
// match nothing on the new path and report success at the driver level.
async function updateFranchise(accountId, update, { league, filter } = {}) {
    if (!writesToFranchises()) {
        return User.updateOne(Object.assign({ _id: accountId }, filter || {}), update);
    }
    const base = { accountId };
    if (league) base.league = league;
    return Franchise.updateOne(Object.assign(base, filter || {}), update);
}

// Every entry that has a roster, as MUTABLE documents, for the one bulk write in
// the app: routes/teams.js propagating refreshed team fields (logos, school,
// colours) into the denormalised copies on each roster.
//
// No account side at all — this touches seasons[].teams and nothing else — so
// there is nothing to assemble and the caller saves each document directly. That
// is also why it returns documents rather than a loadForWrite context: the
// caller already loops, and wrapping each one in a two-key object it would never
// use would be ceremony.
async function rosteredForWrite() {
    const Model = writesToFranchises() ? Franchise : User;
    return Model.find({ 'seasons.teams.0': { $exists: true } });
}

// Create a manager: one person and their entry in one league.
//
// NOT a transaction, deliberately. Atlas would support one, but the test harness
// runs a standalone mongod (tests/helpers/mongo.js), where transactions are
// unavailable — so a transactional path would be the one path the suite could
// never exercise, which is worse than not having it. Instead the franchise
// failing compensates by deleting the account it just made.
//
// Leaving the orphan behind is not an option worth taking. An Account with no
// Franchise is not an inert half-record: decideInvite reads a missing league as
// "no league constraint", so an orphan is an account that can claim an invite
// minted for ANY league. The compensating delete is safe precisely because the
// account is one call old and nothing points at it yet.
async function createManager(fields) {
    if (!writesToFranchises()) {
        const user = new User(fields);
        return user.save();
    }
    const accountFields = {};
    const franchiseFields = {};
    Object.keys(fields).forEach(k => {
        if (ACCOUNT_FIELDS.includes(k) || k === '_id') accountFields[k] = fields[k];
        else if (k === 'league' || k === 'seasons' || FRANCHISE_FIELDS.includes(k)) franchiseFields[k] = fields[k];
        else throw new Error(`createManager: '${k}' is routed to neither document — `
            + `add it to ACCOUNT_FIELDS or FRANCHISE_FIELDS, or it is silently dropped`);
    });

    const account = await Account.create(accountFields);
    let franchise;
    try {
        franchise = await Franchise.create(Object.assign({ accountId: account._id }, franchiseFields));
    } catch (e) {
        // Loud if the compensation ITSELF fails. The orphan this is removing is
        // an invite-hijack vector (see the note above), so "we tried" is not a
        // state anyone should have to infer from its absence.
        await Account.deleteOne({ _id: account._id }).catch((delErr) => {
            console.error(`createManager: franchise write failed AND the rollback failed — `
                + `account ${account._id} is an ORPHAN and can claim an invite for any league. `
                + `Delete it by hand. rollback error: ${delErr && delErr.message}`);
        });
        throw e;
    }
    // In User shape, because every caller reads .league and ._id off the result —
    // and built from the CREATED documents, not from the input. Echoing the
    // input back skips schema defaults, casting and subdocument ids, so the
    // response would differ from what a read returns a moment later.
    return toUserShape(account.toObject(), franchise.toObject());
}

// Trim an assembled document to the fields a caller asked for, `_id` always
// surviving because every caller keys on it.
function keepOnly(doc, fields) {
    const out = { _id: doc._id };
    // Keep the ROOT of a dotted path. Callers project subfields deliberately —
    // routes/betting-groups.js asks for seasons.season and seasons.franchiseName
    // and records the result as "418KB -> 1KB, 4.4s -> 75ms" — so trimming on
    // the literal 'seasons.season' would drop the data entirely, and widening it
    // to 'seasons' would hand back the rosters that projection exists to avoid.
    new Set(fields.map(f => f.split('.')[0])).forEach(root => {
        if (doc[root] !== undefined) out[root] = doc[root];
    });
    return out;
}

module.exports = {
    readsFromFranchises, userProjection,
    toUserShape, byLeagueAndSeason, bySeason, byAccountId, byLeagueAndSeasonForAccount, byLeague, byIds, all, leaguesFor, hydrate, findManagers, anyFranchise,
    usedColors, asProjection, seasonScopedProjection, keepOnly, franchiseSideOf,
    projectionManagers, h2hManagers, leaguesWithSeason,
    writesToFranchises, loadForWrite, saveBoth, updateAccount, updateFranchise, createManager, rosteredForWrite,
    ACCOUNT_FIELDS, FRANCHISE_FIELDS, LIST_ACCOUNT_FIELDS, LIST_FRANCHISE_FIELDS
};
