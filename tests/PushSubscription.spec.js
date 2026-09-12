// Validation of a browser-supplied Web Push subscription
// (modules/push-subscription.js).
//
// The endpoint arrives from the client and is later used as the target of an
// outbound HTTPS request from the dyno on every scoring tick. That makes the
// https check a security property, not a formatting nicety.

const {
    sanitizeSubscription, sanitizePrefs, isHttpsUrl, MAX_SUBSCRIPTIONS
} = require('../modules/push-subscription');

const valid = {
    endpoint: 'https://web.push.apple.com/abc123',
    keys: { p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' }
};

describe('sanitizeSubscription', () => {
    it('keeps exactly the fields we store', () => {
        const out = sanitizeSubscription(valid, 'Mozilla/5.0 (iPhone)');
        expect(out.endpoint).toBe(valid.endpoint);
        expect(out.keys).toEqual({ p256dh: 'BPublicKeyBytes', auth: 'AuthSecret' });
        expect(out.userAgent).toBe('Mozilla/5.0 (iPhone)');
        expect(out.createdAt).toBeInstanceOf(Date);
    });

    it('accepts the subscription either nested or bare', () => {
        expect(sanitizeSubscription({ subscription: valid }).endpoint).toBe(valid.endpoint);
        expect(sanitizeSubscription(valid).endpoint).toBe(valid.endpoint);
    });

    // Without this, an authenticated manager could point every future send at a
    // host of their choosing — a stored SSRF, fired from our dyno every 10s.
    it('refuses a non-https endpoint', () => {
        expect(() => sanitizeSubscription({ endpoint: 'http://evil.test/x', keys: valid.keys }))
            .toThrow(/https endpoint/);
        expect(() => sanitizeSubscription({ endpoint: 'file:///etc/passwd', keys: valid.keys }))
            .toThrow(/https endpoint/);
        expect(() => sanitizeSubscription({ endpoint: 'not a url', keys: valid.keys }))
            .toThrow(/https endpoint/);
    });

    it('refuses an absurdly long endpoint', () => {
        const long = 'https://web.push.apple.com/' + 'a'.repeat(2000);
        expect(() => sanitizeSubscription({ endpoint: long, keys: valid.keys })).toThrow(/https endpoint/);
    });

    // Web Push payloads are encrypted end-to-end. A subscription missing either
    // key is unusable, and storing it means a device that silently never fires.
    it('refuses a subscription missing either encryption key', () => {
        expect(() => sanitizeSubscription({ endpoint: valid.endpoint, keys: { auth: 'x' } }))
            .toThrow(/p256dh and auth/);
        expect(() => sanitizeSubscription({ endpoint: valid.endpoint, keys: { p256dh: 'x' } }))
            .toThrow(/p256dh and auth/);
        expect(() => sanitizeSubscription({ endpoint: valid.endpoint }))
            .toThrow(/p256dh and auth/);
        expect(() => sanitizeSubscription({ endpoint: valid.endpoint, keys: { p256dh: '', auth: 'x' } }))
            .toThrow(/p256dh and auth/);
    });

    it('refuses an empty body without throwing something unreadable', () => {
        expect(() => sanitizeSubscription(null)).toThrow(/https endpoint/);
        expect(() => sanitizeSubscription(undefined)).toThrow(/https endpoint/);
    });

    it('truncates a long user agent rather than storing it whole', () => {
        const out = sanitizeSubscription(valid, 'x'.repeat(1000));
        expect(out.userAgent.length).toBe(300);
    });

    it('leaves the user agent unset when the header is absent', () => {
        expect(sanitizeSubscription(valid).userAgent).toBeUndefined();
    });
});

describe('isHttpsUrl', () => {
    it('accepts https and nothing else', () => {
        expect(isHttpsUrl('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
        expect(isHttpsUrl('http://fcm.googleapis.com/x')).toBe(false);
        expect(isHttpsUrl(null)).toBe(false);
        expect(isHttpsUrl(12)).toBe(false);
    });
});

describe('sanitizePrefs', () => {
    it('keeps only the keys that were sent, so a partial update stays partial', () => {
        expect(sanitizePrefs({ score: false })).toEqual({ score: false });
        expect(sanitizePrefs({ score: false, final: true })).toEqual({ score: false, final: true });
    });

    it('ignores unknown keys', () => {
        expect(sanitizePrefs({ score: false, nonsense: true })).toEqual({ score: false });
    });

    it('refuses a non-boolean, rather than coercing it', () => {
        expect(() => sanitizePrefs({ score: 'yes' })).toThrow(/true or false/);
        expect(() => sanitizePrefs({ closeGame: 1 })).toThrow(/true or false/);
    });

    it('refuses an update that would change nothing', () => {
        expect(() => sanitizePrefs({})).toThrow(/No alert preferences/);
        expect(() => sanitizePrefs(null)).toThrow(/No alert preferences/);
        expect(() => sanitizePrefs({ nonsense: true })).toThrow(/No alert preferences/);
    });
});

describe('MAX_SUBSCRIPTIONS', () => {
    it('caps how far one user document can grow', () => {
        expect(MAX_SUBSCRIPTIONS).toBeGreaterThan(1);
        expect(MAX_SUBSCRIPTIONS).toBeLessThanOrEqual(20);
    });
});
