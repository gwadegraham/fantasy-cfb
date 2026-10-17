/**
 * @jest-environment jsdom
 *
 * public/push-alerts.js — the alert preferences panel.
 *
 * Written after shipping a lead-time dropdown that could not be opened. It sits
 * inside the row's <label>, so the first cut "protected" the checkbox by calling
 * preventDefault on the select's own click and mousedown — which is exactly what
 * stops a native <select> from opening, and from taking focus.
 *
 * The verification that missed it dispatched a synthetic click and asserted the
 * checkbox had not toggled. That passed, for the wrong reason: a suppressed
 * dropdown and a working one are indistinguishable if the only thing you check
 * is the OTHER control. So the assertion here is on defaultPrevented — whether
 * anything is cancelling the event the browser needs in order to open the list.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'push-alerts.js'), 'utf8');

const PANEL = `
    <section class="push-alerts" push-alerts>
        <p class="push-status" push-status></p>
        <div class="push-prefs" push-prefs hidden></div>
        <div class="push-actions" push-actions></div>
    </section>`;

let patched;
let posted;

const THIS_DEVICE = 'https://push.example/this-device';

// Lets render() finish, including the re-render after an automatic subscribe.
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };

// `device` is this browser: the endpoint its push subscription holds (null for
// none) and its notification permission. By default it is the device the
// server has on file, which is the ordinary "alerts are on" case.
async function mountPanel(prefs = {}, state = {}, device = {}) {
    document.body.innerHTML = PANEL;
    const dev = Object.assign({ endpoint: THIS_DEVICE, permission: 'granted', subscribeFails: false }, device);

    // supported() needs all three, or the panel renders "this browser can't".
    let browserSub = dev.endpoint ? { endpoint: dev.endpoint, toJSON: () => ({ endpoint: dev.endpoint }) } : null;
    const reg = {
        pushManager: {
            getSubscription: jest.fn(() => Promise.resolve(browserSub)),
            subscribe: jest.fn(() => {
                if (dev.subscribeFails) return Promise.reject(new Error('push service unavailable'));
                const endpoint = 'https://push.example/fresh';
                browserSub = { endpoint, toJSON: () => ({ endpoint }) };
                return Promise.resolve(browserSub);
            })
        }
    };
    navigator.serviceWorker = {
        register: jest.fn(() => Promise.resolve(reg)),
        getRegistration: jest.fn(() => Promise.resolve(reg)),
        ready: Promise.resolve(reg)
    };
    window.PushManager = function () {};
    window.Notification = function () {};
    window.Notification.permission = dev.permission;
    window.Notification.requestPermission = jest.fn(() => Promise.resolve(dev.permission));

    const server = Object.assign(
        { configured: true, deviceCount: 1, allowed: true, prefs, endpoints: [THIS_DEVICE], vapidPublicKey: 'BATOte0IVNQu' }, state);

    patched = [];
    posted = [];
    window.fetch = jest.fn((url, opts) => {
        if (String(url).indexOf('/users/me/push/prefs') === 0) {
            patched.push(JSON.parse(opts.body));
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (String(url) === '/users/me/push' && opts && opts.method === 'POST') {
            const endpoint = JSON.parse(opts.body).subscription.endpoint;
            posted.push(endpoint);
            server.endpoints = server.endpoints.concat(endpoint);
            server.deviceCount = server.endpoints.length;
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ deviceCount: server.deviceCount }) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(Object.assign({}, server)) });
    });

    // The module is an IIFE that publishes window.PushAlerts on load.
    // eslint-disable-next-line no-eval
    window.eval(SOURCE);
    window.PushAlerts.mount(document.querySelector('[push-alerts]'));
    await settle();
}

const leadRow = () => document.querySelector('.push-pref-lead').closest('.push-pref');
const leadSelect = () => document.querySelector('.push-pref-lead');

afterEach(() => { delete window.PushAlerts; });

describe('the lead-time dropdown', () => {
    it('renders on the Captain row with every offered choice', async () => {
        await mountPanel();
        const sel = leadSelect();
        expect(sel).not.toBeNull();
        expect([...sel.options].map(o => o.value))
            .toEqual(['30', '60', '120', '180', '360', '720', '1440']);
        expect(document.querySelectorAll('.push-pref-lead')).toHaveLength(1);   // only that row
    });

    it('is the only row with a picker — the recap row is a plain switch', async () => {
        await mountPanel();
        const labels = [...document.querySelectorAll('.push-pref strong')].map(e => e.textContent);
        expect(labels).toEqual(['Captain lock', 'Weekly recap', 'Final results',
            'Lead changes', 'Crunch time', 'Every score']);
        const recapRow = [...document.querySelectorAll('.push-pref')]
            .find(r => r.querySelector('strong').textContent === 'Weekly recap');
        expect(recapRow.querySelector('select')).toBeNull();
    });

    it('shows the manager\'s stored lead, and the default when they have none', async () => {
        await mountPanel({ captainLockLeadMinutes: 360 });
        expect(leadSelect().value).toBe('360');
        expect(leadRow().querySelector('em').textContent).toBe('6 hours before your weekly pick locks.');

        await mountPanel({});
        expect(leadSelect().value).toBe('120');
    });

    // THE REGRESSION. A cancelled mousedown is what stops the browser opening
    // the list and giving the select focus — the dropdown reads as dead.
    it('does not cancel the events the browser needs to open the list', async () => {
        await mountPanel();
        const sel = leadSelect();

        ['mousedown', 'click', 'pointerdown', 'touchstart'].forEach(type => {
            const ev = new window.Event(type, { bubbles: true, cancelable: true });
            sel.dispatchEvent(ev);
            expect({ type, defaultPrevented: ev.defaultPrevented })
                .toEqual({ type, defaultPrevented: false });
        });
    });

    // The reason the (harmful) guard was added. It was never needed: the HTML
    // spec skips a label's activation behaviour when the event target is
    // interactive content, and a <select> is interactive content.
    it('leaves the row\'s mute checkbox alone when the dropdown is used', async () => {
        await mountPanel();
        const cb = leadRow().querySelector('input[type=checkbox]');
        expect(cb.checked).toBe(true);

        leadSelect().dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
        leadSelect().value = '30';
        leadSelect().dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 0));

        expect(cb.checked).toBe(true);
        expect(patched).toEqual([{ captainLockLeadMinutes: 30 }]);   // no stray boolean
    });

    it('rewrites the hint to match the new lead', async () => {
        await mountPanel();
        leadSelect().value = '1440';
        leadSelect().dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 0));

        expect(leadRow().querySelector('em').textContent).toBe('1 day before your weekly pick locks.');
    });

    // A dropdown showing a value the server never took is worse than an error.
    it('rolls back and says so when the save fails', async () => {
        await mountPanel();
        window.fetch = jest.fn(() => Promise.reject(new Error('offline')));

        leadSelect().value = '30';
        leadSelect().dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 0));

        expect(leadSelect().value).toBe('120');
        expect(document.querySelector('[push-status]').textContent).toBe('Could not save that setting.');
    });
});

describe('the mute switches', () => {
    it('still toggle, and send only their own key', async () => {
        await mountPanel();
        const final = [...document.querySelectorAll('.push-pref')]
            .find(r => r.textContent.indexOf('Final results') === 0 || r.textContent.includes('Final results'));
        const cb = final.querySelector('input[type=checkbox]');

        cb.checked = false;
        cb.dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 0));

        expect(patched).toEqual([{ final: false }]);
    });
});

// #568: `allowed` is false for two reasons, and only one of them is the
// allowlist. A basketball manager was told alerts were "limited to a few
// managers" when the server had simply looked in football's season.
describe('the status line when alerts would not reach this manager', () => {
    const status = () => document.querySelector('[push-status]').textContent;

    it('says "no roster this season", not the allowlist, for reason no-roster', async () => {
        await mountPanel({}, { allowed: false, reason: 'no-roster' });
        expect(status()).toMatch(/no roster this season/);
        expect(status()).not.toMatch(/limited to a few managers/);
    });

    it('still names the allowlist when that is the reason', async () => {
        await mountPanel({}, { allowed: false, reason: 'restricted' });
        expect(status()).toMatch(/limited to a few managers/);
    });
});

// #557: the panel in sections, so nobody sees a switch that can never fire.
describe('the panel sections', () => {
    const ALL = { football: true, basketball: true, captain: true };
    const labelsIn = (id) => [...document.querySelectorAll(`[data-section="${id}"] .push-pref strong`)].map(e => e.textContent);
    const headings = () => [...document.querySelectorAll('.push-pref-heading')].map(e => e.textContent);
    const rowIn = (id, label) => [...document.querySelectorAll(`[data-section="${id}"] .push-pref`)]
        .find(r => r.querySelector('strong').textContent === label);

    it('a two-sport manager in a Captain league sees all three sections', async () => {
        await mountPanel({}, { sections: ALL });
        expect(labelsIn('shared')).toEqual(['Captain lock', 'Weekly recap']);
        expect(labelsIn('football')).toEqual(['Final results', 'Lead changes', 'Crunch time', 'Every score']);
        expect(labelsIn('basketball')).toEqual(['Final results', 'Crunch time', 'Tip-off']);
        expect(headings()).toEqual(['🏈 Football', '🏀 Basketball']);
    });

    it('basketball only: no football rows', async () => {
        await mountPanel({}, { sections: { football: false, basketball: true, captain: true } });
        expect(document.querySelector('[data-section="football"]')).toBeNull();
        expect(headings()).toEqual(['🏀 Basketball']);
    });

    it('football only: no basketball rows', async () => {
        await mountPanel({}, { sections: { football: true, basketball: false, captain: true } });
        expect(document.querySelector('[data-section="basketball"]')).toBeNull();
    });

    // A Claunts-only manager: the reminder is never sent where Captain is off.
    it('no league playing Captain: no Captain lock row, and no lead picker', async () => {
        await mountPanel({}, { sections: { football: true, basketball: false, captain: false } });
        expect(labelsIn('shared')).toEqual(['Weekly recap']);
        expect(document.querySelector('.push-pref-lead')).toBeNull();
    });

    it('a server without `sections` gets the panel it always had', async () => {
        await mountPanel();
        expect(labelsIn('shared')).toEqual(['Captain lock', 'Weekly recap']);
        expect(labelsIn('football')).toHaveLength(4);
        expect(document.querySelector('[data-section="basketball"]')).toBeNull();
    });

    it('basketball rows reflect the stored pref and save their OWN key, not football\'s', async () => {
        await mountPanel({ hoopsCloseGame: false }, { sections: ALL });
        expect(rowIn('basketball', 'Crunch time').querySelector('input').checked).toBe(false);
        expect(rowIn('football', 'Crunch time').querySelector('input').checked).toBe(true);

        const cb = rowIn('basketball', 'Final results').querySelector('input');
        cb.checked = false;
        cb.dispatchEvent(new window.Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 0));
        expect(patched).toEqual([{ hoopsFinal: false }]);
    });
});

// Oct 2026: deleting the home-screen app and adding it back (to pick up the new
// icon) silently ended alerts. The server kept the dead install's endpoint, so
// the panel said "on for 1 device" on a phone that would never ring again.
describe('whether alerts are on for THIS device', () => {
    const status = () => document.querySelector('[push-status]').textContent;
    const buttons = () => [...document.querySelectorAll('[push-actions] button')].map(b => b.textContent);
    const DEAD = 'https://push.example/deleted-install';

    it('says "this device" when the server holds this browser\'s endpoint', async () => {
        await mountPanel();
        expect(status()).toBe('Alerts are on for this device.');
        expect(posted).toEqual([]);
    });

    it('counts the other devices separately', async () => {
        await mountPanel({}, { deviceCount: 3, endpoints: [THIS_DEVICE, 'https://a', 'https://b'] });
        expect(status()).toBe('Alerts are on for this device and 2 others.');
    });

    // THE REGRESSION: a reinstalled app has no subscription and no permission.
    it('a reinstalled app is told it is not on here, and offered the button', async () => {
        await mountPanel({}, { endpoints: [DEAD] }, { endpoint: null, permission: 'default' });
        expect(status()).toMatch(/^Alerts are on for 1 other device, but not this one/);
        expect(buttons()).toContain('Turn on for this device');
        expect(posted).toEqual([]);                      // no prompt-less subscribe without permission
    });

    it('the button registers this device and the panel then says so', async () => {
        await mountPanel({}, { endpoints: [DEAD] }, { endpoint: null, permission: 'default' });
        window.Notification.requestPermission = jest.fn(() => Promise.resolve('granted'));
        const btn = [...document.querySelectorAll('[push-actions] button')]
            .find(b => b.textContent === 'Turn on for this device');
        btn.click();
        await settle();
        expect(posted).toEqual(['https://push.example/fresh']);
        expect(status()).toBe('Alerts are on for this device and 1 other.');
    });

    it('re-registers on its own when permission is already granted', async () => {
        await mountPanel({}, { endpoints: [DEAD] }, { endpoint: null, permission: 'granted' });
        expect(window.Notification.requestPermission).not.toHaveBeenCalled();
        expect(posted).toEqual(['https://push.example/fresh']);
        expect(status()).toBe('Alerts are on for this device and 1 other.');
    });

    // "Turn off" on the phone clears the laptop's server record too, but cannot
    // unsubscribe the laptop's browser. When the phone later turns alerts back
    // on, the laptop must not quietly rejoin — it gets the button.
    it('does not silently re-add a subscription the server dropped', async () => {
        await mountPanel({}, { endpoints: [DEAD] }, { endpoint: THIS_DEVICE, permission: 'granted' });
        expect(posted).toEqual([]);
        expect(status()).toMatch(/but not this one/);
        expect(buttons()).toContain('Turn on for this device');
    });

    // "Turn off" clears every device on the server, so deviceCount 0 must never
    // be read as "lost, re-register" — or turning alerts off would undo itself.
    it('never re-registers after alerts were turned off', async () => {
        await mountPanel({}, { deviceCount: 0, endpoints: [] }, { endpoint: null, permission: 'granted' });
        expect(posted).toEqual([]);
        expect(buttons()).toEqual(['Turn on alerts']);
    });

    it('tries once, then falls back to the button when subscribing fails', async () => {
        await mountPanel({}, { endpoints: [DEAD] }, { endpoint: null, permission: 'granted', subscribeFails: true });
        expect(posted).toEqual([]);
        expect(status()).toMatch(/but not this one/);
        expect(buttons()).toContain('Turn on for this device');
    });
});
