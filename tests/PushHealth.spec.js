// The "is this device actually receiving alerts?" rule (modules/push-health.js).
//
// This verdict ends up in front of a manager as "alerts don't seem to be
// reaching this phone", and in front of the admin as evidence in a dispute, so
// both directions matter: it must call a dead device dead, and it must not call
// a live one dead because of one missed receipt or an old service worker.

const { deviceHealth, MIN_SILENT, GRACE_MS } = require('../modules/push-health');

const NOW = Date.parse('2026-11-14T18:00:00Z');
const H = 3600 * 1000;
const send = (hoursAgo, extra = {}) => Object.assign(
    { status: 'accepted', sentAt: new Date(NOW - hoursAgo * H) }, extra);
const got = (hoursAgo) => send(hoursAgo, { receivedAt: new Date(NOW - hoursAgo * H + 1000) });

describe('deviceHealth', () => {
    test('nothing sent is idle', () => {
        expect(deviceHealth([], { nowMs: NOW }).status).toBe('idle');
        expect(deviceHealth(null, { nowMs: NOW }).status).toBe('idle');
    });

    test('a received latest send is ok', () => {
        const h = deviceHealth([got(1), send(5)], { nowMs: NOW });
        expect(h.status).toBe('ok');
        expect(h.silentStreak).toBe(0);
        expect(h.received).toBe(1);
    });

    test('one or two missed receipts after a good one stay ok — offline phones happen', () => {
        expect(deviceHealth([send(1), send(2), got(3)], { nowMs: NOW }).status).toBe('ok');
    });

    test(`${MIN_SILENT} unreceipted sends after a receipt is silent`, () => {
        const h = deviceHealth([send(1), send(2), send(3), got(4)], { nowMs: NOW });
        expect(h.status).toBe('silent');
        expect(h.silentStreak).toBe(3);
        expect(h.lastReceivedAt).toEqual(new Date(NOW - 4 * H + 1000));
    });

    // A device that has never once confirmed an arrival is not proven able
    // to: on iOS a backgrounded worker may not be allowed to post at all. So
    // no manager is nagged on that signal, however long the streak.
    test('a long streak with no receipt ever is unproven, not silent', () => {
        const h = deviceHealth([send(1), send(2), send(3), send(4), send(5)],
            { nowMs: NOW, receiptsSince: new Date(NOW - 10 * H) });
        expect(h.status).toBe('unproven');
        expect(h.silentStreak).toBe(5);
    });

    test('a short streak with no receipt ever is unproven too', () => {
        expect(deviceHealth([send(1), send(2), send(3)], { nowMs: NOW }).status).toBe('unproven');
        expect(deviceHealth([send(1)], { nowMs: NOW }).status).toBe('unproven');
    });

    test('sends inside the grace window are not judged yet', () => {
        const fresh = NOW - GRACE_MS / 2;
        const h = deviceHealth([{ status: 'accepted', sentAt: new Date(fresh) }], { nowMs: NOW });
        expect(h.status).toBe('idle');
        expect(h.sends).toBe(1);
    });

    test('refused sends do not count toward silence', () => {
        const h = deviceHealth([send(1, { status: 'failed' }), send(2, { status: 'gone' }), got(3)], { nowMs: NOW });
        expect(h.status).toBe('ok');
    });

    test('order of the input does not matter', () => {
        const rows = [got(4), send(3), send(1), send(2)];
        expect(deviceHealth(rows, { nowMs: NOW }).status).toBe('silent');
    });
});
