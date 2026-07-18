const { sanitizeProfileUpdate, isValidAvatarUrl, FRANCHISE_NAME_MAX } = require('../modules/profile-update');

const CLOUD = 'loa85ael';

describe('isValidAvatarUrl', () => {
    it('accepts an https Cloudinary URL for our cloud', () => {
        expect(isValidAvatarUrl(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/campus-clash/avatars/x.jpg`, CLOUD)).toBe(true);
    });
    it('rejects other hosts, other clouds, non-https, and junk', () => {
        expect(isValidAvatarUrl(`http://res.cloudinary.com/${CLOUD}/x.jpg`, CLOUD)).toBe(false);   // not https
        expect(isValidAvatarUrl('https://evil.example.com/x.jpg', CLOUD)).toBe(false);              // wrong host
        expect(isValidAvatarUrl('https://res.cloudinary.com/someoneelse/x.jpg', CLOUD)).toBe(false);// wrong cloud
        expect(isValidAvatarUrl('javascript:alert(1)', CLOUD)).toBe(false);
        expect(isValidAvatarUrl('not a url', CLOUD)).toBe(false);
        expect(isValidAvatarUrl(null, CLOUD)).toBe(false);
    });
    it('rejects everything when no cloud is configured', () => {
        expect(isValidAvatarUrl(`https://res.cloudinary.com/${CLOUD}/x.jpg`, '')).toBe(false);
    });
});

describe('sanitizeProfileUpdate', () => {
    it('keeps a normal franchise name with spaces and punctuation', () => {
        expect(sanitizeProfileUpdate({ franchiseName: "Garrett's Gridiron Gang" }, CLOUD))
            .toEqual({ franchiseName: "Garrett's Gridiron Gang" });
    });
    it('trims, collapses whitespace, and strips control chars', () => {
        expect(sanitizeProfileUpdate({ franchiseName: '  The\t\tBig   Dogs ' }, CLOUD))
            .toEqual({ franchiseName: 'The Big Dogs' });
    });
    it('treats blank/whitespace-only name as a clear (null)', () => {
        expect(sanitizeProfileUpdate({ franchiseName: '   ' }, CLOUD)).toEqual({ franchiseName: null });
        expect(sanitizeProfileUpdate({ franchiseName: '' }, CLOUD)).toEqual({ franchiseName: null });
        expect(sanitizeProfileUpdate({ franchiseName: null }, CLOUD)).toEqual({ franchiseName: null });
    });
    it('rejects an over-long name', () => {
        expect(() => sanitizeProfileUpdate({ franchiseName: 'x'.repeat(FRANCHISE_NAME_MAX + 1) }, CLOUD)).toThrow(/characters or fewer/);
    });
    it('rejects a non-string name', () => {
        expect(() => sanitizeProfileUpdate({ franchiseName: 123 }, CLOUD)).toThrow(/must be text/);
    });
    it('accepts a valid avatar URL and rejects an invalid one', () => {
        const good = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.jpg`;
        expect(sanitizeProfileUpdate({ avatarUrl: good }, CLOUD)).toEqual({ avatarUrl: good });
        expect(() => sanitizeProfileUpdate({ avatarUrl: 'https://evil.com/x.jpg' }, CLOUD)).toThrow(/uploaded image URL/);
    });
    it('clears the avatar with empty string / null', () => {
        expect(sanitizeProfileUpdate({ avatarUrl: '' }, CLOUD)).toEqual({ avatarUrl: null });
    });
    it('coerces prompted to a boolean', () => {
        expect(sanitizeProfileUpdate({ prompted: 1 }, CLOUD)).toEqual({ prompted: true });
        expect(sanitizeProfileUpdate({ prompted: false }, CLOUD)).toEqual({ prompted: false });
    });
    it('returns only the fields present (partial update)', () => {
        expect(sanitizeProfileUpdate({ prompted: true }, CLOUD)).toEqual({ prompted: true });
    });
    it('throws when there is nothing to update', () => {
        expect(() => sanitizeProfileUpdate({}, CLOUD)).toThrow(/Nothing to update/);
    });
});
