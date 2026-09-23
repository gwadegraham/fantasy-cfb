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
// Which collection these reads come from. UNSET MEANS USERS — the old path —
// so merging and deploying this changes nothing at all. Flip
// FRANCHISE_READS=true when you want to try the new source, and flip it back if
// anything looks wrong. That makes the undo a config change measured in seconds
// rather than a revert commit and a build.
//
// ONE definition, read PER CALL. Both of those are deliberate: this repo has
// been bitten by LIVE_POLL_ENABLED, where modules/scheduler.js treated unset as
// OFF and modules/live-poll.js treated it as ON, so the poller believed it was
// enabled while never being scheduled and nothing logged a thing. Reading per
// call also lets a test flip it without re-requiring the module.
//
// THIS IS TEMPORARY. Two read paths can drift, which is the same "two sources of
// truth" the issue warns about — it is tolerable only because it is reads, and
// only until the writes move. The flag and the whole `users` branch below get
// deleted in that same change.
function readsFromFranchises() {
    return process.env.FRANCHISE_READS === 'true';
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
function toUserShape(account, franchise, { list = false } = {}) {
    if (!account) return null;
    const accountFields = list ? LIST_ACCOUNT_FIELDS : ACCOUNT_FIELDS;
    const franchiseFields = list ? LIST_FRANCHISE_FIELDS : FRANCHISE_FIELDS;

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
async function byLeagueAndSeason(league, season, { projectSeason = true } = {}) {
    if (!readsFromFranchises()) {
        return User.find(
            { league, 'seasons.season': season },
            projectSeason ? userProjection(season) : null
        ).lean();
    }
    const query = { league, 'seasons.season': season };
    const projection = projectSeason
        ? { accountId: 1, league: 1, isUpdated: 1, lastUpdated: 1, seasons: { $elemMatch: { season } } }
        : null;
    const franchises = await Franchise.find(query, projection).lean();
    return hydrate(franchises);
}

// Everyone with an entry for `season`, any league. Replaces
// GET /users/season/:year, which the scoring pass and the ingest read.
async function bySeason(season, { projectSeason = true } = {}) {
    if (!readsFromFranchises()) {
        return User.find(
            { 'seasons.season': season },
            projectSeason ? userProjection(season) : null
        ).lean();
    }
    const projection = projectSeason
        ? { accountId: 1, league: 1, isUpdated: 1, lastUpdated: 1, seasons: { $elemMatch: { season } } }
        : null;
    const franchises = await Franchise.find({ 'seasons.season': season }, projection).lean();
    return hydrate(franchises);
}

// One manager by their account id — the id Auth0 hands us.
//
// `league` is optional: with one franchise per person it is unambiguous, and
// omitting it is what keeps every existing caller working. Once a person can
// hold two, the callers that care will have to say which, and the ones that
// don't will need to stop guessing. That is the real work phase 2 defers, and
// naming it here beats discovering it later.
async function byAccountId(accountId, league) {
    if (!readsFromFranchises()) return User.findById(accountId).lean();
    const account = await Account.findById(accountId).lean();
    if (!account) return null;
    const filter = league ? { accountId, league } : { accountId };
    const franchise = await Franchise.findOne(filter).lean();
    return toUserShape(account, franchise);
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
async function byLeague(league, { list = false } = {}) {
    if (!readsFromFranchises()) {
        return User.find({ league }, list ? userProjection() : null).lean();
    }
    const franchises = await Franchise.find({ league }).lean();
    return hydrate(franchises, { list });
}

// Every manager, any league. The bare GET /users listing.
async function all({ list = false } = {}) {
    if (!readsFromFranchises()) {
        return User.find({}, list ? userProjection() : null).lean();
    }
    const franchises = await Franchise.find({}).lean();
    return hydrate(franchises, { list });
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
async function hydrate(franchises, { list = true } = {}) {
    if (!franchises.length) return [];
    const ids = franchises.map(f => f.accountId);
    // Projected at the query, not just filtered after: credentials should not
    // cross the wire from Mongo either.
    const fields = (list ? LIST_ACCOUNT_FIELDS : ACCOUNT_FIELDS)
        .reduce((acc, f) => Object.assign(acc, { [f]: 1 }), {});
    const accounts = await Account.find({ _id: { $in: ids } }, fields).lean();
    const byId = new Map(accounts.map(a => [String(a._id), a]));
    return franchises
        .map(f => toUserShape(byId.get(String(f.accountId)), f, { list }))
        .filter(Boolean);
}

module.exports = {
    readsFromFranchises, userProjection,
    toUserShape, byLeagueAndSeason, bySeason, byAccountId, byLeague, all, leaguesFor, hydrate,
    ACCOUNT_FIELDS, FRANCHISE_FIELDS, LIST_ACCOUNT_FIELDS, LIST_FRANCHISE_FIELDS
};
