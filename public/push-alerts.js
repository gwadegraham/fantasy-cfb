// Client for game-day push alerts: registers the service worker, subscribes the
// browser, and drives the Alerts section of the profile modal.
//
// The shape of this UI is dictated by one iOS constraint: Safari will not show a
// notification permission prompt to a normal tab. The site has to be installed
// to the home screen first (Share -> Add to Home Screen), after which it runs in
// standalone mode and can ask. So the control has three honest states — "install
// first", "turn on", "on" — rather than a toggle that silently does nothing on
// the one platform every manager in this league actually uses.
//
// Turning this on is the manager's own opt-in — the subscription IS the gate, so
// anyone who installs and turns alerts on gets them. The one exception worth
// surfacing: delivery can be narrowed to specific ids in an emergency
// (PUSH_RECIPIENT_IDS, modules/push-notify.js). The server reports that as
// `allowed`, so a manager outside a narrowed window is told their device is
// registered but quiet, instead of being left to wonder.

(function () {
    'use strict';

    // Mirrors LEAD_CHOICES in modules/captain-reminder.js. Duplicated rather than
    // fetched: it is seven fixed strings, and the server validates the value
    // anyway — a stale copy here can only ever be rejected, never stored.
    var LEAD_CHOICES = [
        { minutes: 30, label: '30 minutes' },
        { minutes: 60, label: '1 hour' },
        { minutes: 120, label: '2 hours' },
        { minutes: 180, label: '3 hours' },
        { minutes: 360, label: '6 hours' },
        { minutes: 720, label: '12 hours' },
        { minutes: 1440, label: '1 day' }
    ];
    var DEFAULT_LEAD_MINUTES = 120;

    // The panel in sections (#557). The server says which apply to this
    // manager (`sections` from GET /users/me/push), so nobody sees a switch for
    // an alert that can never reach them:
    //   shared      Captain lock — only when a league of theirs plays Captain —
    //               and the weekly recap, which both sports send.
    //   football    its four game alerts, for a football franchise.
    //   basketball  its three, for a basketball franchise. Separate keys from
    //               football's, so muting one sport leaves the other alone.
    //
    // Game alerts are ordered loudest-last. captainLock leads because it is the
    // only one that asks the manager to DO something before a deadline. Its hint
    // is built from the manager's own lead, so the row never advertises a timing
    // they have changed. The basketball crunch-time hint mirrors
    // modules/hoops-score-events.js.
    var SECTIONS = [
        { id: 'shared', types: [
            { key: 'captainLock', label: 'Captain lock', lead: true, captain: true, hint: 'Before your weekly pick locks.' },
            { key: 'recapReady', label: 'Weekly recap', hint: 'Monday morning, when your week is written up.' }
        ] },
        { id: 'football', title: '🏈 Football', types: [
            { key: 'final', label: 'Final results', hint: 'Your team finished — and what it banked.' },
            { key: 'leadChange', label: 'Lead changes', hint: 'When your team takes or loses the lead.' },
            { key: 'closeGame', label: 'Crunch time', hint: 'Under 2:00, one score apart.' },
            { key: 'score', label: 'Every score', hint: 'Loudest by far — roughly 40 a Saturday.' }
        ] },
        { id: 'basketball', title: '🏀 Basketball', types: [
            { key: 'hoopsFinal', label: 'Final results', hint: 'Your team finished — and what it banked.' },
            { key: 'hoopsCloseGame', label: 'Crunch time', hint: 'Second half, 4:00 or less, within 5.' },
            { key: 'hoopsTipoff', label: 'Tip-off', hint: 'When one of your teams starts a game.' }
        ] }
    ];

    // A server that predates `sections` gets the panel it always had.
    var LEGACY_SECTIONS = { football: true, basketball: false, captain: true };

    // iOS only exposes the Push API to an installed PWA. Both checks matter:
    // `standalone` is the old Safari flag, the media query is the standard one.
    function isStandalone() {
        return !!(window.navigator.standalone
            || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function supported() {
        return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
    }

    // VAPID keys travel as base64url; PushManager wants a Uint8Array.
    function urlBase64ToUint8Array(base64String) {
        var padding = '='.repeat((4 - base64String.length % 4) % 4);
        var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        var raw = window.atob(base64);
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    var swReady = null;
    function registerWorker() {
        if (!swReady) swReady = navigator.serviceWorker.register('/sw.js');
        return swReady;
    }

    async function getState() {
        var res = await fetch('/users/me/push', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('Could not load alert settings.');
        return res.json();
    }

    async function subscribe(vapidPublicKey) {
        var reg = await registerWorker();
        await navigator.serviceWorker.ready;

        var permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notifications were blocked. Turn them on in Settings to continue.');

        // Reuse an existing subscription when there is one; re-subscribing with a
        // different key throws rather than replacing.
        var sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
            });
        }

        var res = await fetch('/users/me/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: sub.toJSON() })
        });
        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.message || 'Could not register this device.');
        }
        return res.json();
    }

    async function unsubscribe() {
        try {
            var reg = await registerWorker();
            var sub = await reg.pushManager.getSubscription();
            if (sub) await sub.unsubscribe();
        } catch (e) { /* the server record is what matters; clear it regardless */ }
        await fetch('/users/me/push', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
    }

    async function savePref(key, value) {
        var body = {};
        body[key] = value;
        await fetch('/users/me/push/prefs', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    async function sendTest() {
        var res = await fetch('/users/me/push/test', { method: 'POST' });
        return res.json();
    }

    // ---- rendering ----------------------------------------------------------

    function mount(root) {
        if (!root || root.dataset.wired) return;
        root.dataset.wired = '1';

        var status = root.querySelector('[push-status]');
        var actions = root.querySelector('[push-actions]');
        var prefsWrap = root.querySelector('[push-prefs]');

        function say(msg, tone) {
            status.textContent = msg;
            status.className = 'push-status' + (tone ? ' push-status-' + tone : '');
        }

        function clearActions() { actions.innerHTML = ''; }

        function button(label, cls, onClick) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = cls;
            b.textContent = label;
            b.addEventListener('click', function () { onClick(b); });
            actions.appendChild(b);
            return b;
        }

        // The "how far ahead" picker on the Captain row.
        //
        // It sits inside the row's <label>, and the first cut guarded against
        // that by calling preventDefault on the select's own click and mousedown
        // — which is precisely what stops a native <select> from opening. The
        // dropdown was unclickable. No guard is needed: the HTML spec skips a
        // label's activation behaviour when the event target is interactive
        // content, and a <select> is interactive content, so clicking it has
        // never toggled the checkbox. There is a test below for that, clicking
        // for real rather than dispatching a synthetic event — a dispatched
        // click cannot tell a suppressed dropdown from a working one.
        function leadPicker(current, onSaved) {
            var sel = document.createElement('select');
            sel.className = 'push-pref-lead';
            sel.setAttribute('aria-label', 'How long before the lock');
            LEAD_CHOICES.forEach(function (c) {
                var o = document.createElement('option');
                o.value = String(c.minutes);
                o.textContent = c.label + ' before';
                sel.appendChild(o);
            });
            sel.value = String(current);
            sel.addEventListener('change', function () {
                var was = sel.dataset.was || String(current);
                savePref('captainLockLeadMinutes', Number(sel.value))
                    .then(function () { sel.dataset.was = sel.value; onSaved(Number(sel.value)); })
                    .catch(function () {
                        sel.value = was;
                        say('Could not save that setting.', 'error');
                    });
            });
            sel.dataset.was = String(current);
            return sel;
        }

        function leadLabel(minutes) {
            for (var i = 0; i < LEAD_CHOICES.length; i++) {
                if (LEAD_CHOICES[i].minutes === Number(minutes)) return LEAD_CHOICES[i].label;
            }
            return '2 hours';
        }

        function renderPrefs(prefs, sections) {
            prefsWrap.innerHTML = '';
            SECTIONS.forEach(function (sec) {
                if (sec.id !== 'shared' && !sections[sec.id]) return;
                var types = sec.types.filter(function (t) { return !t.captain || sections.captain; });
                if (!types.length) return;
                var group = document.createElement('div');
                group.className = 'push-pref-group';
                group.setAttribute('data-section', sec.id);
                if (sec.title) {
                    var h = document.createElement('p');
                    h.className = 'push-pref-heading';
                    h.textContent = sec.title;
                    group.appendChild(h);
                }
                types.forEach(function (t) { group.appendChild(prefRow(t, prefs)); });
                prefsWrap.appendChild(group);
            });
            prefsWrap.hidden = false;
        }

        function prefRow(t, prefs) {
            var row = document.createElement('label');
            row.className = 'push-pref';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = prefs[t.key] !== false;
            cb.addEventListener('change', function () {
                savePref(t.key, cb.checked).catch(function () {
                    cb.checked = !cb.checked;
                    say('Could not save that setting.', 'error');
                });
            });
            var text = document.createElement('span');
            text.className = 'push-pref-text';
            text.innerHTML = '<strong></strong><em></em>';
            text.querySelector('strong').textContent = t.label;
            var hint = text.querySelector('em');
            hint.textContent = t.hint;
            row.appendChild(cb);
            row.appendChild(text);

            if (t.lead) {
                var mins = prefs.captainLockLeadMinutes || DEFAULT_LEAD_MINUTES;
                var setHint = function (m) { hint.textContent = leadLabel(m) + ' before your weekly pick locks.'; };
                setHint(mins);
                row.appendChild(leadPicker(mins, setHint));
            }

            return row;
        }

        async function render() {
            clearActions();
            prefsWrap.hidden = true;

            if (!supported()) {
                // On iOS an uninstalled site reports no PushManager at all, so
                // this branch has to distinguish "install it" from "this browser
                // can't" — otherwise every iPhone reads as unsupported.
                if (isIOS() && !isStandalone()) {
                    say('Add Campus Clash to your home screen first (Share → Add to Home Screen), then reopen it from there to turn on alerts.', 'info');
                } else {
                    say('This browser does not support push notifications.', 'info');
                }
                return;
            }

            var state;
            try { state = await getState(); }
            catch (e) { return say(e.message, 'error'); }

            if (!state.configured) {
                return say('Alerts are not configured on the server yet.', 'info');
            }

            if (state.deviceCount > 0) {
                var quiet = state.allowed ? ''
                    : state.reason === 'no-roster'
                        ? ' This device is registered, but you have no roster this season — alerts start once your league drafts.'
                        : ' This device is registered, but alerts are temporarily limited to a few managers — you will not get anything until that lifts.';
                say('Alerts are on for ' + state.deviceCount + (state.deviceCount === 1 ? ' device.' : ' devices.') + quiet, state.allowed ? 'ok' : 'info');
                renderPrefs(state.prefs || {}, state.sections || LEGACY_SECTIONS);
                if (state.allowed) {
                    button('Send a test', 'btn-secondary', async function (b) {
                        b.disabled = true;
                        try {
                            var out = await sendTest();
                            say(out.sent ? 'Test sent — check your lock screen.' : (out.reason || 'Nothing was sent.'), out.sent ? 'ok' : 'info');
                        } catch (e) { say('Test failed.', 'error'); }
                        b.disabled = false;
                    });
                }
                button('Turn off', 'btn-ghost', async function (b) {
                    b.disabled = true;
                    try { await unsubscribe(); await render(); }
                    catch (e) { say('Could not turn alerts off.', 'error'); b.disabled = false; }
                });
                return;
            }

            if (isIOS() && !isStandalone()) {
                return say('Add Campus Clash to your home screen first (Share → Add to Home Screen), then reopen it from there to turn on alerts.', 'info');
            }

            say('Get a notification when your teams score, take the lead, or finish.', '');
            button('Turn on alerts', 'btn-primary', async function (b) {
                b.disabled = true;
                try {
                    await subscribe(state.vapidPublicKey);
                    await render();
                } catch (e) {
                    say(e.message, 'error');
                    b.disabled = false;
                }
            });
        }

        render();
    }

    window.PushAlerts = { mount: mount };
})();
