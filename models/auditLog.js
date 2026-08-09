const mongoose = require('mongoose');

// A commissioner action that changed league data.
//
// Scheduled jobs already leave a trail (models/jobRun.js); commissioner actions
// did not. Several of them quietly rewrite history — a roster correction edits
// the draft record, a season-membership toggle drops a year's scores — and until
// now the only evidence was the changed data itself. This is the trail.
//
// Append-only by construction: nothing in the app updates or deletes an entry.
const auditLogSchema = new mongoose.Schema({
    // Dotted verb, e.g. 'roster.correct'. See ACTIONS in modules/audit-log.js —
    // the label shown in the admin panel is looked up from there, so an unknown
    // action still renders (as its raw key) rather than vanishing.
    action: { type: String, required: true },
    league: { type: String },
    season: { type: String },

    // Who did it. Resolved from the session; a server-to-server call carrying
    // the internal token records as system.
    actorName: { type: String },
    actorEmail: { type: String },
    actorRole: { type: String },

    // One human-readable line — what the admin panel actually shows.
    summary: { type: String, required: true },
    // Structured detail for anything that later wants to reconstruct the change.
    meta: { type: mongoose.Schema.Types.Mixed },

    createdAt: { type: Date, default: Date.now }
});

// The panel reads newest-first, either league-scoped or across the board.
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ league: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
