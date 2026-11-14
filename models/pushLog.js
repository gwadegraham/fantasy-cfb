const mongoose = require('mongoose');

// The push evidence trail, two kinds of row (modules/push-delivery.js):
//
//   send     one per notification per DEVICE: what we sent, what the push
//            service answered, and — once public/sw.js reports back — when
//            the phone received it and when it was tapped.
//   setting  something the manager did to their own alerts: registered a
//            device, removed one, turned alerts off, muted or unmuted a type,
//            changed the Captain lead time.
//
// Built so a "I never got it" report can be answered with facts. Apple answers
// 201 for a subscription the phone silently dropped, so the captainReminders
// ledger said Trevor was reminded on weeks he heard nothing (Oct–Nov 2026).
// With receipts, a send reads one of three ways: the push service refused it
// (our side), it was accepted but never arrived (the phone), or it arrived
// (and was or was not tapped). The setting rows cover "did he mute it?".
//
// Each row carries its own expiry: sends 60 days, settings a year — a muted
// alert type can explain a silence months after the tap that muted it.
const pushLogSchema = new mongoose.Schema({
    kind: { type: String, enum: ['send', 'setting'], required: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // A hash of the endpoint, never the endpoint itself: the endpoint plus the
    // keys IS the capability to send to that phone.
    device: { type: String },
    deviceLabel: { type: String },
    at: { type: Date, default: Date.now },
    expireAt: { type: Date, required: true },

    // --- kind: send ---
    // Random, unguessable, carried in the payload. It is all a receipt has to
    // present, so the receipt route needs no login.
    sendId: { type: String },
    type: { type: String },
    tag: { type: String },
    title: { type: String },
    week: { type: Number },
    // pending: logged, not yet answered (the row exists before the send so a
    // fast receipt has something to mark). accepted: the push service took
    // it. failed: it refused and the subscription was kept. gone: 404/410,
    // the subscription was pruned.
    status: { type: String, enum: ['pending', 'accepted', 'failed', 'gone'] },
    statusCode: { type: Number },
    error: { type: String },
    receivedAt: { type: Date },
    openedAt: { type: Date },

    // --- kind: setting ---
    action: { type: String },
    detail: { type: String }
}, { versionKey: false });

pushLogSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
pushLogSchema.index({ accountId: 1, at: -1 });
pushLogSchema.index({ sendId: 1 }, { unique: true, partialFilterExpression: { sendId: { $type: 'string' } } });

module.exports = mongoose.model('PushLog', pushLogSchema);
