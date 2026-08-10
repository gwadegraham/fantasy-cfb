const { sanitizeCallUrl, CALL_URL_MAX } = require('../modules/draft-call-link');

describe('sanitizeCallUrl', () => {
    it('accepts the links a commissioner actually pastes', () => {
        expect(sanitizeCallUrl('https://zoom.us/j/123456789')).toBe('https://zoom.us/j/123456789');
        expect(sanitizeCallUrl('https://us02web.zoom.us/j/8675309?pwd=aBcD1234'))
            .toBe('https://us02web.zoom.us/j/8675309?pwd=aBcD1234');
        expect(sanitizeCallUrl('https://meet.google.com/abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
        expect(sanitizeCallUrl('https://discord.gg/AbCdEf')).toBe('https://discord.gg/AbCdEf');
    });

    it('trims surrounding whitespace from a pasted link', () => {
        expect(sanitizeCallUrl('  https://zoom.us/j/123  ')).toBe('https://zoom.us/j/123');
    });

    it('allows plain http (a self-hosted Jitsi on the LAN is fair game)', () => {
        expect(sanitizeCallUrl('http://meet.local/draft')).toBe('http://meet.local/draft');
    });

    it('treats blank, whitespace-only, missing, and null as "no link"', () => {
        expect(sanitizeCallUrl('')).toBeNull();
        expect(sanitizeCallUrl('   ')).toBeNull();
        expect(sanitizeCallUrl(null)).toBeNull();
        expect(sanitizeCallUrl(undefined)).toBeNull();
    });

    it('rejects a script-bearing scheme rather than letting it become an href', () => {
        expect(() => sanitizeCallUrl('javascript:alert(1)')).toThrow(/http:\/\/ or https:\/\//);
        expect(() => sanitizeCallUrl('data:text/html,<script>alert(1)</script>')).toThrow(/http:\/\/ or https:\/\//);
        expect(() => sanitizeCallUrl('vbscript:msgbox(1)')).toThrow(/http:\/\/ or https:\/\//);
    });

    it('rejects a bare host or other non-URL text with a usable message', () => {
        expect(() => sanitizeCallUrl('zoom.us/j/123')).toThrow(/must be a full URL/);
        expect(() => sanitizeCallUrl('join my zoom')).toThrow(/must be a full URL/);
    });

    it('rejects a non-string value', () => {
        expect(() => sanitizeCallUrl(42)).toThrow(/must be text/);
        expect(() => sanitizeCallUrl({ href: 'https://zoom.us' })).toThrow(/must be text/);
    });

    it('rejects an absurdly long link', () => {
        const long = 'https://zoom.us/j/' + '9'.repeat(CALL_URL_MAX);
        expect(() => sanitizeCallUrl(long)).toThrow(/characters or fewer/);
    });
});
