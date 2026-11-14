// The push evidence trail (models/pushLog.js): every notification sent to
// every device, whether the phone says it arrived, and every change a manager
// made to their own alerts.
//
// Writers:
//   - modules/push-notify.js sendToUser: one `send` row per device per send.
//   - POST /push/receipt (routes/push-receipt.js), called by public/sw.js when
//     a notification lands and again when it is tapped; and its `hello`, from
//     a freshly activated service worker, which stamps receiptsSince.
//   - routes/users.js /me/push*: one `setting` row per change.
// Readers: the admin "Push deliveries" card and the manager's own health check
// (POST /users/me/push/health), both through summarize().
//
// Every function here swallows its own errors. This is diagnostics: a failed
// log write must never cost anyone the notification it was describing.

const crypto = require('crypto');
const PushLog = require('../models/pushLog');
const Account = require('../models/account');
const { deviceHealth } = require('./push-health');

const DAY = 24 * 60 * 60 * 1000;
const SEND_TTL_MS = 60 * DAY;
const SETTING_TTL_MS = 365 * DAY;
const SEND_ID = /^[a-f0-9]{32}$/;

function newSendId() {
    return crypto.randomBytes(16).toString('hex');
}

// Stable, non-reversible handle for a subscription endpoint.
function deviceKey(endpoint) {
    return crypto.createHash('sha256').update(String(endpoint || '')).digest('hex').slice(0, 16);
}

// "iPhone · Safari 27.0.1" from a user-agent string — enough to tell a phone
// from a laptop, and to spot that a Safari update happened in between.
function deviceLabel(ua) {
    const s = String(ua || '');
    if (!s) return 'Unknown device';
    const kind = /iPhone/.test(s) ? 'iPhone'
        : /iPad/.test(s) ? 'iPad'
        : /Android/.test(s) ? 'Android'
        : /Macintosh/.test(s) ? 'Mac'
        : /Windows/.test(s) ? 'Windows'
        : 'Browser';
    const named = s.match(/(Edg|Firefox|Chrome|CriOS)\/([\d.]+)/);
    if (named) {
        const name = named[1] === 'Edg' ? 'Edge' : named[1] === 'CriOS' ? 'Chrome' : named[1];
        return `${kind} · ${name} ${named[2].split('.')[0]}`;
    }
    const safari = s.match(/Version\/([\d.]+)/);
    return safari ? `${kind} · Safari ${safari[1]}` : kind;
}

// Two-phase, because a phone can answer faster than we finish: the row must
// exist BEFORE the push goes out, or a receipt that lands while we are still
// sending to the manager's other devices finds nothing to mark and is lost —
// and three lost receipts would call a healthy phone silent.
//
// startSends inserts every row as `pending`; finishSends stamps what the push
// service said. A row left pending (the process died mid-send) is never
// judged — modules/push-health.js only reads `accepted` rows.
//
// `rows`: send rows without kind/expiry; both are filled in here.
async function startSends(rows, nowMs) {
    if (!rows || !rows.length) return;
    const now = nowMs == null ? Date.now() : nowMs;
    const docs = rows.map(r => Object.assign({ at: new Date(now) }, r,
        { kind: 'send', status: 'pending', expireAt: new Date(now + SEND_TTL_MS) }));
    try {
        await PushLog.insertMany(docs, { ordered: false });
    } catch (e) {
        console.log(`Push: could not log ${rows.length} delivery row(s): ${e && e.message}`);
    }
}

// `results`: [{ sendId, status, statusCode, error }].
async function finishSends(results) {
    if (!results || !results.length) return;
    try {
        await PushLog.bulkWrite(results.map(r => ({
            updateOne: {
                filter: { sendId: r.sendId },
                update: { $set: { status: r.status, statusCode: r.statusCode, error: r.error } }
            }
        })), { ordered: false });
    } catch (e) {
        console.log(`Push: could not finish ${results.length} delivery row(s): ${e && e.message}`);
    }
}

// Something the manager did to their own alerts. `endpoint` is optional and
// stored only as its hash.
async function recordSetting(accountId, action, { detail = null, endpoint = null, userAgent = null, nowMs } = {}) {
    if (!accountId || !action) return;
    const now = nowMs == null ? Date.now() : nowMs;
    try {
        await PushLog.create({
            kind: 'setting', accountId, action, detail,
            device: endpoint ? deviceKey(endpoint) : undefined,
            deviceLabel: userAgent ? deviceLabel(userAgent) : undefined,
            at: new Date(now), expireAt: new Date(now + SETTING_TTL_MS)
        });
    } catch (e) {
        console.log(`Push: could not log setting ${action} for ${accountId}: ${e && e.message}`);
    }
}

// "Captain lock: off; Captain lead: 1 day" — the keys a prefs PATCH changed,
// old → new, in words. Empty string when nothing actually changed.
const PREF_LABELS = {
    score: 'Scores', leadChange: 'Lead changes', closeGame: 'Crunch time', final: 'Finals',
    captainLock: 'Captain lock', recapReady: 'Weekly recap',
    hoopsTipoff: 'Tip-off', hoopsCloseGame: 'Basketball crunch time', hoopsFinal: 'Basketball finals'
};
function describePrefChange(before, after) {
    const parts = [];
    for (const key of Object.keys(after || {})) {
        const was = before ? before[key] : undefined;
        const now = after[key];
        if (was === now) continue;
        if (key === 'captainLockLeadMinutes') {
            parts.push(`Captain lead: ${was == null ? 'default' : was + ' min'} → ${now} min`);
        } else {
            parts.push(`${PREF_LABELS[key] || key}: ${now ? 'on' : 'off'}`);
        }
    }
    return parts.join('; ');
}

// A receipt from the phone. Only the first `received` / `opened` counts, so a
// replayed receipt changes nothing. Returns true when a row was updated.
async function receipt(sendId, event, nowMs) {
    if (!SEND_ID.test(String(sendId || ''))) return false;
    const field = event === 'opened' ? 'openedAt' : event === 'received' ? 'receivedAt' : null;
    if (!field) return false;
    const at = new Date(nowMs == null ? Date.now() : nowMs);
    try {
        const res = await PushLog.updateOne({ sendId, [field]: { $exists: false } }, { $set: { [field]: at } });
        // A tap proves arrival too, if the receive post itself was lost.
        if (field === 'openedAt') {
            await PushLog.updateOne({ sendId, receivedAt: { $exists: false } }, { $set: { receivedAt: at } });
        }
        return res.modifiedCount > 0;
    } catch (e) {
        console.log(`Push: could not record ${event} receipt: ${e && e.message}`);
        return false;
    }
}

// A service worker that posts receipts has just taken over this device. Marks
// the subscription so missing receipts from here on mean something. Only the
// first announcement counts.
async function hello(endpoint, nowMs) {
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2048) return false;
    try {
        const res = await Account.updateOne(
            { pushSubscriptions: { $elemMatch: { endpoint, receiptsSince: { $exists: false } } } },
            { $set: { 'pushSubscriptions.$.receiptsSince': new Date(nowMs == null ? Date.now() : nowMs) } }
        );
        return res.modifiedCount > 0;
    } catch (e) {
        console.log(`Push: could not record service-worker hello: ${e && e.message}`);
        return false;
    }
}

// Every device an account holds, with its health and recent sends (newest
// first), plus the manager's own setting changes. `subs` is the account's
// pushSubscriptions; sends to an endpoint no longer registered come back as a
// removed device so the trail of what happened to it is still there.
async function summarize(accountId, subs, { days = 14, limit = 40, nowMs = Date.now() } = {}) {
    const since = new Date(nowMs - days * DAY);
    let rows = [];
    let settings = [];
    try {
        rows = await PushLog.find({ accountId, kind: 'send', at: { $gte: since } },
            { _id: 0, accountId: 0, expireAt: 0, kind: 0 }).sort({ at: -1 }).lean();
        settings = await PushLog.find({ accountId, kind: 'setting' },
            { _id: 0, accountId: 0, expireAt: 0, kind: 0 }).sort({ at: -1 }).limit(50).lean();
    } catch (e) {
        console.log(`Push: could not read push log for ${accountId}: ${e && e.message}`);
    }
    // deviceHealth reads sentAt.
    rows.forEach(r => { r.sentAt = r.at; });
    const byDevice = new Map();
    for (const r of rows) {
        if (!byDevice.has(r.device)) byDevice.set(r.device, []);
        byDevice.get(r.device).push(r);
    }
    const devices = (subs || []).map(s => {
        const key = deviceKey(s.endpoint);
        const mine = byDevice.get(key) || [];
        byDevice.delete(key);
        return {
            device: key,
            label: deviceLabel(s.userAgent),
            registeredAt: s.createdAt || null,
            receiptsSince: s.receiptsSince || null,
            registered: true,
            health: deviceHealth(mine, { receiptsSince: s.receiptsSince, nowMs }),
            recent: mine.slice(0, limit)
        };
    });
    for (const [key, mine] of byDevice) {
        devices.push({
            device: key,
            label: mine[0].deviceLabel || 'Unknown device',
            registeredAt: null,
            receiptsSince: null,
            registered: false,
            health: deviceHealth(mine, { nowMs }),
            recent: mine.slice(0, limit)
        });
    }
    return { devices, settings };
}

module.exports = {
    newSendId, deviceKey, deviceLabel, describePrefChange,
    startSends, finishSends, recordSetting, receipt, hello, summarize,
    SEND_ID, SEND_TTL_MS, SETTING_TTL_MS
};
