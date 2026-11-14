// Admin "Push deliveries" card (views/admin.ejs, Monitoring). Reads
// GET /push-deliveries (routes/push-deliveries.js) and lays out, per manager:
// each device, whether it is hearing us, every recent send with what the push
// service said and whether the phone confirmed it, and the manager's own alert
// setting changes.
//
// Built to settle "I never got it". Every send reads one of three ways, and
// the card says which in words:
//   - refused by the push service       -> our side / the subscription
//   - accepted, no receipt from device   -> it never reached the device
//   - arrived (and maybe opened)         -> it was on their phone
// "Copy report" puts the same thing as plain text on the clipboard.

(function () {
    var CT = { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

    function when(d) {
        return d ? new Date(d).toLocaleString('en-US', CT) + ' CT' : '—';
    }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    var HEALTH = {
        ok: ['pd-ok', 'Receiving'],
        silent: ['pd-bad', 'Not receiving'],
        unproven: ['pd-warn', 'No receipts yet'],
        idle: ['pd-dim', 'Nothing sent yet']
    };

    var ACTIONS = {
        'device.registered': 'Turned alerts on for a device',
        'device.repaired': 'Device re-registered itself on app open',
        'device.removed': 'Removed a device',
        'device.evicted': 'Oldest device dropped (device limit)',
        'alerts.off': 'Turned alerts OFF',
        prefs: 'Changed alert settings',
        test: 'Sent themselves a test'
    };

    // One send, in words.
    function verdict(r) {
        if (r.status === 'gone') return 'Push service said the subscription no longer exists (' + (r.statusCode || '?') + ') — device removed';
        if (r.status === 'failed') return 'Push service refused it (' + (r.statusCode || 'error') + (r.error ? ': ' + r.error : '') + ')';
        if (r.openedAt) return 'Arrived ' + when(r.receivedAt) + ' · tapped ' + when(r.openedAt);
        if (r.receivedAt) return 'Arrived on the phone ' + when(r.receivedAt) + ' · not tapped';
        return 'Accepted by the push service · device never confirmed it arrived (device off or offline, or subscription dead)';
    }

    function sendTitle(r) {
        return (r.title || r.type || 'Alert') + (r.week != null ? ' (week ' + r.week + ')' : '');
    }

    function report(m) {
        var lines = ['Push report — ' + m.name, ''];
        m.devices.forEach(function (d) {
            var h = HEALTH[d.health.status] || HEALTH.idle;
            lines.push(d.label + (d.registered ? '' : ' (removed)') + ' — ' + h[1]
                + (d.registeredAt ? ' · registered ' + when(d.registeredAt) : ''));
            d.recent.forEach(function (r) {
                lines.push('  ' + when(r.at) + ' — ' + sendTitle(r) + ': ' + verdict(r));
            });
            lines.push('');
        });
        if (m.settings.length) {
            lines.push('Their alert-setting changes:');
            m.settings.forEach(function (s) {
                lines.push('  ' + when(s.at) + ' — ' + (ACTIONS[s.action] || s.action)
                    + (s.detail ? ': ' + s.detail : '') + (s.deviceLabel ? ' (' + s.deviceLabel + ')' : ''));
            });
        }
        return lines.join('\n');
    }

    function renderManager(m) {
        var box = el('details', 'pd-manager');
        var worst = m.devices.filter(function (d) { return d.registered; })
            .map(function (d) { return d.health.status; });
        var flag = worst.indexOf('silent') !== -1 ? HEALTH.silent
            : worst.indexOf('unproven') !== -1 ? HEALTH.unproven
            : worst.length ? HEALTH.ok : ['pd-dim', 'No device'];
        var sum = el('summary', 'pd-summary');
        sum.appendChild(el('span', 'pd-name', m.name));
        sum.appendChild(el('span', 'pd-chip ' + flag[0], flag[1]));
        box.appendChild(sum);

        var copy = el('button', 'pd-copy', 'Copy report');
        copy.type = 'button';
        copy.addEventListener('click', function () {
            var text = report(m);
            (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
                .then(function () { copy.textContent = 'Copied'; })
                .catch(function () { window.prompt('Copy the report:', text); });
        });
        box.appendChild(copy);

        m.devices.forEach(function (d) {
            var h = HEALTH[d.health.status] || HEALTH.idle;
            var dev = el('div', 'pd-device');
            var head = el('div', 'pd-device-head');
            head.appendChild(el('span', 'pd-device-name', d.label + (d.registered ? '' : ' (removed)')));
            head.appendChild(el('span', 'pd-chip ' + h[0], h[1]));
            dev.appendChild(head);
            var meta = [];
            if (d.registeredAt) meta.push('registered ' + when(d.registeredAt));
            if (d.health.lastReceivedAt) meta.push('last confirmed arrival ' + when(d.health.lastReceivedAt));
            if (d.health.silentStreak) meta.push(d.health.silentStreak + ' unconfirmed in a row');
            if (meta.length) dev.appendChild(el('div', 'pd-meta', meta.join(' · ')));
            var list = el('ul', 'pd-sends');
            if (!d.recent.length) list.appendChild(el('li', 'pd-empty', 'No sends in this window.'));
            d.recent.forEach(function (r) {
                var li = el('li', 'pd-send pd-' + (r.status === 'accepted' ? (r.receivedAt ? 'arrived' : 'unconfirmed') : 'refused'));
                li.appendChild(el('div', 'pd-send-what', when(r.at) + ' — ' + sendTitle(r)));
                li.appendChild(el('div', 'pd-send-verdict', verdict(r)));
                list.appendChild(li);
            });
            dev.appendChild(list);
            box.appendChild(dev);
        });

        if (m.settings.length) {
            box.appendChild(el('div', 'pd-settings-h', 'Their alert-setting changes'));
            var sl = el('ul', 'pd-settings');
            m.settings.forEach(function (s) {
                sl.appendChild(el('li', 'pd-setting', when(s.at) + ' — ' + (ACTIONS[s.action] || s.action)
                    + (s.detail ? ': ' + s.detail : '') + (s.deviceLabel ? ' (' + s.deviceLabel + ')' : '')));
            });
            box.appendChild(sl);
        }
        return box;
    }

    async function load() {
        var root = document.querySelector('[push-deliveries]');
        if (!root) return;
        root.innerHTML = '';
        root.appendChild(el('p', 'pd-empty', 'Loading…'));
        try {
            var res = await fetch('/push-deliveries', { headers: { Accept: 'application/json' } });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var data = await res.json();
            root.innerHTML = '';
            if (!data.managers.length) {
                root.appendChild(el('p', 'pd-empty', 'No alerts sent in the last ' + data.days + ' days.'));
                return;
            }
            data.managers.forEach(function (m) { root.appendChild(renderManager(m)); });
        } catch (e) {
            root.innerHTML = '';
            root.appendChild(el('p', 'pd-empty', 'Could not load deliveries (' + e.message + ').'));
        }
    }

    window.displayPushDeliveriesContainer = function () {
        if (window.toggleSub && window.toggleSub('push-deliveries-container')) load();
    };
    window.AdminPush = { load: load, verdict: verdict, report: report };
})();
