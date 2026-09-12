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
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
        // Per-notification icon (a team logo) when the payload carries one,
        // falling back to the Campus Clash football. iOS is expected to ignore
        // this and substitute the home-screen app icon; the "Send a test"
        // probe in modules/push-notify.js exists to settle that on a real phone.
        icon: data.icon || '/images/icon-192.png',
        // The big-picture slot, shown when the banner is pulled down. Only set
        // when a payload asks for it — an unused `image` still costs a fetch.
        image: data.image || undefined,
        badge: '/images/icon-192.png',
        // Same tag = same game, so a busy game replaces its own banner instead
        // of stacking one per touchdown.
        tag: data.tag || 'campus-clash',
        renotify: true,
        data: { url: data.url || '/standings', type: data.type || null }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/standings';

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
