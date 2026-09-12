const mongoose = require('mongoose');

// One document per scheduled-job execution. `status` moves running -> success,
// error, or skipped. Kept as a rolling history: a TTL index expires documents
// ~60 days after they start, so the collection stays small without any manual
// cleanup.
//
// 'skipped' means the run started but did no work — today, a live poller tick
// that found a previous update still in flight. It is deliberately NOT
// 'success': routes/standings.js derives the standings "data as of" badge from
// the newest successful scoring run, so a did-nothing tick logged as a success
// advanced that badge without anything behind it having refreshed.
const jobRunSchema = new mongoose.Schema({
    jobName: { type: String, required: true },
    status: { type: String, enum: ['running', 'success', 'error', 'skipped'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    message: { type: String },
    season: { type: String },
    week: { type: Number },
    seasonType: { type: String }
});

// Auto-expire old runs after 60 days (Mongo prunes them; no cron needed).
jobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });
// Fast "latest per job" lookups.
jobRunSchema.index({ jobName: 1, startedAt: -1 });

module.exports = mongoose.model('JobRun', jobRunSchema);
