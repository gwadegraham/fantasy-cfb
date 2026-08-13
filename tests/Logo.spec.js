const { pickLogo, logoSize } = require('../public/logo.js');

// The new CFBD /teams shape: 8 sizes × light/dark, largest first.
const CFBD = [
    'https://cdn.collegefootballdata.com/logos/500/333.png',
    'https://cdn.collegefootballdata.com/logos-dark/500/333.png',
    'https://cdn.collegefootballdata.com/logos/256/333.png',
    'https://cdn.collegefootballdata.com/logos-dark/256/333.png',
    'https://cdn.collegefootballdata.com/logos/128/333.png',
    'https://cdn.collegefootballdata.com/logos-dark/128/333.png',
    'https://cdn.collegefootballdata.com/logos/16/333.png',
    'https://cdn.collegefootballdata.com/logos-dark/16/333.png'
];
// The old ESPN shape: [light-500, dark-500].
const ESPN = [
    'http://a.espncdn.com/i/teamlogos/ncaa/500/333.png',
    'http://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png'
];

describe('logoSize', () => {
    test('reads the size segment before the filename', () => {
        expect(logoSize('https://cdn.collegefootballdata.com/logos-dark/500/333.png')).toBe(500);
        expect(logoSize('https://cdn.collegefootballdata.com/logos/16/333.png')).toBe(16);
        expect(logoSize('http://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png')).toBe(500);
    });
    test('0 when there is no numeric size', () => {
        expect(logoSize('https://x/logo.png')).toBe(0);
        expect(logoSize(null)).toBe(0);
    });
});

describe('pickLogo', () => {
    test('CFBD: dark variant at the largest size (default)', () => {
        expect(pickLogo(CFBD)).toBe('https://cdn.collegefootballdata.com/logos-dark/500/333.png');
    });
    test('CFBD: light variant at the largest size when asked', () => {
        expect(pickLogo(CFBD, { dark: false })).toBe('https://cdn.collegefootballdata.com/logos/500/333.png');
    });
    test('regression: does NOT return the tiny dark-16 that .at(-1) would', () => {
        expect(pickLogo(CFBD)).not.toContain('/16/');
    });
    // The ESPN fixtures are stored as http://; the SELECTION here is unchanged
    // (still dark-500 / light-500, matching the old .at(-1)) — only the scheme is
    // upgraded on the way out, so the image isn't blocked as mixed content.
    test('ESPN back-compat: still the dark-500 (matches the old .at(-1))', () => {
        expect(pickLogo(ESPN)).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png');
        expect(pickLogo(ESPN, { dark: false })).toBe('https://a.espncdn.com/i/teamlogos/ncaa/500/333.png');
        expect(pickLogo(ESPN)).toContain('/500-dark/');
    });
    test('single-logo team: returns the only logo regardless of variant', () => {
        expect(pickLogo(['https://cdn.collegefootballdata.com/logos/500/1.png']))
            .toBe('https://cdn.collegefootballdata.com/logos/500/1.png');
    });
    test('empty / missing → empty string', () => {
        expect(pickLogo([])).toBe('');
        expect(pickLogo(null)).toBe('');
        expect(pickLogo(undefined)).toBe('');
    });
    test('drops falsy entries', () => {
        expect(pickLogo([null, '', 'https://cdn.collegefootballdata.com/logos-dark/500/1.png']))
            .toBe('https://cdn.collegefootballdata.com/logos-dark/500/1.png');
    });
});

// Mixed content: the app is served over https in production, but every logo URL
// CFBD/ESPN store is http://. A browser blocks those, so the logos silently
// vanish everywhere at once — the failure looks like "the images are broken",
// not like a protocol problem. pickLogo is the one selector every surface goes
// through, so the upgrade belongs here.
describe('https upgrade', () => {
    const ESPN = 'a.espncdn.com/i/teamlogos/ncaa/500-dark/194.png';

    it('upgrades an http logo so it is not blocked as mixed content', () => {
        expect(pickLogo(['http://' + ESPN])).toBe('https://' + ESPN);
    });

    it('leaves an https logo alone', () => {
        expect(pickLogo(['https://' + ESPN])).toBe('https://' + ESPN);
    });

    it('is case-insensitive about the scheme', () => {
        expect(pickLogo(['HTTP://' + ESPN])).toBe('https://' + ESPN);
    });

    it('does not touch a protocol-relative URL', () => {
        expect(pickLogo(['//' + ESPN])).toBe('//' + ESPN);
    });

    it('only rewrites the scheme, never an http substring elsewhere in the path', () => {
        const tricky = 'https://cdn.example.com/logos/http://not-a-scheme/1.png';
        expect(pickLogo([tricky])).toBe(tricky);
    });

    it('still returns empty for a team with no logos', () => {
        expect(pickLogo([])).toBe('');
        expect(pickLogo(null)).toBe('');
    });

    it('upgrades the winner, not merely the first entry', () => {
        // dark-500 should win on variant+size, and come back upgraded.
        const logos = ['http://x/logos/16/1.png', 'http://x/logos-dark/500/1.png', 'http://x/logos/500/1.png'];
        expect(pickLogo(logos)).toBe('https://x/logos-dark/500/1.png');
    });
});
