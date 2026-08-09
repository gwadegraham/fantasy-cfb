// Commissioner audit trail.
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
    'league.rename': 'League',
    'user.create': 'Manager'
};

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

module.exports = { ACTIONS, labelFor, actorFrom, record, toRow };
