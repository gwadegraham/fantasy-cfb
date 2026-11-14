// Service worker for game-day push alerts.
//
// Served from /sw.js (public/ is mounted at the root by server.js), so its
// scope is the whole origin — which is what lets a notification tapped from the
// lock screen focus an already-open Campus Clash tab on any page.
//
// DELIBERATELY NO `fetch` HANDLER. A service worker that caches would make this
// app worse, not better: nearly every page is live data (scores mid-game, the
// draft room over a socket, standings that re-score every 10 seconds), and a
// stale-while-revalidate shell is exactly how someone ends up staring at a
// two-hour-old score and trusting it. This worker exists only to receive push
// events. If offline support is ever wanted, it needs its own design pass and
// an explicit list of what is safe to cache — not a default bolted on here.

// Take over immediately rather than waiting for every tab to close, so a
// deployed fix to this file reaches devices on their next visit instead of
// whenever they next quit the app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(Promise.all([
    self.clients.claim(),
    announceReceipts()
])));

// ---- delivery receipts --------------------------------------------------------
//
// The push service's 201 only means Apple accepted a notification, and Apple
// accepts them for subscriptions the phone has silently dropped. So the worker
// tells the server when one actually lands, and again when it is tapped
// (routes/push-receipt.js). Every receipt is best-effort: a failed post must
// never stop the notification itself from showing.
function postReceipt(body) {
    return fetch('/push/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        keepalive: true
    }).catch(() => {});
}

// "This device's worker sends receipts from now on." Until the server hears
// this, a missing receipt could just be the previous version of this file, so
// modules/push-health.js will not call the device silent.
function announceReceipts() {
    return (async () => {
        try {
            const sub = await self.registration.pushManager.getSubscription();
            if (sub && sub.endpoint) await postReceipt({ event: 'hello', endpoint: sub.endpoint });
        } catch (e) { /* best effort */ }
    })();
}

self.addEventListener('push', (event) => {
    // A push with no payload (or an undecryptable one) still deserves a
    // notification: on iOS, failing to show one after a push is delivered can
    // cost the site its push permission entirely.
    let data = {};
    if (event.data) {
        try { data = event.data.json(); } catch (e) { data = { body: event.data.text() }; }
    }

    const title = data.title || 'Campus Clash';
    const options = {
        body: data.body || '',
        // Per-notification icon and big picture, when a payload carries them.
        //
        // MEASURED ON A REAL IPHONE (12 Sep 2026): iOS renders NEITHER. It
        // substitutes the home-screen app icon and ignores both fields, so team
        // logos cannot appear in these notifications on the platform this league
        // actually uses — don't spend time trying again. Emoji in the title are
        // the only visual that works; see buildPayload in modules/push-notify.js.
        //
        // Kept because both are correct on Android and desktop, and because
        // leaving them means a future change of Apple's mind needs no code.
        icon: data.icon || '/images/app-icon-192.png',
        image: data.image || undefined,
        badge: '/images/icon-192.png',
        // Same tag = same game, so a busy game replaces its own banner instead
        // of stacking one per touchdown.
        tag: data.tag || 'campus-clash',
        renotify: true,
        data: { url: data.url || '/standings', type: data.type || null, sid: data.sid || null }
    };

    event.waitUntil(Promise.all([
        self.registration.showNotification(title, options),
        data.sid ? postReceipt({ sid: data.sid, event: 'received' }) : null
    ]));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/standings';
    const sid = event.notification.data && event.notification.data.sid;
    if (sid) event.waitUntil(postReceipt({ sid, event: 'opened' }));

    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // Prefer reusing an open window. Opening a second one on a phone means
        // the manager ends up with duplicate app instances.
        for (const client of all) {
            if ('focus' in client) {
                await client.focus();
                if ('navigate' in client) {
                    try { await client.navigate(target); } catch (e) { /* focus alone is fine */ }
                }
                return;
            }
        }
        if (self.clients.openWindow) await self.clients.openWindow(target);
    })());
});
