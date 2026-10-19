// Audit trail: commissioner actions, plus the one manager action that rewrites
// something nobody can otherwise reconstruct (the weekly Captain pick).
//
// Scheduled jobs already leave a record (modules/job-logger.js). Commissioner
// actions did not — and several of them quietly rewrite history: a roster
// correction edits the draft record, a season-membership toggle drops a year's
// scores, a scoring-config change alters how every past game counts. The only
// evidence was the changed data itself.
//
// Recording is BEST-EFFORT and never throws. An audit write failing must not
// fail the action it was describing — same discipline as job-logger. That means
// a missing entry is possible; the trail is for "who changed this and when",
// not an accounting ledger.

const AuditLog = require('../models/auditLog');
const { effectiveRoles } = require('./dev-role');

// Known actions -> the short label the admin panel shows. Kept here rather than
// in the client so the vocabulary lives with the code that writes it; an
// unrecognised action still renders as its raw key.
const ACTIONS = {
    'roster.correct': 'Roster',
    'season.membership': 'Season roster',
    'scoring.config': 'Scoring',
    'scoring.engagement': 'Game modes',
    'draft.config': 'Draft',
    'draft.reset': 'Draft',
    'draft.grades.freeze': 'Draft grades',
    'league.rename': 'League',
    'league.create': 'League',
    'league.members': 'League',
    'league.commissioners': 'League',
    'user.create': 'Manager',
    'user.invite': 'Invite',
    'captain.set': 'Captain',
    'captain.locked': 'Captain',
    'parlay.backfill': 'Betting',
    'hoops.preseason': 'Preseason ratings',
    'hoops.teams': 'Basketball data',
    'hoops.schedule': 'Basketball data',
    'hoops.refresh': 'Basketball data',
    'hoops.roster': 'Basketball data'
};

// Actions a MANAGER performs on their own team, as opposed to a commissioner
// action on the league. They share the collection — one trail, one query — but
// the panel separates them, because a game week produces a captain row per
// manager and would otherwise bury the handful of rows that change league data.
// A Set rather than an array so membership reads as membership; routes/auditLog.js
// spreads it into the $in / $nin that splits the two feeds.
const MANAGER_ACTIONS = new Set(['captain.set', 'captain.locked']);

function labelFor(action) {
    return ACTIONS[action] || action;
}

// Who performed this. Reads the REAL session identity, not the dev role-spoof:
// a spoof changes what an Admin can see, and the log should still say who they
// actually are. A server-to-server call (internal token, no session) is system.
function actorFrom(req) {
    const user = req && req.oidc && req.oidc.user;
    if (!user) return { actorName: 'system', actorEmail: null, actorRole: 'system' };
    const roles = effectiveRoles(req) || [];
    return {
        actorName: user.name || user.email || 'unknown',
        actorEmail: user.email || null,
        actorRole: roles[0] || 'member'
    };
}

// Append an entry. Fire-and-forget by design: callers `await` it so ordering is
// predictable in tests, but it resolves to null instead of throwing on failure.
async function record(req, entry) {
    try {
        if (!entry || !entry.action || !entry.summary) return null;
        const doc = await AuditLog.create(Object.assign({
            league: null, season: null, meta: null
        }, actorFrom(req), entry));
        return doc;
    } catch (err) {
        console.log('audit-log write failed:', err.message);
        return null;
    }
}

// Audit a route by its REPLY rather than at each exit. The basketball data
// tasks (#563) have a dozen return paths — upstream failure, cap hit, partial
// write, success — and every one of them may already have spent CBBD calls, so
// every one is worth a row. Call this once the request has passed its input
// checks (nothing billable has happened before that); `entryFor(status, body)`
// shapes the row from what the route is about to send. The row is written
// BEFORE the reply goes out, so a test that awaits the response can read it.
function onReply(req, res, entryFor) {
    const send = res.json.bind(res);
    res.json = (body) => {
        let entry = null;
        try { entry = entryFor(res.statusCode, body || {}); } catch (err) {
            console.log('audit-log entry failed:', err.message);
        }
        record(req, entry).then(() => send(body));
        return res;
    };
}

// The row for a basketball data task run over HTTP — the /hoops/admin buttons
// (#563). `calls` is the CBBD cost the admin page quotes for the task; a failed
// run still records it, since the calls may already be spent.
function cbbdTaskEntry(action, task, season, calls, status, body, okLine) {
    const ok = status < 400;
    const cost = `${calls} CBBD call${calls === 1 ? '' : 's'}`;
    return {
        action, season: String(season),
        summary: ok
            ? `Basketball ${task} for ${season}: ${okLine} · ${cost}`
            : `Basketball ${task} FAILED for ${season} (${status}): ${body.message || 'no message'} · ${cost}`,
        meta: { calls, status, remainingCalls: body.remainingCalls == null ? null : body.remainingCalls }
    };
}

// Shape an entry for the panel. `label` is derived here so the client stays a
// dumb renderer and the vocabulary can grow without a client change.
function toRow(doc) {
    return {
        id: String(doc._id),
        action: doc.action,
        label: labelFor(doc.action),
        league: doc.league || null,
        season: doc.season || null,
        actor: doc.actorName || 'unknown',
        summary: doc.summary,
        at: doc.createdAt
    };
}

module.exports = { ACTIONS, MANAGER_ACTIONS, labelFor, actorFrom, record, onReply, cbbdTaskEntry, toRow };
