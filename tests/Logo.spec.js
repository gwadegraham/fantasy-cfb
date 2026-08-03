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
    test('ESPN back-compat: still the dark-500 (matches the old .at(-1))', () => {
        expect(pickLogo(ESPN)).toBe('http://a.espncdn.com/i/teamlogos/ncaa/500-dark/333.png');
        expect(pickLogo(ESPN, { dark: false })).toBe('http://a.espncdn.com/i/teamlogos/ncaa/500/333.png');
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
