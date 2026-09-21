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

async function mountPanel(prefs = {}) {
    document.body.innerHTML = PANEL;

    // supported() needs all three, or the panel renders "this browser can't".
    navigator.serviceWorker = { register: jest.fn() };
    window.PushManager = function () {};
    window.Notification = function () {};

    patched = [];
    window.fetch = jest.fn((url, opts) => {
        if (String(url).indexOf('/users/me/push/prefs') === 0) {
            patched.push(JSON.parse(opts.body));
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ configured: true, deviceCount: 1, allowed: true, prefs })
        });
    });

    // The module is an IIFE that publishes window.PushAlerts on load.
    // eslint-disable-next-line no-eval
    window.eval(SOURCE);
    window.PushAlerts.mount(document.querySelector('[push-alerts]'));
    await new Promise(r => setTimeout(r, 0));
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
