// Is a push device actually receiving what we send it?
//
// DB-free so the rule is unit-testable. modules/push-delivery.js feeds it the
// rows from the `pushlogs` collection (models/pushLog.js); the admin card and the
// manager's "alerts may not be reaching this phone" banner both read its answer.
//
// Why this exists: Apple's push service answers 201 to a subscription the phone
// has silently thrown away (a Safari update, a reinstall). The server therefore
// believed every Captain reminder Trevor missed in Oct–Nov 2026 was delivered.
// public/sw.js now posts a receipt when a notification lands, so "Apple took
// it" and "the phone got it" are two separate facts at last.
//
// The verdicts:
//   ok        the most recent judged send has a receipt (or the streak of
//             unreceipted ones is still short)
//   silent    MIN_SILENT or more sends in a row, each accepted by the push
//             service, none received — on a device that HAS delivered a
//             receipt before, so it is proven able to and has stopped. That
//             is the Safari-update case: it worked, then went dead
//   unproven  unreceipted sends and no receipt ever. Either the device
//             predates receipts, the phone's OS will not let a backgrounded
//             worker post one (not yet verified on iOS), or it is dead. The
//             admin sees it; the manager is never nagged on it — a banner on
//             an unverified signal would cry wolf at every iPhone
//   idle      nothing judged yet

// Three in a row, not one: a single missing receipt is far more likely to be
// a phone that was offline or in Low Power Mode than a dead subscription, and a
// banner telling someone their alerts are broken when they are not is how
// people learn to ignore banners.
const MIN_SILENT = 3;

// A send younger than this is not judged yet. Apple can hold a notification for
// a phone that is offline; a receipt for it arrives whenever the phone wakes.
const GRACE_MS = 15 * 60 * 1000;

const ms = d => new Date(d).getTime();

// `rows`: one device's deliveries, any order — { status, sentAt, receivedAt }.
// `receiptsSince` (when the device's worker announced it posts receipts) is
// accepted for the callers' convenience but no longer decides anything: a real
// receipt is the only proof that counts.
function deviceHealth(rows, { nowMs = Date.now(),
    minSilent = MIN_SILENT, graceMs = GRACE_MS } = {}) {
    const all = (rows || []).slice().sort((a, b) => ms(b.sentAt) - ms(a.sentAt));
    const accepted = all.filter(r => r.status === 'accepted');
    const received = accepted.filter(r => r.receivedAt);
    const lastReceivedAt = received.length ? received[0].receivedAt : null;
    const out = {
        status: 'idle',
        silentStreak: 0,
        sends: all.length,
        received: received.length,
        lastSentAt: all.length ? all[0].sentAt : null,
        lastReceivedAt
    };

    // Old enough to judge, newest first.
    const judged = accepted.filter(r => ms(r.sentAt) <= nowMs - graceMs);
    if (!judged.length) return out;

    let streak = 0;
    for (const r of judged) {
        if (r.receivedAt) break;
        streak++;
    }
    out.silentStreak = streak;

    if (streak < minSilent) {
        out.status = received.length ? 'ok' : 'unproven';
        return out;
    }
    out.status = received.length ? 'silent' : 'unproven';
    return out;
}

module.exports = { deviceHealth, MIN_SILENT, GRACE_MS };
