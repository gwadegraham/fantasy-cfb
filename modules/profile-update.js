// Validation + config helpers for self-service profile edits (franchise name +
// avatar). DB-free so it can be unit-tested; routes/users.js applies the result.

const FRANCHISE_NAME_MAX = 40;

// Cloudinary settings the browser needs for unsigned uploads. Both values are
// public (they ship to the client), so they live in plain env vars, not secrets.
function cloudinaryConfig() {
    return {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
        uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || ''
    };
}

// An avatar URL is only accepted if it's an https Cloudinary delivery URL for
// OUR cloud. That stops an authenticated client from stashing an arbitrary
// external/hotlinked URL (or a javascript:/data: payload) on their profile.
function isValidAvatarUrl(url, cloudName) {
    if (typeof url !== 'string' || !cloudName) return false;
    let parsed;
    try { parsed = new URL(url); } catch (e) { return false; }
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'res.cloudinary.com') return false;
    // Path is /<cloudName>/image/upload/...
    return parsed.pathname.startsWith('/' + cloudName + '/');
}

// Removes ASCII control characters (0-31 and 127) from a string, keeping normal
// printable text (letters, spaces, punctuation, accented/unicode chars).
function stripControlChars(s) {
    let out = '';
    for (const ch of s) {
        const code = ch.charCodeAt(0);
        if (code >= 32 && code !== 127) out += ch;
    }
    return out;
}

// Normalizes a self-service profile update. Only fields actually present in the
// body are returned, so a partial update (e.g. just the flag) leaves the rest
// untouched. Throws Error(message) on invalid input -> the route maps to 400.
// Passing an explicit empty string clears franchiseName/avatarUrl (set to null).
function sanitizeProfileUpdate(body, cloudName) {
    const b = body || {};
    const out = {};

    if (Object.prototype.hasOwnProperty.call(b, 'franchiseName')) {
        const raw = b.franchiseName;
        if (raw === null || raw === '') {
            out.franchiseName = null;
        } else if (typeof raw === 'string') {
            // Collapse whitespace (incl. tabs/newlines) to single spaces first,
            // THEN strip any remaining control chars, so a tab between words
            // becomes a space rather than fusing the words together.
            const name = stripControlChars(raw.replace(/\s+/g, ' ')).trim();
            if (!name) {
                out.franchiseName = null;
            } else if (name.length > FRANCHISE_NAME_MAX) {
                throw new Error(`Team name must be ${FRANCHISE_NAME_MAX} characters or fewer.`);
            } else {
                out.franchiseName = name;
            }
        } else {
            throw new Error('Team name must be text.');
        }
    }

    if (Object.prototype.hasOwnProperty.call(b, 'avatarUrl')) {
        const raw = b.avatarUrl;
        if (raw === null || raw === '') {
            out.avatarUrl = null;
        } else if (isValidAvatarUrl(raw, cloudName)) {
            out.avatarUrl = raw;
        } else {
            throw new Error('Avatar must be an uploaded image URL.');
        }
    }

    if (Object.prototype.hasOwnProperty.call(b, 'prompted')) {
        out.prompted = !!b.prompted;
    }

    if (Object.keys(out).length === 0) {
        throw new Error('Nothing to update.');
    }
    return out;
}

module.exports = { cloudinaryConfig, isValidAvatarUrl, sanitizeProfileUpdate, FRANCHISE_NAME_MAX };
