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

async function mountPanel(prefs = {}, state = {}) {
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
            json: () => Promise.resolve(Object.assign({ configured: true, deviceCount: 1, allowed: true, prefs }, state))
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
