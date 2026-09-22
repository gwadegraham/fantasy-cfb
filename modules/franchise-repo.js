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

// Fields that live on the Account, mirroring modules/account-migration.js.
// Kept in sync deliberately: if the migration routes a field somewhere, this
// has to read it back from the same place.
const ACCOUNT_FIELDS = ['firstName', 'lastName', 'email', 'authSub', 'avatarUrl',
    'profilePrompted', 'color', 'pushSubscriptions', 'pushPrefs'];
const FRANCHISE_FIELDS = ['isUpdated', 'lastUpdated', 'captainReminders', 'recapNotices'];

// One manager, in User shape.
//
// `_id` comes from the ACCOUNT, not the franchise — it is the id Auth0 points
// at and the id every existing client, link and localStorage key already holds.
// Using the franchise's own id here would break logins and every /userHome?user=
// URL in the wild.
function toUserShape(account, franchise) {
    if (!account) return null;
    const doc = { _id: account._id };
    ACCOUNT_FIELDS.forEach(f => { if (account[f] !== undefined) doc[f] = account[f]; });
    if (franchise) {
        doc.league = franchise.league;
        doc.seasons = franchise.seasons || [];
        FRANCHISE_FIELDS.forEach(f => { if (franchise[f] !== undefined) doc[f] = franchise[f]; });
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
    const account = await Account.findById(accountId).lean();
    if (!account) return null;
    const filter = league ? { accountId, league } : { accountId };
    const franchise = await Franchise.findOne(filter).lean();
    return toUserShape(account, franchise);
}

// Every league a person plays in. The query this whole split exists to make
// possible, and the replacement for the Auth0 'gg'/'cl' flag.
async function leaguesFor(accountId) {
    const franchises = await Franchise.find({ accountId }, { league: 1, _id: 0 }).lean();
    return franchises.map(f => f.league);
}

// Attach each franchise's account in one round trip rather than per document.
async function hydrate(franchises) {
    if (!franchises.length) return [];
    const ids = franchises.map(f => f.accountId);
    const accounts = await Account.find({ _id: { $in: ids } }).lean();
    const byId = new Map(accounts.map(a => [String(a._id), a]));
    return franchises
        .map(f => toUserShape(byId.get(String(f.accountId)), f))
        .filter(Boolean);
}

module.exports = {
    toUserShape, byLeagueAndSeason, bySeason, byAccountId, leaguesFor, hydrate,
    ACCOUNT_FIELDS, FRANCHISE_FIELDS
};
