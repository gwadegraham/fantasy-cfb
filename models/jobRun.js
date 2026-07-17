const mongoose = require('mongoose');

// One document per scheduled-job execution. `status` moves running -> success
// or error. Kept as a rolling history: a TTL index expires documents ~60 days
// after they start, so the collection stays small without any manual cleanup.
const jobRunSchema = new mongoose.Schema({
    jobName: { type: String, required: true },
    status: { type: String, enum: ['running', 'success', 'error'], default: 'running' },
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
